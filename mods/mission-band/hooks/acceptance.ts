// 驗收清單（acceptance-<key>.md）的純函式解析層：meta、每條 AC、整體計數。格式契約見
// claude-skills/skills/_shared/acceptance/format.md 的「解析規則」節，改格式要四個地方
// （/to-acceptance、/verify-acceptance、fe-mr-generator、這裡）一起改。這裡只管解析，不碰
// $；找檔案（直接拼 key，或掃 specs 目錄配 meta.mission）、寫回任務摘要在 hooks/acceptance-events.ts。
import type {
  AcceptanceCounts,
  AcceptanceDeferrability,
  AcceptanceItem,
  AcceptanceItemStatus,
  AcceptanceMeta,
  AcceptanceOverall,
  AcceptanceOverallStatus,
  AcceptanceSummary,
  Mission,
} from '../types'
import type { DoneWhenResult } from './products'

// ===== 正則與白名單（逐字對應 format.md 的「解析規則」節） =====

const META_PATTERN = /<!-- acceptance:meta (\{.*?\}) -->/
// (?!\d) 在 \d+ greedy 的前提下其實不會改變比對結果（\d+ 本來就會吃光所有連續數字），
// 照抄 format.md 的字面規則只是為了跟契約逐字一致，不是因為少了它會抓錯 id。
const AC_HEADING_PATTERN = /^### (AC-\d+)(?!\d)(（已刪除）)?\s*(.*)$/
const FIELD_PATTERN = /^- (範圍|前提|操作|預期|改動前|證據|驗不了時|回歸|回歸入庫|來源|結果)[：:]\s*(.*)$/
const OVERALL_PATTERN = /^- 整體回歸[：:]\s*(.*)$/
const SEPARATOR_PATTERN = /[｜|]/

const RESULT_WHITELIST = ['待驗', '通過', '未過', '受阻', '待重驗', '已刪除'] as const
const OVERALL_WHITELIST = ['未跑', '通過', '未過', '受阻'] as const
const BACKLOG_WHITELIST = ['待寫', '已寫'] as const
const DEFERRABILITY_WHITELIST = ['必須驗過', '可後補', '只驗前端'] as const
const DEFAULT_DEFERRABILITY: AcceptanceDeferrability = '必須驗過'
const DEFERRABLE_VALUE: AcceptanceDeferrability = '可後補'

const NO_CHANGE_BEFORE_VALUE = '無（新功能）'
const SAME_AS_EXPECTED_PREFIX = '同預期'
const REGRESSION_YES_PREFIX = '是'
const REGRESSION_DONE_WORD = '已寫'

/**
 * 值是不是白名單裡的某個詞：那個詞要整個等於值（先 trim 頭尾空白／CRLF 殘留的 \r），
 * 或值以那個詞開頭、中間可以有空白、再緊接著分隔符（全形｜或半形|，例如使用者多打一個
 * 空格的「通過 ｜測試」）；單純的字首相同不算（例如「通過（部分）」不算「通過」）。
 * 認不得就回傳 fallback。
 */
function matchWhitelistWord<T extends string>(value: string, whitelist: readonly T[], fallback: T): T {
  const trimmed = value.trim()
  for (const word of whitelist) {
    if (trimmed === word) return word
    if (trimmed.startsWith(word) && SEPARATOR_PATTERN.test(trimmed.slice(word.length).trimStart()[0] ?? '')) return word
  }
  return fallback
}

/**
 * 「驗不了時」欄的白名單比對：一般分隔規則跟其他欄位一樣（緊接｜、|、行尾）；只有「可後補」
 * 多一條例外——後面接全形冒號也算（例如「可後補：等後端部署」）。半形冒號對任何值都不算，
 * 「只驗前端」「必須驗過」也沒有冒號例外——逐字對應 format.md「解析規則」節，解析從寬只
 * 放寬這一種，產生時仍一律寫｜。
 */
function matchDeferrability(value: string): AcceptanceDeferrability {
  const matched = matchWhitelistWord(value, DEFERRABILITY_WHITELIST, DEFAULT_DEFERRABILITY)
  if (matched !== DEFAULT_DEFERRABILITY) return matched

  const trimmed = value.trim()
  if (trimmed.startsWith(DEFERRABLE_VALUE) && trimmed.slice(DEFERRABLE_VALUE.length).trimStart().startsWith('：')) return DEFERRABLE_VALUE
  return DEFAULT_DEFERRABILITY
}

