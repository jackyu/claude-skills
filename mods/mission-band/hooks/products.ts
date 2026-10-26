// 從 Bash／Read 工具的輸入輸出判斷各種訊號的純函式層：pstack 讀檔、commit 快照、MR 網址與
// 段落檢查、issue 留言。不碰 $、也不碰 Missions——找到的訊號怎麼寫回任務由 register.tsx 決定
// （commit 快照整包覆蓋，mr／issue-note 用 model.ts 既有的 routeEvent 當一般事件記錄）。
import type { BranchCommit, DoneWhen, Mission, MissionEvent } from '../types'
import { classifyUrl, extractCandidateUrls, gitlabIid, gitlabProjectPath } from './assets'

// ===== pstack 讀檔比對 =====

const PSTACK_FILE_GLOBAL = /\/pstack\/[^/]+\/skills\/(?:poteto-mode\/playbooks\/([^/'"\s]+)\.md|([^/'"\s]+)\/SKILL\.md)/g

/** 同一段文字裡可能有好幾個 pstack 路徑（例如一行 cat 兩個檔案），全部找出來。 */
export function pstackReadNames(text: string): string[] {
  return [...text.matchAll(PSTACK_FILE_GLOBAL)].map(hit => (hit[1] ? `playbook:${hit[1]}` : `pstack:${hit[2]}`))
}

const READ_COMMAND_PREFIXES = ['cat', 'head', 'tail', 'less'] as const

// 指令片段先去掉包住整段的括號（子殼層 `(cmd)`）跟前面的環境變數賦值（FOO=bar cmd），
// 再切成 token；isReadStyleCommand 跟 codexCliReviewSegment 都要先知道片段「真正在跑的
// 指令」是什麼，共用這一步。
function commandTokens(segment: string): string[] {
  const withoutParens = segment.trim().replace(/^\(+\s*/, '').replace(/\s*\)+$/, '')
  const withoutEnv = withoutParens.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '')
  return withoutEnv.split(/\s+/).filter(Boolean)
}

// Bash 指令五花八門：grep／sed -i／ls 等指令的輸出或參數裡也可能恰好出現 pstack 路徑字串，
// 但那些不是「把檔案讀進來看」，只有 cat/head/tail/less 跟 sed -n 才算，其餘一律不計。
export function isReadStyleCommand(command: string): boolean {
  const tokens = commandTokens(command)
  const first = tokens[0]
  if (first === undefined) return false
  if (READ_COMMAND_PREFIXES.includes(first as (typeof READ_COMMAND_PREFIXES)[number])) return true
  if (first !== 'sed') return false
  return tokens.slice(1).some(token => token.startsWith('-') && !token.startsWith('--') && token.includes('n'))
}

// subagent 派工合約規定每個 Bash 都先 cd <絕對路徑>，所以實際指令常是
// `cd /abs && head -n 1 '<path>'`：要照 && / || / ; / | / & / 換行切開才看得出第二段是不是讀檔。
// 單獨一個 & 是背景執行的分隔符，跟 && 不一樣要切開；但 2>&1、&> 這種重導向裡的 &
// 不是分隔符，前者看前一個字元是不是 `>`、後者看下一個字元是不是 `>` 來排除。
// 引號內的分隔符不切（例如 sed 腳本或路徑裡剛好有分號），外面的就夠用了。
export function splitBashSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let i = 0

  while (i < command.length) {
    const ch = command[i]
    if (quote !== null) {
      current += ch
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      i += 1
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      segments.push(current)
      current = ''
      i += 2
      continue
    }
    if (two === '&>') {
      current += two
      i += 2
      continue
    }
    if (ch === '&') {
      if (command[i - 1] === '>') {
        // n>&m 這種重導向（例如 2>&1）裡的 &，不是背景分隔符。
        current += ch
        i += 1
        continue
      }
      segments.push(current)
      current = ''
      i += 1
      continue
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      segments.push(current)
      current = ''
      i += 1
      continue
    }
    current += ch
    i += 1
  }
  segments.push(current)

  return segments
}

/** 只從讀檔類的指令片段裡找 pstack 路徑；cd、grep 這類片段就算剛好含路徑字串也不算。 */
export function pstackReadsInBashCommand(command: string): string[] {
  return splitBashSegments(command).filter(isReadStyleCommand).flatMap(pstackReadNames)
}

const CODEX_CLI_SUBCOMMANDS = ['review', 'exec'] as const
// -m/--model、-c/--config、-p/--profile、-C/--cd、-s/--sandbox、-a/--ask-for-approval
// 都是吃值的 flag（空格分隔，不是 =），找子指令時要連同下一個 token 一起跳過。
const CODEX_VALUE_FLAGS = new Set(['-m', '--model', '-c', '--config', '-p', '--profile', '-C', '--cd', '-s', '--sandbox', '-a', '--ask-for-approval'])
const CODEX_HELP_FLAGS = new Set(['--help', '-h'])
const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/
// npx／time／sudo／command 都只是在前面多包一層，真正的指令是後面那個；env 比較特別，
// 自己也會帶幾個 VAR=val 參數，所以另外處理。這幾個 runner 自己也可能帶 flag
// （npx -y、env -i），跟著一起剝掉，不然會被誤判成 codex 本身的 flag。
const CODEX_RUNNER_PREFIXES = new Set(['npx', 'time', 'sudo', 'command'])

/** 剝掉 npx／time／sudo／command／env（含它們自己的 flag 跟 env 帶的 VAR=val）這類包在 codex 前面的 runner，剩下真正要跑的指令。 */
function stripCodexRunnerPrefixes(tokens: readonly string[]): readonly string[] {
  let rest = tokens
  for (;;) {
    const first = rest[0]
    if (first === undefined) return rest
    if (CODEX_RUNNER_PREFIXES.has(first)) {
      rest = rest.slice(1)
      while (rest[0] !== undefined && rest[0].startsWith('-')) rest = rest.slice(1)
      continue
    }
    if (first === 'env') {
      rest = rest.slice(1)
      while (rest[0] !== undefined && (rest[0].startsWith('-') || ENV_ASSIGNMENT_PATTERN.test(rest[0]))) rest = rest.slice(1)
      continue
    }
    return rest
  }
}

// 單獨一個 `-` 是 codex 自己「從 stdin 讀」的慣例寫法，不是 flag——跟其他 `-x`／`--xxx` 不一樣，
// 遇到它要當成 positional 參數處理，不是跳過不看。
function isCodexFlagToken(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

/**
 * 在 codex 後面的 token 流裡找子指令，同時掃描 --help／-h：
 * - 子指令之前的 flag（含吃值的 -m/--model 等）都先跳過；第一個不是 flag 的 token 就是子指令。
 * - 子指令之後繼續掃，但只掃它自己的 flag；一碰到第一個不是 flag 的 token（positional 參數，
 *   例如用引號包起來的 prompt，或代表 stdin 的單獨 `-`）就停手，不再往後看——避免 positional
 *   參數的內容裡剛好出現 -h（例如 `codex exec "explain -h flag"`）被誤判成說明旗標。
 */
function scanCodexTokens(tokensAfterCodex: readonly string[]): { subcommand: string | undefined; sawHelp: boolean } {
  let i = 0
  let subcommand: string | undefined
  let sawHelp = false
  while (i < tokensAfterCodex.length) {
    const token = tokensAfterCodex[i]
    if (token === undefined) break
    if (CODEX_HELP_FLAGS.has(token)) {
      sawHelp = true
      i += 1
      continue
    }
    if (CODEX_VALUE_FLAGS.has(token)) {
      i += 2
      continue
    }
    if (isCodexFlagToken(token)) {
      i += 1
      continue
    }
    if (subcommand === undefined) {
      subcommand = token
      i += 1
      continue
    }
    break
  }
  return { subcommand, sawHelp }
}

/**
 * 指令片段是不是在跑 Codex CLI 的審查（`codex review`／`codex exec`），回傳比對用的事件名稱
 * （'codex review' 或 'codex exec'），不是就回傳 undefined。
 * - 認得 npx／env／time／sudo／command 這幾種包一層的 runner，跟絕對路徑呼叫（比對 basename）。
 * - 子指令與 --help／-h 的掃描規則見 scanCodexTokens；掃到 --help／-h 就不算。
 * - 字串裡剛好出現 codex（grep codex、echo "codex review"）第一個 token 的 basename
 *   不是 codex，不算。
 */
export function codexCliReviewSegment(segment: string): string | undefined {
  const tokens = stripCodexRunnerPrefixes(commandTokens(segment))
  const bin = tokens[0]
  if (bin === undefined || bin.split('/').at(-1) !== 'codex') return undefined

  const { subcommand, sawHelp } = scanCodexTokens(tokens.slice(1))
  if (sawHelp || subcommand === undefined) return undefined
  return CODEX_CLI_SUBCOMMANDS.includes(subcommand as (typeof CODEX_CLI_SUBCOMMANDS)[number]) ? `codex ${subcommand}` : undefined
}

/**
 * 整條 Bash 指令裡，每一段比對到的 Codex CLI 審查事件名稱；沿用既有的 && / ; / | 切割。
 * 跟 pstackReadsInBashCommand 一樣回陣列而不是布林——一條指令裡理論上可以串好幾段，
 * 寫回事件交給呼叫端（register.tsx）決定，這裡只管偵測。
 */
export function codexCliReviewNamesIn(command: string): string[] {
  return splitBashSegments(command)
    .map(codexCliReviewSegment)
    .filter((name): name is string => name !== undefined)
}

// ===== commit 快照 =====

/** `git log --format=%H%x09%ct <base>..HEAD` 的輸出；%ct 是秒，轉成跟其他事件一致的毫秒。 */
export function parseBranchCommitsLog(stdout: string): BranchCommit[] {
  const commits: BranchCommit[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const [hash, seconds] = line.split('\t')
    const at = seconds === undefined ? Number.NaN : Number.parseInt(seconds, 10) * 1000
    if (hash === undefined || hash === '' || Number.isNaN(at)) continue
    commits.push({ hash, at })
  }
  return commits
}

const DEFAULT_BRANCH_FALLBACK = 'origin/main'

/** `git symbolic-ref --short refs/remotes/origin/HEAD` 失敗或空白就退回 origin/main。 */
export function resolveDefaultBranchName(symbolicRefStdout: string, exitCode: number): string {
  if (exitCode !== 0) return DEFAULT_BRANCH_FALLBACK
  const branch = symbolicRefStdout.trim()
  return branch === '' ? DEFAULT_BRANCH_FALLBACK : branch
}

/** 整包比較兩份 commit 快照是否相同；順序跟 git log 一樣是穩定的，直接逐個比對即可。 */
export function sameBranchCommits(a: readonly BranchCommit[], b: readonly BranchCommit[]): boolean {
  return a.length === b.length && a.every((commit, i) => commit.hash === b[i]?.hash && commit.at === b[i]?.at)
}

function commitsAtOrAfter(mission: Mission, at: number): readonly BranchCommit[] {
  return (mission.branchCommits ?? []).filter(commit => commit.at >= at)
}

// ===== doneWhen 判斷 =====

function latestProductEvent(mission: Mission, enteredAt: number, name: string): MissionEvent | undefined {
  const matches = mission.events.filter(event => event.at >= enteredAt && event.kind === 'product' && event.name === name)
  return matches.at(-1)
}

export type DoneWhenResult = { done: boolean; detail?: string }

/**
 * 判斷一個有 doneWhen 的節點是否完成，以及要不要在節點文字後面補一句說明：
 * - commit：看 branchCommits 裡有沒有符合時間窗的 commit，有就附上次數。
 * - mr：看有沒有 mr 的 product 事件，附上缺的段落（沒缺就不附）。
 * - issue-note：單純看有沒有對應的 product 事件。
 */
export function evaluateDoneWhen(doneWhen: DoneWhen, mission: Mission, enteredAt: number): DoneWhenResult {
  if (doneWhen === 'commit') {
    const count = commitsAtOrAfter(mission, enteredAt).length
    return { done: count > 0, detail: count > 0 ? `${count} commits` : undefined }
  }

  if (doneWhen === 'mr') {
    const event = latestProductEvent(mission, enteredAt, 'mr')
    const missing = event?.missingSections ?? []
    return { done: event !== undefined, detail: missing.length > 0 ? `缺 ${missing.join('、')}` : undefined }
  }

  if (doneWhen === 'worktree') {
    return { done: mission.worktreePath !== undefined, detail: mission.worktreePath }
  }

  return { done: latestProductEvent(mission, enteredAt, 'issue-note') !== undefined }
}

// ===== MR 偵測 =====

const MR_SCRIPT_PATTERN = /\bmr-(?:create|update)\.sh\b/
export const DRY_RUN_FLAG_PATTERN = /--dry-run\b/

/**
 * Bash 指令是不是真的在開或改 MR：要跑 mr-create.sh／mr-update.sh，且不是 --dry-run
 * （dry-run 只印 `[DRY-RUN] body: {...}` 之類的預覽，沒有真的建 MR，不該算進度）。
 */
export function looksLikeMrCommand(command: string): boolean {
  return MR_SCRIPT_PATTERN.test(command) && !DRY_RUN_FLAG_PATTERN.test(command)
}

/** stdout 裡這個專案自己的 MR iid；別的專案的 MR 網址不算（跨專案 MR 不該被當成「這個任務的 MR」）。 */
export function ownProjectMrIid(stdout: string, ownProjectPath: string): string | undefined {
  const match = extractCandidateUrls(stdout).find(url => classifyUrl(url) === 'gitlab-mr' && gitlabProjectPath(url) === ownProjectPath)
  return match === undefined ? undefined : gitlabIid(match)
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * mr-create.sh／mr-update.sh 的真實輸出是一份 JSON，裡面同時有 `description`（使用者寫的內容，
 * 可能連結到別的 MR）跟 `web_url`（這次真正建出來的那個）。stdout 是合法 JSON 時只認 web_url，
 * 不要整段文字掃一遍——全文字掃描會先撞到 description 裡提到的別的 MR 連結，選錯那一個。
 * stdout 不是 JSON（舊版輸出、或單純 echo 一行確認訊息）才退回全文字掃描。
 */
export function mrIidFromOutput(stdout: string, ownProjectPath: string): string | undefined {
  const parsed = tryParseJson(stdout)
  if (parsed === undefined) return ownProjectMrIid(stdout, ownProjectPath)
  if (typeof parsed !== 'object' || parsed === null) return undefined

  const webUrl = (parsed as Record<string, unknown>).web_url
  if (typeof webUrl !== 'string') return undefined
  return classifyUrl(webUrl) === 'gitlab-mr' && gitlabProjectPath(webUrl) === ownProjectPath ? gitlabIid(webUrl) : undefined
}

// mr-create.sh／mr-update.sh 都用 --description "$(cat <path>)"（或 --description="$(cat ...)"）
// 把描述檔內容帶進去；這裡只抓檔案路徑，讀檔交給呼叫端的 $.fs.read（展開 ~/ 跟相對路徑）。
const DESCRIPTION_FILE_PATTERN = /--description=?\s*"\$\(cat\s+(?:'([^']+)'|"([^"]+)"|([^)\s]+))\)"/

export function descriptionFilePathFromCommand(command: string): string | undefined {
  const match = DESCRIPTION_FILE_PATTERN.exec(command)
  if (match === null) return undefined
  return match[1] ?? match[2] ?? match[3]
}

/** `~/` 展開成絕對路徑；非絕對路徑相對 session root 解析；home 查不到就讓 ~/ 原樣過（不亂猜）。 */
export function expandDescriptionPath(path: string, home: string | undefined, sessionRoot: string): string {
  if (path.startsWith('~/')) return home === undefined ? path : `${home}/${path.slice(2)}`
  if (path.startsWith('/')) return path
  return `${sessionRoot}/${path}`
}

// 標題常見 emoji（🔗 關聯 之類）不該讓關鍵字比對落空，用 Extended_Pictographic 整批濾掉。
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu
const HEADING_PATTERN = /^#{1,6}\s/

function headingText(description: string): string[] {
  return description
    .split('\n')
    .filter(line => HEADING_PATTERN.test(line.trim()))
    .map(line => line.replace(EMOJI_PATTERN, ''))
}

/** MR 描述缺了哪些必備段落；關鍵字只比對標題行，不管第幾級標題、不管 emoji。 */
export function missingMrSections(description: string, keywords: readonly string[]): string[] {
  const headings = headingText(description)
  return keywords.filter(keyword => !headings.some(heading => heading.includes(keyword)))
}

// ===== issue 留言偵測 =====

const ISSUE_NOTE_SCRIPT_PATTERN = /\bissue-note\.sh\b/
const GLAB_API_ISSUE_NOTES_PATTERN = /\bglab\s+api\b.*\bissues\/(\d+)\/notes\b/
export const POST_FLAG_PATTERN = /(^|\s)(-X\s*POST|--method(?:=|\s+)POST|-[fF]\b|--field\b)/i
const GLAB_API_PROJECT_PATTERN = /\bprojects\/(.+?)\/issues\//

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsArgToken(command: string, token: string): boolean {
  return new RegExp(`(?:^|[\\s'"])${escapeRegExp(token)}(?:[\\s'"]|$)`).test(command)
}

// glab api 沒寫 projects/ 這段時，glab 自己會用目前 repo 推斷專案，等同 :id。
export function matchesOwnProject(projectToken: string | undefined, ownProjectPath: string | undefined): boolean {
  if (projectToken === undefined || projectToken === ':id') return true
  if (ownProjectPath === undefined) return false
  return projectToken === ownProjectPath || projectToken === encodeURIComponent(ownProjectPath)
}

/**
 * Bash 指令是不是在對「這個任務、這個專案」的 issue 留言：
 * - issue-note.sh：不是 --dry-run（跟 MR 一樣，預覽沒有真的留言），帶上這個 iid，且帶上自己專案的 token——實際用法第一個參數是完整專案路徑
 *   （例如 fugle/brokerage-service-development/r-securities/rsc-frontend），不是短名，
 *   所以完整路徑、它的 URL 編碼、或短名三種都接受（都要是完整引數，不是子字串）。
 * - glab api：打 issues/<iid>/notes 且帶 POST 類參數（-X POST／--method POST／-f／-F／--field），
 *   專案要是 :id、省略（glab 用目前 repo 推斷）、或自己專案路徑（原樣或 URL 編碼）。
 */
export function matchesIssueNoteCommand(command: string, missionIssueIid: string, ownProjectPath: string | undefined): boolean {
  if (ISSUE_NOTE_SCRIPT_PATTERN.test(command)) {
    if (DRY_RUN_FLAG_PATTERN.test(command)) return false
    if (!containsArgToken(command, missionIssueIid)) return false
    if (ownProjectPath === undefined) return false
    const shortName = ownProjectPath.split('/').filter(Boolean).at(-1)
    return (
      containsArgToken(command, ownProjectPath) ||
      containsArgToken(command, encodeURIComponent(ownProjectPath)) ||
      (shortName !== undefined && containsArgToken(command, shortName))
    )
  }

  const glabMatch = GLAB_API_ISSUE_NOTES_PATTERN.exec(command)
  if (glabMatch?.[1] !== missionIssueIid || !POST_FLAG_PATTERN.test(command)) return false
  return matchesOwnProject(GLAB_API_PROJECT_PATTERN.exec(command)?.[1], ownProjectPath)
}
