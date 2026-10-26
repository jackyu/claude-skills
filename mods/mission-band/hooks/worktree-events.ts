// 把 worktree-detect.ts 的字串解析接到 $：orca 的 JSON 直接信；其餘來源（git worktree add、
// cd、orca 的 --name 對 git worktree list）各有自己的驗法，見 detectWorktreePath。跟
// product-events.ts 分開放，避免那個檔案跟 register.tsx 一起繼續長下去。
import type { EngineInterface } from 'claude-code'

import { findBoundMission } from './model'
import { loadMissions, mutate } from './store'
import {
  cdWorktreeCandidatePath,
  gitWorktreeAddPathFromCommand,
  looksLikeOrcaWorktreeCreateCommand,
  orcaWorktreeCreateNameFromCommand,
  orcaWorktreeCreatePathFromStdout,
  worktreePathForBranchFromPorcelain,
} from './worktree-detect'

const WORKTREE_DIR_NAMES = ['.claude/worktrees', '.worktrees'] as const

// handoff.ts 的 /mission-go 也要用同一套「是不是在 worktree 目錄底下」「git 本身認不認」
// 判斷，所以這兩個 export 出去；放在這個檔案是因為偵測邏輯本來就都在這裡，handoff.ts
// import 這裡不會造成循環依賴（這個檔案沒有反過來 import handoff.ts）。
export function isUnderWorktreeDirs(path: string, repoRoot: string): boolean {
  return WORKTREE_DIR_NAMES.some(dir => path.startsWith(`${repoRoot}/${dir}/`))
}

/** 問 git 本身這個路徑的 worktree 根目錄是哪裡；git 失敗或丟例外都回 undefined，不猜。 */
export async function gitRevParseShowToplevel($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    const result = await $.process.run(['git', '-C', path, 'rev-parse', '--show-toplevel'])
    return result.exitCode === 0 ? result.stdout.trim() : undefined
  } catch (error) {
    $.ui.log(`mission-band: 確認「${path}」是不是 worktree 根目錄失敗：${String(error)}`)
    return undefined
  }
}

/**
 * stdout 讀不到路徑時（被導進檔案、沒加 --json），拿 `--name` 去問 git 哪個 worktree 掛著
 * 這個分支；git list 出來的就是已經存在的 worktree，不用再 rev-parse 驗一次。主 checkout
 * 剛好在同名分支時（orca 會因分支已存在而失敗）不能算，所以只收 worktree 目錄底下的路徑。
 */
async function orcaWorktreePathByName($: EngineInterface, command: string): Promise<string | undefined> {
  const name = orcaWorktreeCreateNameFromCommand(command)
  if (name === undefined) return undefined
  const repoRoot = (await $.session.repo())?.root ?? (await $.session.root())
  try {
    const result = await $.process.run(['git', '-C', repoRoot, 'worktree', 'list', '--porcelain'])
    if (result.exitCode !== 0) return undefined
    const path = worktreePathForBranchFromPorcelain(result.stdout, name)
    return path !== undefined && isUnderWorktreeDirs(path, repoRoot) ? path : undefined
  } catch (error) {
    $.ui.log(`mission-band: 用 git worktree list 找「${name}」失敗：${String(error)}`)
    return undefined
  }
}

/**
 * 從這次 Bash 指令或它的 stdout 找出建出來的 worktree 路徑：
 * - `orca worktree create`：stdout 的 JSON 信封本身就是權威來源，不用另外驗。
 * - `git worktree add`：解析出的路徑要先過 `git -C <path> rev-parse` 驗一次（exit 0）才信——
 *   這也順便擋掉「指令本身失敗」的情況，失敗的話那個目錄不會是合法的 worktree。
 * - cd 進 `.claude/worktrees/`／`.worktrees/`：同樣要驗，而且只在目前還沒有 worktreePath 時
 *   才補（cd 的訊號比明確下指令弱，不該覆蓋掉已經確定過的路徑）。
 * orca／git worktree add 是明確動作，可以覆蓋現有值（latest wins）；cd 只能從無到有。
 */
async function detectWorktreePath($: EngineInterface, command: string, stdout: string, knownPath: string | undefined): Promise<string | undefined> {
  if (looksLikeOrcaWorktreeCreateCommand(command)) {
    const fromStdout = orcaWorktreeCreatePathFromStdout(stdout)
    if (fromStdout !== undefined) return fromStdout
    const fromName = await orcaWorktreePathByName($, command)
    if (fromName !== undefined) return fromName
  }

  const sessionRoot = await $.session.root()
  const fromGitAdd = gitWorktreeAddPathFromCommand(command, sessionRoot)
  if (fromGitAdd !== undefined) {
    const verified = await gitRevParseShowToplevel($, fromGitAdd)
    if (verified !== undefined) return fromGitAdd
  }

  if (knownPath !== undefined) return undefined

  const repo = await $.session.repo()
  if (repo === null) return undefined
  const candidate = cdWorktreeCandidatePath(command, repo.root)
  if (candidate === undefined) return undefined
  const root = await gitRevParseShowToplevel($, candidate)
  return root !== undefined && isUnderWorktreeDirs(root, repo.root) ? root : undefined
}

/**
 * 只有這個 binding 綁了任務才偵測；子 agent 跑的 Bash（e.agentId 有值）不算——worktree 是
 * 主迴圈的事，子 agent 常常在別的目錄下操作，不該被牽連進來。找到的路徑跟目前記的不一樣才寫。
 */
export async function maybeRecordWorktreePath($: EngineInterface, binding: string, command: string, stdout: string, agentId: string | undefined): Promise<void> {
  if (agentId !== undefined) return
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined) return
  const [, mission] = bound

  const path = await detectWorktreePath($, command, stdout, mission.worktreePath)
  if (path === undefined || path === mission.worktreePath) return

  await mutate($, missions => {
    const bound2 = findBoundMission(missions, binding)
    if (bound2 === undefined) return missions
    const [name, m] = bound2
    if (m.worktreePath === path) return missions
    return { ...missions, [name]: { ...m, worktreePath: path } }
  })
}

/** 主 checkout 的 GLOSSARY.md／ADR 有沒有還沒搬過去 worktree 的改動；查不到或出錯都當沒有。 */
export async function domainDocsDirty($: EngineInterface): Promise<boolean> {
  const repo = await $.session.repo()
  if (repo === null) return false

  try {
    const result = await $.process.run(['git', 'status', '--porcelain', '--', 'GLOSSARY.md', 'docs/adr'], { cwd: repo.root })
    return result.exitCode === 0 && result.stdout.trim() !== ''
  } catch (error) {
    $.ui.log(`mission-band: 檢查 GLOSSARY／ADR 是否有未搬動的改動失敗，當作沒有：${String(error)}`)
    return false
  }
}