// ===== meta =====

/** 解析 `<!-- acceptance:meta {...} -->`；JSON 壞掉、找不到這行、或不是物件都回空物件，不丟錯。 */
export function parseAcceptanceMeta(text: string): AcceptanceMeta {
  const match = META_PATTERN.exec(text)
  if (match?.[1] === undefined) return {}

  try {
    const parsed: unknown = JSON.parse(match[1])
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as AcceptanceMeta) : {}
  } catch {
    return {}
  }
}

// ===== 每一條 AC =====

type RawAcceptanceItem = { id: string; deleted: boolean; title: string; fields: Record<string, string> }

function parseRawItems(text: string): RawAcceptanceItem[] {
  const items: RawAcceptanceItem[] = []
  let current: RawAcceptanceItem | undefined

  for (const line of text.split(/\r?\n/)) {
    const heading = AC_HEADING_PATTERN.exec(line)
    if (heading !== null) {
      const [, id, deletedMarker, title] = heading
      if (id === undefined) continue
      current = { id, deleted: deletedMarker !== undefined, title: title ?? '', fields: {} }
      items.push(current)
      continue
    }

    if (current === undefined) continue
    const field = FIELD_PATTERN.exec(line)
    if (field === null) continue
    const [, name, value] = field
    if (name === undefined) continue
    current.fields[name] = value ?? ''
  }

  return items
}

/** 改動前既不是「無（新功能）」也不是「同預期」開頭，才需要補 Before 證據；缺這欄（例如已刪除的條目）也不需要。 */
function computeNeedsBefore(beforeValue: string | undefined): boolean {
  if (beforeValue === undefined) return false
  if (beforeValue === NO_CHANGE_BEFORE_VALUE) return false
  return !beforeValue.startsWith(SAME_AS_EXPECTED_PREFIX)
}

function toAcceptanceItem(raw: RawAcceptanceItem): AcceptanceItem {
  // 缺少「結果」行的條目當成待驗，跟結果認不得狀態時的 fallback 一樣。
  const status: AcceptanceItemStatus = matchWhitelistWord(raw.fields['結果'] ?? '', RESULT_WHITELIST, '待驗')
  // 缺「驗不了時」這欄，或值不是白名單裡的詞，都當成必須驗過（見 format.md 解析規則）。
  const deferrability: AcceptanceDeferrability = matchDeferrability(raw.fields['驗不了時'] ?? '')
  return { id: raw.id, deleted: raw.deleted, title: raw.title, fields: raw.fields, status, deferrability, needsBefore: computeNeedsBefore(raw.fields['改動前']) }
}

// ===== 整體回歸 =====

function parseOverall(text: string): AcceptanceOverall {
  for (const line of text.split(/\r?\n/)) {
    const match = OVERALL_PATTERN.exec(line)
    if (match?.[1] === undefined) continue

    const value = match[1]
    const status: AcceptanceOverallStatus = matchWhitelistWord(value, OVERALL_WHITELIST, '未跑')
    if (status !== '通過') return { status }

    const sha = value.split(SEPARATOR_PATTERN)[2]
    return sha === undefined ? { status } : { status, sha }
  }
  return { status: '未跑' }
}

// ===== 計數 =====

function isRegressionYes(fields: Readonly<Record<string, string>>): boolean {
  return (fields['回歸'] ?? '').startsWith(REGRESSION_YES_PREFIX)
}

function regressionBacklogDone(fields: Readonly<Record<string, string>>): boolean {
  return matchWhitelistWord(fields['回歸入庫'] ?? '', BACKLOG_WHITELIST, '待寫') === REGRESSION_DONE_WORD
}

// 標題有沒有寫「（已刪除）」跟「結果」欄是不是已刪除，兩者照規格該一致，但使用者
// 手改的清單難免漏改標題；只要結果欄寫了已刪除，就不算進 total，不要求標題也要對。
// 匯出給 acceptance-events.ts 的 toSummary 算 acIds 用同一條規則——已刪除的 AC 不該出現
// 在 acIds 裡，MR Evidence 檢查才不會要求「已刪除的 AC 也要補截圖」。
export function isExcludedFromTotal(item: AcceptanceItem): boolean {
  return item.deleted || item.status === '已刪除'
}

