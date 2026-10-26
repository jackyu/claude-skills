// hooks/acceptance.ts 的純函式接到 $：找到驗收清單檔（直接拼 key，或掃 .claude/specs 配
// meta.mission）、讀檔、寫回任務的精簡摘要。跟 register.tsx 分開放，讓 register.tsx 專心做
// hook 註冊（products.ts 已經 398 行，新邏輯不往那裡疊，見 node-states.ts 的 evaluateDoneWhenAny）。
import type { EngineInterface } from 'claude-code'

import type { AcceptanceOverall, MissionAcceptance } from '../types'
import {
  acceptanceKeyFromMissionName,
  acceptancePath,
  isAcceptanceFileName,
  isExcludedFromTotal,
  isSpecStale,
  looksLikeAcceptanceFileWrite,
  looksLikeWorktreeAcceptanceFileWrite,
  parseAcceptance,
  parseAcceptanceMeta,
  pickAcceptanceFileForMission,
} from './acceptance'
import { findBoundMission } from './model'
import { currentBinding, loadMissions, mutate, runStep } from './store'

const SPECS_DIR_NAME = '.claude/specs'

type Resolved = { path: string; text: string }

/** 任務名裡有 #<數字> 的候選檔案讀不到也不是這個任務自己的（exists 回 false，已經是終局）就不用快取。 */
async function resolveViaKey($: EngineInterface, path: string): Promise<Resolved | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  // 檔案確認存在之後再讀；這裡丟出去的例外不吞，交給呼叫端既有的 runStep 記 log。
  return { path, text: await $.fs.read(path) }
}

/**
 * 掃一輪前先試快取的檔名：meta.mission 還對得上這個任務名就直接用，省掉重新 $.fs.list
 * 整個目錄＋逐一讀每個候選檔案。快取失效（檔案被刪、改名，或 meta.mission 換了）就回
 * undefined，讓呼叫端照常掃一次——不是錯誤，只是快取沒打中。
 */
async function tryCachedPath($: EngineInterface, cachedPath: string, missionName: string): Promise<Resolved | undefined> {
  try {
    if (!(await $.fs.exists(cachedPath))) return undefined
    const text = await $.fs.read(cachedPath)
    return parseAcceptanceMeta(text).mission === missionName ? { path: cachedPath, text } : undefined
  } catch {
    return undefined
  }
}

/** 掃 `.claude/specs` 配 meta.mission 等於這個任務名的那一份；目錄不存在、或掃完沒配到都回 undefined，不算錯誤。 */
async function scanForMission($: EngineInterface, repoRoot: string, missionName: string): Promise<Resolved | undefined> {
  const specsDir = `${repoRoot}/${SPECS_DIR_NAME}`
  let entries
  try {
    entries = await $.fs.list(specsDir)
  } catch {
    return undefined
  }

  const candidates: { name: string; text: string }[] = []
  for (const entry of entries) {
    if (!isAcceptanceFileName(entry.name)) continue
    try {
      candidates.push({ name: entry.name, text: await $.fs.read(`${specsDir}/${entry.name}`) })
    } catch {
      continue
    }
  }

  const picked = pickAcceptanceFileForMission(candidates, missionName)
  const match = picked === undefined ? undefined : candidates.find(candidate => candidate.name === picked)
  return match === undefined ? undefined : { path: `${specsDir}/${match.name}`, text: match.text }
}

/**
 * 直接拼 `acceptance-<數字>.md`（任務名裡有 #<數字>），或先試快取的檔名、沒打中再掃
 * `.claude/specs` 配 meta.mission；單個候選檔案讀失敗就跳過，不中斷整個掃描。
 */
async function resolveAcceptance($: EngineInterface, repoRoot: string, missionName: string, cachedPath: string | undefined): Promise<Resolved | undefined> {
  const key = acceptanceKeyFromMissionName(missionName)
  if (key !== undefined) return resolveViaKey($, acceptancePath(repoRoot, key))

  if (cachedPath !== undefined) {
    const cached = await tryCachedPath($, cachedPath, missionName)
    if (cached !== undefined) return cached
  }

  return scanForMission($, repoRoot, missionName)
}

function toSummary(resolved: Resolved | undefined, now: number): MissionAcceptance {
  if (resolved === undefined) return { exists: false, readAt: now }
  const { meta, items, counts, overall } = parseAcceptance(resolved.text)
  // 跟 computeCounts 用同一條「排除在 total 外」規則，已刪除的 AC 不會被 MR Evidence
  // 檢查要求補截圖（只看標題的「（已刪除）」會漏掉只改了結果欄的情況）。
  const acIds = items.filter(item => !isExcludedFromTotal(item)).map(item => item.id)
  return { exists: true, counts, overall, metaSpec: meta.spec, metaSpecMtime: meta.specMtime, resolvedPath: resolved.path, acIds, readAt: now }
}

