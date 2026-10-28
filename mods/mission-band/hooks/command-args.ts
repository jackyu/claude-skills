// /mission-* 指令的引數解析：純文字處理，不碰 Mission／Missions，跟 model.ts 分開放
// 避免 model.ts 繼續長下去。

import type { RemoteProjectPath } from './assets'

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

const URL_PATTERN = /^https?:\/\//
const ISSUE_URL_PATTERN = /^https?:\/\/(?:[^@/]*@)?([^/]+)\/(.+?)\/-\/(?:issues|work_items)\/(\d+)(?:[/?#].*)?$/

type ParsedLabel = { label: string } | { error: string }

// 貼 issue 網址時轉成 #<n>；別的專案的票轉成 #<n> 會拿這個 repo 的 remote 組出錯的連結，所以擋下。
function labelFromArg(arg: string, ownProject: RemoteProjectPath | undefined): ParsedLabel {
  if (!URL_PATTERN.test(arg)) return { label: normalizeLabel(arg) }

  const match = ISSUE_URL_PATTERN.exec(arg)
  if (match === null) return { error: '網址只收 GitLab issue 或 work item，其他請改打 #<issue 號> 或自己取名' }
  const [, , path = '', iid = ''] = match
  if (ownProject === undefined) return { error: `讀不到這個 repo 的 remote，沒辦法確認網址是不是這個專案的票，請改打 #<issue 號>（#${iid}）` }

  // 只比專案路徑：remote 可能是 ssh config 的別名或帶 port，host 跟網頁網址對不上。
  if (path.toLowerCase() !== ownProject.path.toLowerCase()) {
    const project = path.split('/').at(-1) ?? path
    return { error: `這是 ${project} 的票，不是這個 repo 的。請改用前端 RD 票號（#<issue 號>），或自己取名` }
  }
  return { label: `#${iid}` }
}

function checkLabel(label: string): string | undefined {
  if (/\s/.test(label)) return '名稱不能有空白，可以用 - 或 _ 連起來'
  return undefined
}

export type ParsedStart = { name: string } | { error: string }

/** 任務名稱是「MMDD-#issue」或「MMDD-名稱」，日期取下指令當天；貼這個 repo 的 issue 網址等同打 #issue。 */
export function parseStartArgs(args: string, now: number, ownProject?: RemoteProjectPath): ParsedStart {
  const arg = args.trim()
  if (arg === '') return { error: '用法：/mission-start #<issue 號>；沒有 issue 就 /mission-start <名稱>' }
  const spaceError = checkLabel(arg)
  if (spaceError !== undefined) return { error: spaceError }
  const parsed = labelFromArg(arg, ownProject)
  if ('error' in parsed) return parsed
  return { name: `${datePrefix(now)}-${parsed.label}` }
}

export type ParsedRename = { query: string; label: string } | { error: string }

const RENAME_USAGE = '用法：/mission-rename <目前名稱或 #issue> <新的 #issue、issue 網址或名稱>'

export function parseRenameArgs(args: string, ownProject?: RemoteProjectPath): ParsedRename {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const [query, target] = tokens
  if (tokens.length !== 2 || query === undefined || target === undefined) return { error: RENAME_USAGE }
  const parsed = labelFromArg(target, ownProject)
  if ('error' in parsed) return parsed
  return { query, label: parsed.label }
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