// 受阻裡「可後補」的那些算 deferred（後補）：不算過，但不擋 evaluateAcceptanceRunDoneWhen；
// 其他受阻（必須驗過、只驗前端、缺欄）照舊算 blocked，繼續擋著。
function isDeferredBlock(item: AcceptanceItem): boolean {
  return item.status === '受阻' && item.deferrability === DEFERRABLE_VALUE
}

function computeCounts(items: readonly AcceptanceItem[]): AcceptanceCounts {
  const active = items.filter(item => !isExcludedFromTotal(item))
  const regressionItems = active.filter(item => isRegressionYes(item.fields))
  const blockedItems = active.filter(item => item.status === '受阻')

  return {
    total: active.length,
    passed: active.filter(item => item.status === '通過').length,
    failed: active.filter(item => item.status === '未過').length,
    blocked: blockedItems.filter(item => !isDeferredBlock(item)).length,
    deferred: blockedItems.filter(isDeferredBlock).length,
    pending: active.filter(item => item.status === '待驗' || item.status === '待重驗').length,
    regressionTotal: regressionItems.length,
    regressionTodo: regressionItems.filter(item => !regressionBacklogDone(item.fields)).length,
  }
}

// ===== 整份解析 =====

/** 解析整份驗收清單文字；格式認不得的行一律忽略，不會丟錯（見 format.md 的解析規則）。 */
export function parseAcceptance(text: string): AcceptanceSummary {
  const items = parseRawItems(text).map(toAcceptanceItem)
  return { meta: parseAcceptanceMeta(text), items, counts: computeCounts(items), overall: parseOverall(text) }
}

// ===== key／檔案路徑 =====

// 任務名裡隨便哪裡出現 #<數字> 都算，不要求在字串結尾——實際任務名常是
// `MMDD-issue-#473` 這種「日期＋自訂標籤＋#issue」的形狀，不是只有 `MMDD-#473`。
// 這條是 format.md 自己的規則，刻意不借用 model.ts 的 issueIidFromMissionName（那支管的是
// 「這個任務的 issue 留言／URL」，端點不同，沒有理由耦合在一起）。
const MISSION_NAME_ISSUE_NUMBER_PATTERN = /#(\d+)/

/**
 * 任務名裡有 `#<數字>` 才能直接拼出 key；其他任務名（使用者取的短名，沒有 issue 號）
 * 沒有這種直接對應，要掃 `.claude/specs/acceptance-*.md` 配 meta.mission（見
 * hooks/acceptance-events.ts 的 resolveAcceptancePath），這裡不猜。
 */
export function acceptanceKeyFromMissionName(name: string): string | undefined {
  return MISSION_NAME_ISSUE_NUMBER_PATTERN.exec(name)?.[1]
}

export function acceptancePath(repoRoot: string, key: string): string {
  return `${repoRoot}/.claude/specs/acceptance-${key}.md`
}

const ACCEPTANCE_FILE_NAME_PATTERN = /^acceptance-.+\.md$/

export function isAcceptanceFileName(name: string): boolean {
  return ACCEPTANCE_FILE_NAME_PATTERN.test(name)
}

/** Write／Edit 的 file_path 是不是在寫某份驗收清單（不管哪個 key）；真的是不是這個任務的那一份，由呼叫端重新解析路徑決定。 */
const ACCEPTANCE_FILE_PATH_PATTERN = /\/\.claude\/specs\/acceptance-[^/]+\.md$/

export function looksLikeAcceptanceFileWrite(filePath: string): boolean {
  return ACCEPTANCE_FILE_PATH_PATTERN.test(filePath)
}

// 驗收清單只認主 checkout 的 .claude/specs（見 resolveAcceptancePath），寫到 worktree
// 自己那份 .claude/worktrees/<name>/.claude/specs/ 底下的話，mission-band 永遠讀不到——
// 這條只是用來判斷要不要提醒使用者寫錯位置，不是解析路徑本身。
const WORKTREE_ACCEPTANCE_FILE_PATH_PATTERN = /\/\.claude\/worktrees\/.+\/\.claude\/specs\/acceptance-[^/]+\.md$/

export function looksLikeWorktreeAcceptanceFileWrite(filePath: string): boolean {
  return WORKTREE_ACCEPTANCE_FILE_PATH_PATTERN.test(filePath)
}

