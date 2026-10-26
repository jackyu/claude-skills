// 把 products.ts 的純函式接到 $：commit 快照、MR 偵測、issue 留言偵測各自要怎麼問引擎、
// 怎麼寫回任務。跟 register.tsx 分開放，讓 register.tsx 專心做 hook 註冊。
import type { EngineInterface } from 'claude-code'

import { MR_SECTION_KEYWORDS } from '../flows/new-feature'
import type { BranchCommit } from '../types'
import { maybeRefreshAcceptance } from './acceptance-events'
import { projectPathFromRemote } from './assets'
import { findBoundMission, issueIidFromMissionName } from './model'
import { missingAcIdsInEvidence } from './mr-evidence'
import {
  descriptionFilePathFromCommand,
  expandDescriptionPath,
  looksLikeMrCommand,
  matchesIssueNoteCommand,
  missingMrSections,
  mrIidFromOutput,
  parseBranchCommitsLog,
  resolveDefaultBranchName,
  sameBranchCommits,
} from './products'
import { loadMissions, mutate, recordEvent } from './store'

export async function ownProjectPathOf($: EngineInterface): Promise<string | undefined> {
  const repo = await $.session.repo()
  return projectPathFromRemote(repo?.remote ?? null)?.path
}

async function currentBranchCommits(
  $: EngineInterface,
  cwd: string,
  onError: (error: unknown) => void,
): Promise<BranchCommit[] | undefined> {
  try {
    const branchResult = await $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd })
    const defaultBranch = resolveDefaultBranchName(branchResult.stdout, branchResult.exitCode)
    const logResult = await $.process.run(['git', 'log', '--format=%H%x09%ct', `${defaultBranch}..HEAD`], { cwd })
    if (logResult.exitCode !== 0) return undefined
    return parseBranchCommitsLog(logResult.stdout)
  } catch (error) {
    onError(error)
    return undefined
  }
}

/**
 * 只有這個 binding 綁了任務才查 git；有 worktreePath 就只在那裡查（commit 是在 worktree 裡
 * 做的，不是主 checkout）——worktree 目錄不見了或 git 失敗就先不更新，**不**退回 session root
 * （退回去查到的會是主 checkout 的 commit，混進這個任務的快照裡是錯的）。只有 worktreePath
 * 根本還沒定下來（還在主 checkout 分析中）才查 session root。commit 快照整包覆蓋，沒變化就不寫 store。
 */
export async function maybeUpdateBranchCommits($: EngineInterface, binding: string): Promise<void> {
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined) return
  const [, mission] = bound

  const cwd = mission.worktreePath ?? (await $.session.root())
  const logContext = mission.worktreePath === undefined ? '' : `worktree「${mission.worktreePath}」`
  const commits = await currentBranchCommits($, cwd, error => $.ui.log(`mission-band: ${logContext}讀取分支 commit 快照失敗，暫不更新：${String(error)}`))
  if (commits === undefined) return

  await mutate($, missions => {
    const bound2 = findBoundMission(missions, binding)
    if (bound2 === undefined) return missions
    const [name, m] = bound2
    if (sameBranchCommits(m.branchCommits ?? [], commits)) return missions
    return { ...missions, [name]: { ...m, branchCommits: commits } }
  })
}

/** 先從指令裡抓描述檔路徑直接讀（展開 ~/、相對路徑接 session root）；抓不到路徑或讀檔失敗都退回 glab api 查這個 MR 的描述。 */
async function mrDescriptionText($: EngineInterface, command: string, iid: string): Promise<string | undefined> {
  const rawPath = descriptionFilePathFromCommand(command)
  if (rawPath !== undefined) {
    const home = await $.env.get('HOME')
    const root = await $.session.root()
    const path = expandDescriptionPath(rawPath, home, root)
    try {
      return await $.fs.read(path)
    } catch (error) {
      $.ui.log(`mission-band: 讀取 MR 描述檔「${path}」失敗，改用 glab api：${String(error)}`)
    }
  }

  try {
    const root = await $.session.root()
    const result = await $.process.run(['glab', 'api', `projects/:id/merge_requests/${iid}`], { cwd: root })
    if (result.exitCode !== 0) return undefined
    const parsed: unknown = JSON.parse(result.stdout)
    const description = typeof parsed === 'object' && parsed !== null ? (parsed as { description?: unknown }).description : undefined
    return typeof description === 'string' ? description : undefined
  } catch (error) {
    $.ui.log(`mission-band: glab api 讀取 MR 描述失敗：${String(error)}`)
    return undefined
  }
}

/**
 * foreground Bash 真的在開或改 MR（非 dry-run）、stdout 裡找到這個專案的 MR，才補查描述缺的
 * 段落、記一筆 mr 的 product 事件；不是 mr-create.sh／mr-update.sh 的指令一律不碰（避免讀 issue
 * notes、cat 規格文件這類輸出裡剛好出現的 MR 網址被誤認成「這次開的 MR」）。
 * missingAcs（Evidence 段落漏提到的 AC id）要看這個任務自己驗收清單的 acIds，所以也要
 * binding；沒有任務綁在這裡就只查段落，不查 AC（acIds 當空陣列，missingAcIdsInEvidence
 * 本來就會對空陣列直接回空陣列）。
 */
export async function maybeRecordMrEvent($: EngineInterface, binding: string, command: string, stdout: string): Promise<void> {
  if (!looksLikeMrCommand(command) || stdout === '') return
  const ownProjectPath = await ownProjectPathOf($)
  if (ownProjectPath === undefined) return

  const iid = mrIidFromOutput(stdout, ownProjectPath)
  if (iid === undefined) return

  const description = await mrDescriptionText($, command, iid)
  const missingSections = description === undefined ? [] : missingMrSections(description, MR_SECTION_KEYWORDS)

  // 開 MR 前可能在同一個 turn 才剛改完驗收清單（例如補了一條 AC），先刷新一次才能拿到
  // 當下最新的 acIds，不是這個 turn 開始時的舊快照。刷新本身失敗（store／fs 出問題）
  // 不該讓整個 mr 事件都記不到——退回沿用目前 store 裡已經有的 acIds，至少段落檢查跟
  // 事件本身還能記下來。
  try {
    await maybeRefreshAcceptance($, binding)
  } catch (error) {
    $.ui.log(`mission-band: 開 MR 前刷新驗收清單失敗，沿用目前已知的 acIds：${String(error)}`)
  }
  const bound = findBoundMission(await loadMissions($), binding)
  const acIds = bound?.[1].acceptance?.acIds ?? []
  const missingAcs = description === undefined ? [] : missingAcIdsInEvidence(description, acIds)

  // mrIid 讓 /mission-review 知道要同步哪一個 MR（見 hooks/review-stage.ts 的 latestMrIid）。
  await recordEvent($, { at: await $.clock.now(), kind: 'product', name: 'mr', missingSections, missingAcs, mrIid: iid })
}

/** 指令本身是不是對這個任務、這個專案的 issue 發留言；不看 stdout，背景 Bash 也能判斷。 */
export async function maybeRecordIssueNoteEvent($: EngineInterface, binding: string, command: string): Promise<void> {
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined) return
  const iid = issueIidFromMissionName(bound[0])
  if (iid === undefined) return
  const ownProjectPath = await ownProjectPathOf($)
  if (matchesIssueNoteCommand(command, iid, ownProjectPath)) {
    await recordEvent($, { at: await $.clock.now(), kind: 'product', name: 'issue-note' })
  }
}
