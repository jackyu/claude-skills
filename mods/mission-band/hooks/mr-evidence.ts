// MR 描述裡 Evidence 段落，跟驗收清單的 AC id 對照的純函式層；products.ts 已經 398 行，
// 貼著 400 行上限，這裡的邏輯夠獨立（找 Evidence 段落、算組合後的 open-mr detail 文字），
// 不疊進那個檔案，改成單獨一份。
import type { Mission, MissionEvent } from '../types'
import type { DoneWhenResult } from './products'

// Markdown 的 ATX 標題規則要求 # 後面接空白才算標題（CommonMark）；用 \s* 的話「#473
// 測試紀錄」這種提到 issue 編號的句子會被誤判成 level-1 標題，提早結束 Evidence 段落。
const HEADING_LEVEL_PATTERN = /^(#{1,6})\s/
// 標題要去掉 emoji／空白後「以 Evidence 開頭、接著是單字邊界」才算，避免「## 關聯 Evidence
// 討論」這種只是提到 Evidence 字樣的標題被誤認成段落本身，也避免「## Evidences」這種接續
// 別的字的標題被誤判。
const EVIDENCE_HEADING_PATTERN = /^#+\s*(?:\p{Extended_Pictographic}\s*)*Evidence\b/u
const FENCE_PATTERN = /^```/

/** 掃過每一行，標記它是不是落在 ``` 圍起來的程式碼區塊裡（圍籬那一行本身也算在區塊內）。 */
function fenceFlags(lines: readonly string[]): boolean[] {
  const flags: boolean[] = []
  let inFence = false
  for (const line of lines) {
    const isFenceLine = FENCE_PATTERN.test(line.trim())
    if (isFenceLine) inFence = !inFence
    flags.push(inFence || isFenceLine)
  }
  return flags
}

/** 這一行是不是標題行，回它的層級（# 的數量）；在程式碼區塊裡或不是標題就回 undefined。 */
function headingLevel(line: string, inFence: boolean): number | undefined {
  if (inFence) return undefined
  const match = HEADING_LEVEL_PATTERN.exec(line.trim())
  return match === null ? undefined : (match[1] ?? '').length
}

/**
 * MR 描述裡 Evidence 段落的內文：從 Evidence 標題下一行開始，到下一個「層級 ≤ Evidence 標題
 * 層級」的標題為止（或文件結尾）。Evidence 底下常見的子標題（例如 ### AC-1）層級比它深，
 * 算內文，不會讓段落提早結束變成空的；``` 區塊裡的 # 開頭行不算標題。找不到 Evidence 標題
 * 就回 undefined——跟「寫了但完全沒提到某個 AC」不是同一件事，呼叫端自己決定怎麼處理。
 */
function evidenceSectionText(description: string): string | undefined {
  const lines = description.split(/\r?\n/)
  const inFenceFlags = fenceFlags(lines)

  const startIndex = lines.findIndex((line, index) => !inFenceFlags[index] && EVIDENCE_HEADING_PATTERN.test(line.trim()))
  if (startIndex === -1) return undefined
  const evidenceLevel = headingLevel(lines[startIndex] ?? '', false)
  if (evidenceLevel === undefined) return undefined

  const endOffset = lines
    .slice(startIndex + 1)
    .findIndex((line, offset) => (headingLevel(line, inFenceFlags[startIndex + 1 + offset] ?? false) ?? Infinity) <= evidenceLevel)
  const endIndex = endOffset === -1 ? lines.length : startIndex + 1 + endOffset
  return lines.slice(startIndex + 1, endIndex).join('\n')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 驗收清單裡（非已刪除的）AC id，在 MR 描述的 Evidence 段落裡完全沒提到的那些。MR 描述裡
 * 根本沒有 Evidence 段落就回空陣列——那種情況 missingSections 已經會報「缺 Evidence」，
 * 不用這裡重複報每一條 AC 都缺，兩邊疊起來只會讓訊息更難懂。id 後面要是數字邊界（不能緊接
 * 著數字），避免 AC-1 被 AC-10 誤判成「有提到」。
 */
export function missingAcIdsInEvidence(description: string, acIds: readonly string[]): string[] {
  if (acIds.length === 0) return []
  const evidenceText = evidenceSectionText(description)
  if (evidenceText === undefined) return []
  return acIds.filter(id => !new RegExp(`${escapeRegExp(id)}(?!\\d)`).test(evidenceText))
}

/** open-mr 的 detail：段落跟 AC 兩種缺的都有才各自換成數量講（38 字放不下兩份清單），單獨一種缺就維持原來的完整列法。 */
export function mrDoneWhenDetail(missingSections: readonly string[], missingAcs: readonly string[]): string | undefined {
  if (missingSections.length === 0 && missingAcs.length === 0) return undefined
  if (missingAcs.length === 0) return `缺 ${missingSections.join('、')}`
  if (missingSections.length === 0) return `Evidence 缺 ${missingAcs.join('、')}`
  return `缺 ${missingSections.length} 段、Evidence 缺 ${missingAcs.length} 條`
}

function latestMrEvent(mission: Mission, enteredAt: number): MissionEvent | undefined {
  const matches = mission.events.filter(event => event.at >= enteredAt && event.kind === 'product' && event.name === 'mr')
  return matches.at(-1)
}

/**
 * open-mr 節點的完成條件：取代 products.ts 的 evaluateDoneWhen 對 'mr' 的處理（那邊的版本
 * 還留著、還測得過，純粹是沒有 missingAcs 這個維度；這裡疊加 Evidence 缺的 AC id 一起算
 * detail）。node-states.ts 的 evaluateDoneWhenAny 攔在 products.ts 前面分派過來，
 * products.ts 本身不用改。
 */
export function evaluateMrDoneWhen(mission: Mission, enteredAt: number): DoneWhenResult {
  const event = latestMrEvent(mission, enteredAt)
  if (event === undefined) return { done: false }
  return { done: true, detail: mrDoneWhenDetail(event.missingSections ?? [], event.missingAcs ?? []) }
}
