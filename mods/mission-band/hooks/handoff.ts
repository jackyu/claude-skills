// /mission-go 的邏輯：在任務的 worktree 開一個新的 claude 分頁，交給 orca 打 /mission-restore
// 接回任務。跟 register.tsx 分開放，避免那個檔案繼續長下去。
import type { EngineInterface } from 'claude-code'

import { findBoundMission, shortName } from './model'
import { tryParseJson } from './products'
import { loadMissions, mutate } from './store'
import { gitRevParseShowToplevel, isUnderWorktreeDirs } from './worktree-events'

const LAUNCH_TIMEOUT_MS = 30000
const NO_WORKTREE_TEXT =
  '還沒記到 worktree：請 AI 用 orca worktree create 或 git worktree add 建一個；已經建好的話，請 AI cd 進那個目錄讓我記下路徑；真的不需要就 /mission-skip create-worktree <理由>'

/** `orca agent launch` 的 argv；worktree 選定子用 `path:<絕對路徑>`，prompt 是打給新分頁的第一句話。 */
export function missionGoArgv(worktreePath: string, shortMissionName: string): string[] {
  return ['orca', 'agent', 'launch', '--agent', 'claude', '--worktree', `path:${worktreePath}`, '--prompt', `/mission-restore ${shortMissionName}`, '--focus', '--json']
}

export type OrcaLaunchOutcome = { ok: true } | { ok: false; detail: string | undefined }

function firstLine(text: string): string | undefined {
  const line = text.split('\n')[0]?.trim()
  return line === undefined || line === '' ? undefined : line
}

/** 信封裡的 `error`（或 `result.error`）字串；不是合法 JSON 或沒有這個欄位就當沒有。 */
function jsonErrorMessage(stdout: string): string | undefined {
  const parsed = tryParseJson(stdout.trim())
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const obj = parsed as Record<string, unknown>

  const direct = obj.error
  if (typeof direct === 'string') return direct

  const result = obj.result
  if (typeof result === 'object' && result !== null) {
    const nested = (result as Record<string, unknown>).error
    if (typeof nested === 'string') return nested
  }
  return undefined
}

/** 信封的 `ok` 欄位；不是合法 JSON 或沒有這個欄位就當不知道（undefined，不當作失敗）。 */
function envelopeOk(stdout: string): boolean | undefined {
  const parsed = tryParseJson(stdout.trim())
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const ok = (parsed as Record<string, unknown>).ok
  return typeof ok === 'boolean' ? ok : undefined
}

/**
 * `orca agent launch --json` 跑完之後：exit 0 且信封沒有明確說 `ok:false` 才算成功；
 * 失敗時的 detail 先看信封裡的 `error`（或 `result.error`），沒有才退回 stderr 第一行。
 */
export function orcaLaunchOutcome(exitCode: number, stdout: string, stderr: string): OrcaLaunchOutcome {
  if (exitCode === 0 && envelopeOk(stdout) !== false) return { ok: true }
  return { ok: false, detail: jsonErrorMessage(stdout) ?? firstLine(stderr) }
}

/**
 * 任務還沒記 worktreePath 時的最後手段：問問現在的 cwd 本身是不是已經在 worktree 目錄
 * 底下——使用者可能手動 cd 過去、也可能是 orca 把這個分頁直接開在 worktree 裡，只是
 * 中途沒有一次 Bash 指令觸發過 maybeRecordWorktreePath 的偵測。跟那邊同一套規則：先看
 * 字串層的路徑落在 `.claude/worktrees/` 或 `.worktrees/` 底下，再用
 * `git -C <cwd> rev-parse --show-toplevel` 問 git 本身驗過，驗出來的根目錄也要落在同一組
 * worktree 目錄才信。信了就順手記回這個任務的 worktreePath，下次就不用再偵測一次。
 * 沒有 repo、cwd 看起來不像 worktree、或 git 不認，都當作沒有，回 undefined 讓呼叫端走
 * 原本的 NO_WORKTREE_TEXT。
 */
async function worktreePathFromCwd($: EngineInterface, binding: string): Promise<string | undefined> {
  const repo = await $.session.repo()
  if (repo === null) return undefined

  const cwd = await $.session.cwd()
  if (!isUnderWorktreeDirs(cwd, repo.root)) return undefined

  const root = await gitRevParseShowToplevel($, cwd)
  if (root === undefined || !isUnderWorktreeDirs(root, repo.root)) return undefined

  await mutate($, missions => {
    const bound = findBoundMission(missions, binding)
    if (bound === undefined) return missions
    const [name, mission] = bound
    if (mission.worktreePath === root) return missions
    return { ...missions, [name]: { ...mission, worktreePath: root } }
  })

  return root
}

/**
 * 找這個 binding 綁的任務：沒有就說沒有；還沒有 worktreePath 就先看現在的 cwd 本身是不是
 * 已經在 worktree 裡（worktreePathFromCwd），再不行才說怎麼補；都有就跑
 * `orca agent launch`，依結果給對應的文字。全程不丟例外出去——跑失敗（orca 不存在、
 * 逾時……）跟「跑成功但回報失敗」一樣當作失敗，附一句自己手動開的退路。
 */
export async function missionGoText($: EngineInterface, binding: string): Promise<string> {
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined) return '這裡沒有綁定任務'
  const [name, mission] = bound

  const worktreePath = mission.worktreePath ?? (await worktreePathFromCwd($, binding))
  if (worktreePath === undefined) return NO_WORKTREE_TEXT

  const short = shortName(name)
  const fallback = `可以自己在 worktree 開 claude，再打 /mission-restore ${short}`

  try {
    const result = await $.process.run(missionGoArgv(worktreePath, short), { cwd: worktreePath, timeoutMs: LAUNCH_TIMEOUT_MS })
    const outcome = orcaLaunchOutcome(result.exitCode, result.stdout, result.stderr)
    if (outcome.ok) return `已在 Orca 開新的 claude 分頁（${worktreePath}），那邊會自動打 /mission-restore ${short}`
    return `orca agent launch 失敗（exit ${result.exitCode}）：${outcome.detail ?? '沒有錯誤訊息'}\n${fallback}`
  } catch (error) {
    return `orca agent launch 失敗：${String(error)}\n${fallback}`
  }
}