/** meta.spec 現在的 mtime 比 meta.specMtime 晚（見 isSpecStale）；spec 是 null／沒有，或查不到（檔案被刪）都不算改過。 */
async function computeSpecStale($: EngineInterface, repoRoot: string, metaSpec: string | null | undefined, metaSpecMtime: string | undefined): Promise<boolean> {
  if (metaSpec === null || metaSpec === undefined) return false
  try {
    const stat = await $.fs.stat(`${repoRoot}/${SPECS_DIR_NAME}/${metaSpec}`)
    return isSpecStale(stat.mtimeMs, metaSpecMtime)
  } catch {
    return false
  }
}

const MIN_TRUSTED_SHA_LENGTH = 7
const TRAILING_ELLIPSIS_PATTERN = /(?:…|\.{3})$/

/** 去掉清單記錄的 sha 尾端可能有的省略符號（… 或 ...）——有些畫面或手動記錄會把長 sha 截斷顯示。 */
function stripTrailingEllipsis(sha: string): string {
  return sha.replace(TRAILING_ELLIPSIS_PATTERN, '')
}

/**
 * 記錄的 sha 跟目前 HEAD 是不是不一樣。format.md 現在要求整體回歸記滿 40 字的完整 sha，
 * 但手改或舊清單可能留著縮寫版（含尾端省略符號）；只要還有 ≥7 個字元（git 短 sha 慣例
 * 的下限）就用 head.startsWith(sha) 比對，不要求字數對齊——40 字的完整 sha 用這個比對
 * 等同原本的全等比較。短到連 7 個字元都不到就不夠可靠，直接當作沒變：跟這個檔案其他
 * 「查不到就相信舊紀錄」的保守原則一致，貿然判定過期只會錯誤擋住 overall-regression。
 */
export function shaDiffers(recordedSha: string, headSha: string): boolean {
  const recorded = stripTrailingEllipsis(recordedSha)
  if (recorded.length < MIN_TRUSTED_SHA_LENGTH) return false
  return !headSha.startsWith(recorded)
}

/**
 * 整體回歸記的 sha 跟 worktree 現在的 HEAD 是不是不一樣；只有 overall.status 是「通過」、
 * 任務有 worktreePath、清單也真的記了 sha 才查。git 查不到（process.run 失敗、worktree
 * 目錄不見了）當作沒有過期，相信清單記錄的狀態——跟 maybeUpdateBranchCommits 查不到
 * commit 時不清空既有快照是同一個保守原則：查不到不代表「換了」，貿然判定過期只會錯誤
 * 擋住 overall-regression，比相信舊記錄更糟。
 */
async function computeOverallStale($: EngineInterface, worktreePath: string | undefined, overall: AcceptanceOverall): Promise<boolean> {
  if (overall.status !== '通過' || worktreePath === undefined || overall.sha === undefined) return false
  try {
    const result = await $.process.run(['git', '-C', worktreePath, 'rev-parse', 'HEAD'])
    if (result.exitCode !== 0) return false
    return shaDiffers(overall.sha, result.stdout.trim())
  } catch {
    return false
  }
}

/** 比較「內容」是否一樣，忽略 readAt（每次刷新都會變，不該因為它而觸發一次沒必要的 store 寫入）。 */
// toSummary 產出的 b 一定沒有 lastReadError（只有 recordReadFailure 會寫這欄）；a 若曾經
// 失敗過、留著舊的 lastReadError，這次成功讀到內容也要算「變了」才會真的寫進 store，
// 把 lastReadError 清掉——不然下次發生一樣的錯誤，recordReadFailure 會誤以為「跟上次
// 一樣」而不記 log，但中間其實已經成功過一次，該當成新的一次失敗。
function sameContent(a: MissionAcceptance | undefined, b: MissionAcceptance): boolean {
  if (a === undefined) return false
  return (
    a.exists === b.exists &&
    a.metaSpec === b.metaSpec &&
    a.metaSpecMtime === b.metaSpecMtime &&
    a.resolvedPath === b.resolvedPath &&
    a.lastReadError === b.lastReadError &&
    a.specStale === b.specStale &&
    a.overallStale === b.overallStale &&
    JSON.stringify(a.counts) === JSON.stringify(b.counts) &&
    JSON.stringify(a.overall) === JSON.stringify(b.overall) &&
    JSON.stringify(a.acIds) === JSON.stringify(b.acIds)
  )
}