/** 在 `.claude/specs` 掃到的候選檔案裡，找 meta.mission 等於這個任務名的那一份；找不到就是 undefined。 */
export function pickAcceptanceFileForMission(entries: readonly { name: string; text: string }[], missionName: string): string | undefined {
  return entries.find(entry => isAcceptanceFileName(entry.name) && parseAcceptanceMeta(entry.text).mission === missionName)?.name
}

/** spec 檔現在的 mtime 比 meta 記的 specMtime 晚（取到整秒比較）才算改過；meta 沒有 specMtime 就不判斷。 */
export function isSpecStale(specMtimeMs: number, metaSpecMtimeIso: string | undefined): boolean {
  if (metaSpecMtimeIso === undefined) return false
  const metaMs = Date.parse(metaSpecMtimeIso)
  if (Number.isNaN(metaMs)) return false
  return Math.floor(specMtimeMs / 1000) > Math.floor(metaMs / 1000)
}

// ===== doneWhen：to-acceptance 節點 =====

/**
 * to-acceptance 節點的完成條件：驗收清單檔存在就算完成，不看 enteredAt（跟 doneWhen 'worktree'
 * 一樣）。node-states.ts 的 evaluateDoneWhenAny 只負責分派，實際判斷放這裡跟 mission.acceptance
 * 這個欄位放一起。
 */
export function evaluateAcceptanceDoneWhen(mission: Mission): DoneWhenResult {
  const acceptance = mission.acceptance
  if (acceptance === undefined || !acceptance.exists) return { done: false }
  const total = acceptance.counts?.total
  return { done: true, detail: total === undefined ? undefined : `${total} 條` }
}

// ===== doneWhen：驗收階段三個節點 =====

/**
 * 逐條驗收：驗收清單存在、至少有 1 條（非已刪除的）AC，而且「通過＋後補」補滿 total 才算
 * 完成——後補（受阻＋可後補）不擋這個節點，等條件到了再補驗，見 format.md「驗不了時」。
 * detail 不管做完沒做完都算一樣的字串（「AC 通過數/total」，未過／受阻／後補各自不是 0
 * 才加進去），讓使用者隨時看得到進度，不是做完才突然冒出一串數字。deferred 是第七版才加
 * 的欄位，舊資料沒這欄當成 0。
 */
export function evaluateAcceptanceRunDoneWhen(mission: Mission): DoneWhenResult {
  const counts = mission.acceptance?.counts
  if (mission.acceptance?.exists !== true || counts === undefined || counts.total === 0) return { done: false }

  const deferred = counts.deferred ?? 0
  const parts = [`AC ${counts.passed}/${counts.total}`]
  if (counts.failed > 0) parts.push(`${counts.failed} 未過`)
  if (counts.blocked > 0) parts.push(`${counts.blocked} 受阻`)
  if (deferred > 0) parts.push(`${deferred} 後補`)
  return { done: counts.passed + deferred === counts.total, detail: parts.join('，') }
}

/**
 * 回歸入庫：沒有任何一條 AC 需要補回歸測試（regressionTotal 是 0）就直接算完成，不用
 * 使用者特別 /mission-skip——這個節點本來就是「有沒有欠回歸測試」，沒欠就沒事可做。
 * 舊任務根本沒有驗收清單（counts undefined）也一樣直接算完成、透明放過，不強迫舊任務
 * 補跑 /to-acceptance 才能過這一關；真的要擋的話擋在 acceptance-run 跟 overall-regression。
 */
export function evaluateRegressionWriteDoneWhen(mission: Mission): DoneWhenResult {
  const counts = mission.acceptance?.counts
  if (counts === undefined) return { done: true }
  if (counts.regressionTotal === 0) return { done: true }
  if (counts.regressionTodo === 0) return { done: true, detail: `${counts.regressionTotal} 條已寫` }
  return { done: false, detail: `${counts.regressionTodo} 條待寫` }
}

/**
 * 整體回歸：清單記的整體回歸是「通過」才算完成；overallStale（記錄的 sha 跟 worktree
 * 現在的 HEAD 不一樣，見 acceptance-events.ts 的 computeOverallStale）當成還沒做完，
 * 等同 format.md 講的「HEAD 跟記錄的 SHA 不同也當成未跑」。
 */
export function evaluateOverallRegressionDoneWhen(mission: Mission): DoneWhenResult {
  const overall = mission.acceptance?.overall
  if (overall === undefined || overall.status !== '通過') return { done: false }
  if (mission.acceptance?.overallStale === true) return { done: false, detail: 'commit 變了' }
  return { done: true }
}
