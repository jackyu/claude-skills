// worktree 路徑偵測的純函式層：從 Bash 指令或 orca 的 stdout 解析出路徑字串。拆出 products.ts
// （products.ts 加這段會超過 400 行），不碰 $——實際驗證「是不是真的 worktree 根目錄」要問 git，
// 那段在 hooks/worktree-events.ts。
import { splitBashSegments, tryParseJson } from './products'

const ORCA_WORKTREE_CREATE_PATTERN = /\borca\s+worktree\s+create\b/
// -C 的值跟 cd 的目標都可能加引號（路徑帶空白），三種寫法（雙引號／單引號／不加引號）都要接。
const GIT_WORKTREE_ADD_SEGMENT_PATTERN = /^git(?:\s+-C\s+(?:"([^"]*)"|'([^']*)'|(\S+)))?\s+worktree\s+add\b(.*)$/
const CD_COMMAND_PATTERN = /^cd\s+(?:"([^"]*)"|'([^']*)'|(\S+))/
// git worktree add -h：只有 -b／-B／--reason 吃值，其餘（--detach、--orphan、--lock...）都是純旗標。
const VALUE_TAKING_FLAGS = new Set(['-b', '-B', '--reason'])

function stripSurroundingQuotes(token: string): string {
  const isQuoted = token.length >= 2 && ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"')))
  return isQuoted ? token.slice(1, -1) : token
}

/** 片段開頭是不是 `cd <目標>`；目標可能加引號，三個 capture group 哪個有值就是哪個。 */
function cdTargetOf(segment: string): string | undefined {
  const match = CD_COMMAND_PATTERN.exec(segment)
  return match === null ? undefined : match[1] ?? match[2] ?? match[3]
}

/** Bash 指令是不是在跑 `orca worktree create`；真正的路徑要等 stdout 回來才知道。 */
export function looksLikeOrcaWorktreeCreateCommand(command: string): boolean {
  return ORCA_WORKTREE_CREATE_PATTERN.test(command)
}

// 引號外遇到這些字元就斷 token：子 shell 的括號、跟值黏在一起的重導向。
const UNQUOTED_TOKEN_BREAKS = new Set(['(', ')', '<', '>'])

/** 照 shell 引號規則切 token、拿掉引號；引號裡的空白或 `--name` 不會被拆出來。 */
function shellTokens(segment: string): string[] {
  const tokens: string[] = []
  let current: string | undefined
  let quote: string | undefined
  for (const char of segment) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current = (current ?? '') + char
    } else if (char === '"' || char === "'") {
      quote = char
      current ??= ''
    } else if (/\s/.test(char) || UNQUOTED_TOKEN_BREAKS.has(char)) {
      if (current !== undefined) tokens.push(current)
      current = undefined
    } else {
      current = (current ?? '') + char
    }
  }
  if (current !== undefined) tokens.push(current)
  return tokens
}

/**
 * `orca worktree create --name <X>` 的 X（orca 會用它當分支名）。stdout 被導進檔案、或沒加
 * --json 時讀不到路徑，呼叫端靠這個名字去 `git worktree list` 找；只看 orca worktree create
 * 那個片段，別的指令的 --name 不算。
 */
export function orcaWorktreeCreateNameFromCommand(command: string): string | undefined {
  for (const rawSegment of splitBashSegments(command)) {
    const segment = rawSegment.trim()
    if (!ORCA_WORKTREE_CREATE_PATTERN.test(segment)) continue
    const tokens = shellTokens(segment)
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]
      if (token === '--name') return tokens[i + 1]
      if (token?.startsWith('--name=')) return token.slice('--name='.length)
    }
  }
  return undefined
}

/** 從 `git worktree list --porcelain` 找分支剛好是 branch 的那個 worktree 路徑。 */
export function worktreePathForBranchFromPorcelain(porcelain: string, branch: string): string | undefined {
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    if (path !== undefined && lines.includes(`branch refs/heads/${branch}`)) return path
  }
  return undefined
}

/** orca 的 worktree 物件本身有 `path`；沒有才從 `id`（格式 `<repoId>::<絕對路徑>`）切出來。 */
function orcaWorktreePathFromObj(worktree: Record<string, unknown>): string | undefined {
  const path = worktree.path
  if (typeof path === 'string') return path
  const id = worktree.id
  if (typeof id !== 'string') return undefined
  const sep = id.indexOf('::')
  return sep === -1 ? undefined : id.slice(sep + 2)
}