/**
 * 讀檔失敗（通常是 resolveViaKey 確認存在之後、真的讀的那一步，例如權限問題）寫回
 * 一筆記錄錯誤訊息的摘要，且只在訊息跟上次不同時才 $.ui.log——同一個錯誤持續發生時
 * （例如權限一直沒修好），每個 turn 都記一次會洗版，記過一次就夠了；訊息變了（換成
 * 別的錯誤，或之後成功了）才需要使用者再注意一次。是否要寫 store 的判斷在 mutate
 * 回呼裡重新比對一次（用當下讀到的 missions，不是呼叫端傳入時的舊快照）。
 */
async function recordReadFailure(
  $: EngineInterface,
  binding: string,
  mission: { acceptance?: MissionAcceptance },
  now: number,
  error: unknown,
): Promise<void> {
  const message = `讀取驗收清單失敗：${String(error)}`
  if (mission.acceptance?.lastReadError !== message) $.ui.log(`mission-band: ${message}`)

  await mutate($, missions => {
    const bound = findBoundMission(missions, binding)
    if (bound === undefined) return missions
    const [name, m] = bound
    if (m.acceptance?.lastReadError === message) return missions
    return { ...missions, [name]: { ...m, acceptance: { ...(m.acceptance ?? { exists: false }), lastReadError: message, readAt: now } } }
  })
}

/**
 * 刷新綁在這個 binding 的任務的驗收清單摘要。沒有任務綁在這裡、或 session.repo() 查不到主
 * checkout（在 worktree 外、沒有 repo）都直接放過——驗收清單只認主 checkout 的路徑。
 * 內容沒變就不寫 store（只有 readAt 會變，不算真的變），任務資料是跨 session 共用的，
 * 每個 turn 都無條件寫一次會白白墊高跟其他 session 同時寫入時互相蓋掉的機率。
 * 讀檔本身失敗（跟「還沒跑過 /to-acceptance」不同）在這裡接住並記 log，不讓它往外丟給
 * 呼叫端的 runStep——那樣每個 turn 都會重新記一次一樣的失敗，見 recordReadFailure。
 */
export async function maybeRefreshAcceptance($: EngineInterface, binding: string): Promise<void> {
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined) return
  const [, mission] = bound

  const repo = await $.session.repo()
  if (repo === null) return

  const now = await $.clock.now()
  let resolved: Resolved | undefined
  try {
    resolved = await resolveAcceptance($, repo.root, mission.name, mission.acceptance?.resolvedPath)
  } catch (error) {
    await recordReadFailure($, binding, mission, now, error)
    return
  }

  let summary = toSummary(resolved, now)
  if (summary.exists) {
    // 兩個 stale 檢查都要碰 $.fs／$.process，刻意放在算完 summary 之後、寫 store 之前
    // 一次做完（refresh 時），不是等畫面要畫的那一刻才查——band 只負責讀已經算好的
    // boolean，不自己發 I/O。
    const specStale = await computeSpecStale($, repo.root, summary.metaSpec, summary.metaSpecMtime)
    const overallStale = summary.overall === undefined ? false : await computeOverallStale($, mission.worktreePath, summary.overall)
    summary = { ...summary, specStale, overallStale }
  }

  await mutate($, missions => {
    const bound2 = findBoundMission(missions, binding)
    if (bound2 === undefined) return missions
    const [name, m] = bound2
    if (sameContent(m.acceptance, summary)) return missions
    return { ...missions, [name]: { ...m, acceptance: summary } }
  })
}

/**
 * Write／Edit 工具呼叫的驗收清單處理：寫到 worktree 自己那份 .claude/worktrees/<name>/
 * .claude/specs/ 底下是寫錯位置（resolveAcceptancePath 只認主 checkout），提醒一句就好，
 * 不用再觸發一次刷新——刷新也刷不到剛寫的這份；寫到主 checkout 的那份才刷新；寫到不相關
 * 的檔案什麼都不做。包一層 runStep 隔離未預期的錯誤，跟 register.tsx 其他 tool.call
 * hook 的用法一致（這段邏輯放這裡而不是 register.tsx 本身，是因為 hooks 模組規定 $
 * 只能在呼叫現場直接 $.noun.event(...)，不能傳給模組裡的區域函式；這裡不是 hooks 模組
 * 本身，只是被它 import，所以可以照一般函式寫）。
 */
export async function handleAcceptanceFileWrite($: EngineInterface, filePath: string): Promise<void> {
  if (looksLikeWorktreeAcceptanceFileWrite(filePath)) {
    $.ui.log(`mission-band: 「${filePath}」寫在 worktree 底下，驗收清單只認主 checkout 的 .claude/specs/，搬過去才會被讀到`)
    return
  }
  if (!looksLikeAcceptanceFileWrite(filePath)) return
  await runStep($, '驗收清單刷新', async () => maybeRefreshAcceptance($, await currentBinding($)))
}
