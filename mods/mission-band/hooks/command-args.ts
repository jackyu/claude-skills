// /mission-* 指令的引數解析：純文字處理，不碰 Mission／Missions，跟 model.ts 分開放
// 避免 model.ts 繼續長下去。

const ISSUE_PATTERN = /^#?(\d+)$/

// 純數字或 #數字 一律當 issue 號，統一寫成 #473，讓 /mission-restore 473 和 #473 對到同一個任務。
export function normalizeLabel(label: string): string {
  const match = ISSUE_PATTERN.exec(label)
  return match === null ? label : `#${match[1]}`
}

function datePrefix(now: number): string {
  const date = new Date(now)
  return `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

export type ParsedStart = { name: string } | { error: string }

/** 任務名稱是「MMDD-#issue」或「MMDD-名稱」，日期取下指令當天。 */
export function parseStartArgs(args: string, now: number): ParsedStart {
  const label = args.trim()
  if (label === '') return { error: '用法：/mission-start #<issue 號>；沒有 issue 就 /mission-start <名稱>' }
  if (/\s/.test(label)) return { error: '名稱不能有空白，可以用 - 或 _ 連起來' }
  return { name: `${datePrefix(now)}-${normalizeLabel(label)}` }
}

export type ParsedSkip = { nodeId: string; reason: string } | { error: string }

export function parseSkipArgs(args: string): ParsedSkip {
  const trimmed = args.trim()
  const spaceIndex = trimmed.indexOf(' ')
  if (trimmed === '' || spaceIndex === -1) return { error: '用法：/mission-skip <nodeId>[:<track>] <理由>' }
  const nodeId = trimmed.slice(0, spaceIndex)
  const reason = trimmed.slice(spaceIndex + 1).trim()
  if (reason === '') return { error: '用法：/mission-skip <nodeId>[:<track>] <理由>' }
  return { nodeId, reason }
}

export type ParsedRestore = { name: string } | { error: string }

export function parseRestoreArgs(args: string): ParsedRestore {
  const name = args.trim()
  if (name === '') return { error: '用法：/mission-restore #<issue 號> 或 <名稱>' }
  return { name }
}

export type ParsedFinish = { name?: string; force: boolean }

export function parseFinishArgs(args: string): ParsedFinish {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const force = tokens.includes('--force')
  const name = tokens.find(token => token !== '--force')
  return { name, force }
}
