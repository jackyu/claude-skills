// review-triage 報告（/review-triage 寫在 <main>/.claude/verify-evidence/<key>/
// review-triage-r<N>.md，格式契約見 skills/review-triage/SKILL.md 的 Step 6）的純函式層：
// 解析第一行 meta、審查階段 review-triage 節點的 doneWhen／skipWhen、band 顯示用的計數摘要
// 與警示判斷。不碰 $，找檔案／讀檔在 hooks/review-triage-events.ts（跟 acceptance.ts／
// acceptance-events.ts 同一種分法）。
import type { Mission, ReviewTriageCounts, ReviewTriageReportMeta } from '../types'
import { acceptanceKeyFromMissionName } from './acceptance'
import type { DoneWhenResult } from './products'

const META_PATTERN = /<!-- review-triage: (\{.*?\}) -->/
const REPORT_FILE_PATH_PATTERN = /\/\.claude\/verify-evidence\/[^/]+\/review-triage-r\d+\.md$/
const COUNT_KEYS = ['confirmed', 'pending', 'withdrawn', 'defensive', 'premise'] as const

function parseCounts(value: unknown): ReviewTriageCounts | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const counts: Partial<ReviewTriageCounts> = {}
  for (const key of COUNT_KEYS) {
    const n = record[key]
    if (typeof n !== 'number') return undefined
    counts[key] = n
  }
  return counts as ReviewTriageCounts
}

/**
 * 解析報告第一行的 `<!-- review-triage: {...} -->` meta；只看文字的第一行，meta 不在第一行、
 * 找不到這段、JSON 壞掉、缺欄位或型別不對，都回 undefined——呼叫端記一次錯誤就好，不丟例外
 * （跟 acceptance.ts 的 parseAcceptanceMeta 同一套「格式認不得就忽略」原則）。
 */
export function parseReviewTriageMeta(text: string): ReviewTriageReportMeta | undefined {
  const firstLine = text.split(/\r?\n/, 1)[0]
  const match = firstLine === undefined ? null : META_PATTERN.exec(firstLine)
  if (match?.[1] === undefined) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>

  const { round, head, notes, warn } = record
  if (typeof round !== 'number' || typeof head !== 'string' || typeof warn !== 'boolean') return undefined
  if (!Array.isArray(notes) || !notes.every((id): id is number => typeof id === 'number')) return undefined
  const counts = parseCounts(record.counts)
  if (counts === undefined) return undefined

  return { round, head, notes, counts, warn }
}

/**
 * 這個任務的 review-triage key：跟驗收清單同一套規則——任務名有 `#<數字>` 就直接用；沒有
 * 的話退回已經讀到的驗收清單路徑（`acceptance-<key>.md`）解析出 key，因為 `/review-triage`
 * 的呼叫端本來就是照驗收清單 meta 的 branch／任務名找到同一個 key（見
 * skills/review-triage/SKILL.md 的「主對話的準備」第 1 步）。兩邊都拿不到就回 undefined，
 * 呼叫端（hooks/review-triage-events.ts）當「沒有報告」處理，不猜。
 */
export function reviewTriageKey(missionName: string, acceptanceResolvedPath: string | undefined): string | undefined {
  const fromName = acceptanceKeyFromMissionName(missionName)
  if (fromName !== undefined) return fromName

  const match = acceptanceResolvedPath === undefined ? null : /acceptance-(.+)\.md$/.exec(acceptanceResolvedPath)
  return match?.[1]
}

/** Write／Edit 的 file_path 是不是在寫某份 review-triage 報告；不管哪個 key、哪一輪。 */
export function looksLikeReviewTriageReportWrite(filePath: string): boolean {
  return REPORT_FILE_PATH_PATTERN.test(filePath)
}

/** 這個任務已經讀到的 review-triage 報告裡，round 最大的那一份；還沒有任何報告就是 undefined。 */
export function latestReviewTriageReport(mission: Mission): ReviewTriageReportMeta | undefined {
  const reports = mission.reviewTriage?.reports ?? []
  return reports.reduce<ReviewTriageReportMeta | undefined>((best, report) => (best === undefined || report.round > best.round ? report : best), undefined)
}

const COUNT_LABELS: Record<keyof ReviewTriageCounts, string> = {
  confirmed: '確認',
  pending: '待驗證',
  withdrawn: '撤銷',
  defensive: '防禦性建議',
  premise: '前提',
}

/** band 顯示用的計數摘要（例如「確認 2／待驗證 1／前提 1」），0 的類別不列；還沒有任何報告就是 undefined。 */
export function reviewTriageCountsDetail(mission: Mission): string | undefined {
  const latest = latestReviewTriageReport(mission)
  if (latest === undefined) return undefined
  const parts = (Object.keys(COUNT_LABELS) as (keyof ReviewTriageCounts)[])
    .filter(key => latest.counts[key] > 0)
    .map(key => `${COUNT_LABELS[key]} ${latest.counts[key]}`)
  return parts.length === 0 ? undefined : parts.join('／')
}

/** band 要不要把這個節點畫成黃字警示：最新一份報告的 warn 是 true。 */
export function reviewTriageWarn(mission: Mission): boolean {
  return latestReviewTriageReport(mission)?.warn === true
}

/** 每個回饋討論串別人最後一則 note 的 id；沒有待判定的 note 就是空陣列。 */
function pendingOtherNoteIds(mission: Mission): readonly number[] {
  return (mission.review?.discussions ?? [])
    .filter(d => d.isFeedback && !d.resolved)
    .flatMap(d => (d.lastOtherNoteId === undefined ? [] : [d.lastOtherNoteId]))
}

const NO_PENDING_FEEDBACK_SKIP_REASON = '沒有待處理的回饋留言，不用判定'

/** skipWhen：沒有任何一則回饋討論帶著別人的 note，就沒有東西要判定，自動顯示成已跳過。 */
export function reviewTriageSkipReason(mission: Mission): string | undefined {
  return pendingOtherNoteIds(mission).length === 0 ? NO_PENDING_FEEDBACK_SKIP_REASON : undefined
}

/**
 * review-triage：每個回饋討論串別人最後一則 note 的 id，都要被某一份報告 meta 的 notes
 * 涵蓋——不限最新一份，不同輪次各自判定了不同的 note，只要曾經被哪一份報告判過就算，
 * 不比時間戳：GitLab note id 全站單調遞增，比它就夠（跟 hooks/review-stage.ts 的
 * hasNewOtherNotes 同一套理由）。沒有任何待判定的 note 就直接算完成，配合 skipWhen，這種
 * 情況本來就會顯示成已跳過。detail 不管做完沒做完都顯示最新一份報告的計數摘要，跟
 * evaluateAcceptanceRunDoneWhen 同一套「隨時看得到進度」原則。
 */
export function evaluateReviewTriageDoneWhen(mission: Mission): DoneWhenResult {
  const pending = pendingOtherNoteIds(mission)
  const detail = reviewTriageCountsDetail(mission)
  if (pending.length === 0) return { done: true, detail }

  const covered = new Set<number>()
  for (const report of mission.reviewTriage?.reports ?? []) {
    for (const id of report.notes) covered.add(id)
  }

  return { done: pending.every(id => covered.has(id)), detail }
}
