// hooks/review-triage.ts 的純函式接到 $：找 `<main>/.claude/verify-evidence/<key>/` 目錄、
// 列出 review-triage-r*.md、讀每一份報告的第一行 meta、寫回任務的精簡清單。跟 register.tsx
// 分開放，理由跟 hooks/acceptance-events.ts 開頭註解一樣（register.tsx 貼著 400 行上限）。
import type { EngineInterface } from 'claude-code'

import type { MissionReviewTriage, ReviewTriageReportMeta } from '../types'
import { findBoundMission } from './model'
import { looksLikeReviewTriageReportWrite, parseReviewTriageMeta, reviewTriageKey } from './review-triage'
import { currentBinding, loadMissions, mutate, runStep } from './store'

const EVIDENCE_DIR_NAME = '.claude/verify-evidence'
const REPORT_FILE_PATTERN = /^review-triage-r\d+\.md$/

/** 列出 evidence 目錄底下所有 review-triage-r*.md；目錄不存在或列不出來都當沒有報告，不算錯誤。 */
async function listReportFiles($: EngineInterface, evidenceDir: string): Promise<string[]> {
  try {
    const entries = await $.fs.list(evidenceDir)
    return entries.filter(entry => entry.kind === 'file' && REPORT_FILE_PATTERN.test(entry.name)).map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * 逐份讀檔＋解析第一行 meta；單份讀失敗或格式不對就跳過那一份，不中斷整批（跟
 * acceptance-events.ts 的 scanForMission 同一套容錯原則）。
 */
async function readReports($: EngineInterface, evidenceDir: string, names: readonly string[]): Promise<{ reports: ReviewTriageReportMeta[]; malformed: string[] }> {
  const reports: ReviewTriageReportMeta[] = []
  const malformed: string[] = []
  for (const name of names) {
    let text: string
    try {
      text = await $.fs.read(`${evidenceDir}/${name}`)
    } catch {
      continue
    }
    const meta = parseReviewTriageMeta(text)
    if (meta === undefined) {
      malformed.push(name)
      continue
    }
    reports.push(meta)
  }
  return { reports, malformed }
}

/** 比較「內容」是否一樣：兩邊的報告清單與讀檔錯誤訊息都要一致，才不用真的寫 store。 */
function sameReports(a: MissionReviewTriage | undefined, b: MissionReviewTriage): boolean {
  if (a === undefined) return false
  return a.lastReadError === b.lastReadError && JSON.stringify(a.reports) === JSON.stringify(b.reports)
}

/**
 * 刷新綁在這個 binding 的任務的 review-triage 報告清單；跟 maybeRefreshAcceptance 同一套
 * 保守原則——讀不到 key 或目錄（還沒跑過 `/review-triage`，或這個任務沒有驗收清單可以推出
 * key）當「沒有報告」處理，不丟例外；單份報告格式壞掉只記一次 log，不中斷其他報告的解析，
 * 也不讓壞掉的一份拖垮整個刷新。
 */
export async function maybeRefreshReviewTriage($: EngineInterface, binding: string): Promise<void> {
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined) return
  const [, mission] = bound

  const repo = await $.session.repo()
  if (repo === null) return

  const key = reviewTriageKey(mission.name, mission.acceptance?.resolvedPath)
  if (key === undefined) return

  const evidenceDir = `${repo.root}/${EVIDENCE_DIR_NAME}/${key}`
  const names = await listReportFiles($, evidenceDir)
  const { reports, malformed } = await readReports($, evidenceDir, names)
  const lastReadError = malformed.length === 0 ? undefined : `review-triage 報告格式不對，忽略：${malformed.join('、')}`

  if (lastReadError !== undefined && mission.reviewTriage?.lastReadError !== lastReadError) $.ui.log(`mission-band: ${lastReadError}`)

  const summary: MissionReviewTriage = { reports, lastReadError }

  await mutate($, missions => {
    const bound2 = findBoundMission(missions, binding)
    if (bound2 === undefined) return missions
    const [name, m] = bound2
    if (sameReports(m.reviewTriage, summary)) return missions
    return { ...missions, [name]: { ...m, reviewTriage: summary } }
  })
}

/**
 * Write／Edit 工具呼叫的 review-triage 報告處理：不是在寫報告檔就什麼都不做；是的話刷新一次
 * 這個 binding 的任務（跟 acceptance-events.ts 的 handleAcceptanceFileWrite 同一種寫法，
 * 包一層 runStep 隔離未預期的錯誤）。
 */
export async function handleReviewTriageFileWrite($: EngineInterface, filePath: string): Promise<void> {
  if (!looksLikeReviewTriageReportWrite(filePath)) return
  await runStep($, 'review-triage 報告刷新', async () => maybeRefreshReviewTriage($, await currentBinding($)))
}