/**
 * `orca ... --json` 的真實輸出是一份信封：`{ id, ok, result: { worktree: {...} } }`
 * （用 `orca worktree current --json` 驗過）；先看 `result.worktree`，退回頂層的 `worktree`
 * （以防某個 orca 子指令沒有 `result` 包一層）。整段不是 JSON 時，從最後一行往回找單獨一行的
 * 信封（前面可能有 `echo "exit=$?"` 之類的輸出）；都找不到 worktree 物件就不猜。
 */
export function orcaWorktreeCreatePathFromStdout(stdout: string): string | undefined {
  const candidates = [stdout.trim(), ...stdout.split('\n').map(line => line.trim()).filter(Boolean).reverse()]
  for (const candidate of candidates) {
    const path = orcaWorktreePathFromJson(candidate)
    if (path !== undefined) return path
  }
  return undefined
}

function orcaWorktreePathFromJson(text: string): string | undefined {
  const parsed = tryParseJson(text)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const obj = parsed as Record<string, unknown>

  const result = obj.result
  if (typeof result === 'object' && result !== null) {
    const worktree = (result as Record<string, unknown>).worktree
    if (typeof worktree === 'object' && worktree !== null) {
      const path = orcaWorktreePathFromObj(worktree as Record<string, unknown>)
      if (path !== undefined) return path
    }
  }

  const worktree = obj.worktree
  return typeof worktree === 'object' && worktree !== null ? orcaWorktreePathFromObj(worktree as Record<string, unknown>) : undefined
}

function firstPositionalToken(rest: string): string | undefined {
  const tokens = rest.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === undefined) continue
    if (VALUE_TAKING_FLAGS.has(token)) {
      i += 1
      continue
    }
    if (token.startsWith('-')) continue
    return stripSurroundingQuotes(token)
  }
  return undefined
}

/**
 * 掃過整個指令的每個片段（照 && / || / ; / | 切開、trim 過）：追蹤目前的 cd 目錄，遇到片段
 * 開頭就是 `git [-C <dir>] worktree add <path>`（不是任何位置——echo／grep 裡剛好出現這段
 * 文字不算）才解析路徑：相對路徑先看這段自己的 `-C <dir>`，沒有就看同一串指令裡前面的 cd
 * 絕對路徑，都沒有才用 sessionRoot 補。是不是真的建出一個合法的 worktree 交給呼叫端用
 * git -C <path> rev-parse 驗（這裡只負責從指令字串解析出「打算」記的路徑）。
 */
export function gitWorktreeAddPathFromCommand(command: string, sessionRoot: string): string | undefined {
  let cwd: string | undefined

  for (const rawSegment of splitBashSegments(command)) {
    const segment = rawSegment.trim()

    const cdTarget = cdTargetOf(segment)
    if (cdTarget !== undefined) {
      if (cdTarget.startsWith('/')) cwd = cdTarget
      continue
    }

    const match = GIT_WORKTREE_ADD_SEGMENT_PATTERN.exec(segment)
    if (match === null) continue
    const cDir = match[1] ?? match[2] ?? match[3]
    const rawPath = firstPositionalToken(match[4] ?? '')
    if (rawPath === undefined) continue
    if (rawPath.startsWith('/')) return rawPath

    const base = cDir ?? cwd ?? sessionRoot
    return `${base}/${rawPath}`
  }

  return undefined
}

/**
 * `cd <目標>` 片段，且路徑落在 repoRoot 底下的 `.claude/worktrees/` 或 `.worktrees/`；
 * 這只是字串層的候選路徑，是不是真的 worktree 根目錄交給呼叫端用 git 驗（任意深度的子目錄都接受，
 * 例如 orca 的 `.claude/worktrees/<repo>/<branch>` 兩層巢狀，或 cd 進 worktree 底下的子目錄）。
 */
export function cdWorktreeCandidatePath(command: string, repoRoot: string): string | undefined {
  const prefixes = [`${repoRoot}/.claude/worktrees/`, `${repoRoot}/.worktrees/`]
  for (const rawSegment of splitBashSegments(command)) {
    const raw = cdTargetOf(rawSegment.trim())
    if (raw === undefined) continue
    const path = raw.replace(/\/+$/, '')
    if (prefixes.some(prefix => path.startsWith(prefix))) return path
  }
  return undefined
}
