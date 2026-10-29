// 節點狀態的純函式層：事件怎麼比對到節點、一個節點算不算完成、下一步提示文字。從 model.ts
// 拆出來（model.ts 原本快超過 400 行），model.ts 的 CRUD／指令邏輯都疊在這層上面，自己
// 透過 export { ... } from './node-states' 轉出去，呼叫端的 import 路徑不用跟著改。
import type { DoneWhen, EventMatcher, Mission, MissionEvent, MissionFlow, MissionFlowNode, MissionFlowTrack, MissionStage } from '../types'
import {
  evaluateAcceptanceDoneWhen,
  evaluateAcceptanceRunDoneWhen,
  evaluateOverallRegressionDoneWhen,
  evaluateRegressionWriteDoneWhen,
} from './acceptance'
import { evaluateMrDoneWhen } from './mr-evidence'
import { evaluateDoneWhen, type DoneWhenResult } from './products'
import { evaluateReviewTriageDoneWhen } from './review-triage'
import {
  evaluateApprovedDoneWhen,
  evaluateAwaitReviewDoneWhen,
  evaluatePushFixDoneWhen,
  evaluateReplyDoneWhen,
  evaluateReverifyDoneWhen,
} from './review-stage'

// 驗收清單相關的四種 doneWhen、mr（Evidence 缺的 AC id 要疊進 detail）、審查階段五種
// 都不疊進 products.ts 的 evaluateDoneWhen——那個檔案已經 399 行，貼著 400 行的上限；評估
// 邏輯本身在 acceptance.ts／mr-evidence.ts／review-stage.ts（跟各自要用的欄位放一起），
// 這裡只負責分派，而且要排在 products.ts 的 fallback 前面——否則認不得的 doneWhen 會被
// evaluateDoneWhen 誤判成 issue-note 檢查。
function evaluateDoneWhenAny(doneWhen: DoneWhen, mission: Mission, enteredAt: number): DoneWhenResult {
  if (doneWhen === 'acceptance-file') return evaluateAcceptanceDoneWhen(mission)
  if (doneWhen === 'acceptance-run') return evaluateAcceptanceRunDoneWhen(mission)
  if (doneWhen === 'regression-write') return evaluateRegressionWriteDoneWhen(mission)
  if (doneWhen === 'overall-regression') return evaluateOverallRegressionDoneWhen(mission)
  if (doneWhen === 'reverify') return evaluateReverifyDoneWhen(mission)
  if (doneWhen === 'mr') return evaluateMrDoneWhen(mission, enteredAt)
  if (doneWhen === 'await-review') return evaluateAwaitReviewDoneWhen(mission)
  if (doneWhen === 'review-triage') return evaluateReviewTriageDoneWhen(mission)
  if (doneWhen === 'push-fix') return evaluatePushFixDoneWhen(mission)
  if (doneWhen === 'reply') return evaluateReplyDoneWhen(mission)
  if (doneWhen === 'approved') return evaluateApprovedDoneWhen(mission)
  return evaluateDoneWhen(doneWhen, mission, enteredAt)
}

const BUILD_STAGE_ID = 'build'
export const REVIEW_STAGE_ID = 'review'

// ===== 事件比對 =====

/** 把事件名稱的 plugin 前綴去掉，`x:y` 變 `y`；沒有前綴就原樣回傳。 */
export function stripPluginPrefix(name: string): string {
  const i = name.indexOf(':')
  return i === -1 ? name : name.slice(i + 1)
}

function matchesSkillEvent(matcher: EventMatcher, name: string): boolean {
  if (matcher.matchSkill !== undefined) {
    const skills = Array.isArray(matcher.matchSkill) ? matcher.matchSkill : [matcher.matchSkill]
    if (skills.includes(name)) return true
  }
  return matcher.matchSkillPrefix !== undefined && name.startsWith(matcher.matchSkillPrefix)
}

// 節點（MissionFlowNode）跟軌道（MissionFlowTrack）共用同一組 EventMatcher 欄位，所以節點跟
// 軌道都能直接傳進來比對；有 tracks 的節點自己不吃這組欄位（見 matchesNode）。
function matchesEvent(matcher: EventMatcher, event: Pick<MissionEvent, 'kind' | 'name'>): boolean {
  if (event.kind === 'skill') {
    // matchSkillExact 比對完整原始名稱，不去掉前綴——用在前綴本身就是辨識依據的場合
    // （例如只認 codex:rescue，不要隨便一個 plugin 剛好也有 rescue 這個 skill 名）。
    if (matcher.matchSkillExact !== undefined && event.name === matcher.matchSkillExact) return true
    return matchesSkillEvent(matcher, stripPluginPrefix(event.name))
  }
  if (matcher.matchRead !== undefined && event.kind === 'read') return event.name === matcher.matchRead
  // agent 事件的 name 是 subagent_type 本身，不去掉前綴——'codex:' 這個前綴就是要比對的東西。
  if (matcher.matchAgentPrefix !== undefined && event.kind === 'agent') return event.name.startsWith(matcher.matchAgentPrefix)
  if (matcher.matchBash !== undefined && event.kind === 'bash') {
    const names = Array.isArray(matcher.matchBash) ? matcher.matchBash : [matcher.matchBash]
    return names.includes(event.name)
  }
  return false
}

/** 有 tracks 的節點看任一軌道比對得到；其他節點直接拿自己當 EventMatcher 比對。 */
function matchesNode(node: MissionFlowNode, event: Pick<MissionEvent, 'kind' | 'name'>): boolean {
  if (node.tracks !== undefined) return node.tracks.some(track => matchesEvent(track, event))
  return matchesEvent(node, event)
}

function hasMatcher(matcher: EventMatcher): boolean {
  return (
    matcher.matchSkill !== undefined ||
    matcher.matchSkillPrefix !== undefined ||
    matcher.matchSkillExact !== undefined ||
    matcher.matchRead !== undefined ||
    matcher.matchAgentPrefix !== undefined ||
    matcher.matchBash !== undefined
  )
}

/** 完全沒有任何比對條件的節點（例如 create-worktree）永遠量不到「開始了」。 */
function hasStartMatcher(node: MissionFlowNode): boolean {
  if (node.tracks !== undefined) return node.tracks.length > 0
  return hasMatcher(node)
}

function hasEventFor(node: MissionFlowNode, mission: Mission, enteredAt: number): boolean {
  return mission.events.some(event => event.at >= enteredAt && matchesNode(node, event))
}

// ===== 雙軌節點（例如 code-review） =====

export type TrackStatus = 'ran' | 'skipped' | 'pending'

export type TrackState = { track: MissionFlowTrack; status: TrackStatus }

/**
 * 一條軌道是不是被跳過：看自己的 key（`<nodeId>:<trackId>`），或它 legacySkipIds 列的舊節點
 * id——那是這條軌道合併進雙軌節點之前、當獨立節點時的 skip key，舊資料用那個 key 跳過時等同
 * 跳過這條軌道。
 */
function isTrackSkipped(node: MissionFlowNode, track: MissionFlowTrack, mission: Mission): boolean {
  if (`${node.id}:${track.id}` in mission.skips) return true
  return (track.legacySkipIds ?? []).some(id => id in mission.skips)
}

function trackStates(node: MissionFlowNode, mission: Mission, enteredAt: number): TrackState[] {
  return (node.tracks ?? []).map(track => {
    if (isTrackSkipped(node, track, mission)) return { track, status: 'skipped' as const }
    const ran = mission.events.some(event => event.at >= enteredAt && matchesEvent(track, event))
    return { track, status: ran ? ('ran' as const) : ('pending' as const) }
  })
}

/**
 * 完成條件：每條軌道都跑過或被跳過（包含全部軌道都被跳過的情況——使用者明確表示兩條都不用，
 * 不該卡在 not-started 擋住 /mission-next）；否則只要有任一條真的跑過，就算開始了；
 * 一條都沒跑過、也沒被跳過的（還在等）就是還沒開始。
 */
function tracksNodeStatus(states: readonly TrackState[]): NodeStatus {
  if (states.every(s => s.status === 'ran' || s.status === 'skipped')) return 'done'
  return states.some(s => s.status === 'ran') ? 'started' : 'not-started'
}

const TRACK_SYMBOL: Record<TrackStatus, string> = { ran: '✓', skipped: '已跳過', pending: '○' }

function tracksDetailText(states: readonly TrackState[]): string {
  return states.map(s => `${s.track.label} ${TRACK_SYMBOL[s.status]}`).join(' · ')
}

// ===== 節點狀態 =====

export type NodeStatus = 'not-started' | 'started' | 'done' | 'skip'

export type NodeState = { node: MissionFlowNode; status: NodeStatus; detail?: string; trackStates?: readonly TrackState[] }

/** 某個階段進入的時間；舊資料沒有 stageEnteredAt，或缺某個 index，一律當作 createdAt。 */
export function stageEnteredAt(mission: Mission, stageIndex: number): number {
  return mission.stageEnteredAt?.[stageIndex] ?? mission.createdAt
}

// 一個節點後面如果全是「已跳過」「doneWhen 真的做完」「從沒開始過的 optional」或「完全沒有比對
// 條件的節點」，流程等於已經走過去了，跟真的有更晚的節點開始一樣，這個節點可以算完成；階段最後
// 一個節點必然符合（後面是空陣列）。doneViaDoneWhen 要另外傳進來，因為 doneWhen 節點（例如
// create-worktree）常常沒有 matchSkill／matchRead，started 永遠量不到它「開始了」，只能看它
// 自己 evaluateDoneWhen 的結果；沒有任何比對條件的節點（create-worktree 這類）不管做完沒做完
// 都不該卡住前面節點自己的完成判斷——它自己要不要擋整個階段往前走，交給 isBlocking／isTransparent
// 用它自己最終的 status 另外判斷，不影響這裡。
function isResolved(node: MissionFlowNode, started: boolean, skipped: boolean, doneViaDoneWhen: boolean): boolean {
  return skipped || doneViaDoneWhen || (node.optional === true && !started) || !hasStartMatcher(node)
}

/**
 * 同一階段裡，一個節點「完成」的條件：
 * - 有 tracks 的節點（例如 code-review）：交給 tracksNodeStatus 判斷，不看後面的節點、也不看
 *   doneWhen——至少一條軌道跑過，其餘軌道跑過或被跳過才算完成。
 * - 有 doneWhen 的節點：交給 products.ts 的 evaluateDoneWhen 判斷，不看後面的節點。
 * - 其他節點：自己已經開始，且同階段更晚的節點也開始了，或更晚的節點全部已跳過／doneWhen 真的
 *   做完／是從沒開始過的 optional 節點（代表流程已經往後走，回頭看這個節點就算做完）。
 * 跳過的節點永遠是 skip，不會變 done。
 */
export function nodeStates(nodes: readonly MissionFlowNode[], mission: Mission): NodeState[] {
  const enteredAt = stageEnteredAt(mission, mission.stage)
  // 自動跳過（skipWhen 回傳原因）跟使用者打 /mission-skip 顯示方式完全一樣，只是原因文字
  // 的來源不同：explicit 用 mission.skips 記的那句，derived 用 skipWhen 現場算出來的。
  const isSkipped = (node: MissionFlowNode): boolean => node.id in mission.skips || node.skipWhen?.(mission) !== undefined
  const skipReason = (node: MissionFlowNode): string | undefined => mission.skips[node.id] ?? node.skipWhen?.(mission)

  const started = nodes.map(node => {
    if (isSkipped(node)) return false
    if (node.tracks !== undefined) return trackStates(node, mission, enteredAt).some(s => s.status === 'ran')
    return hasEventFor(node, mission, enteredAt)
  })

  // doneWhen／tracks 節點的完成判斷跟它後面的節點無關，這裡先一次算好；後面兩個地方都要用：
  // 節點自己的狀態，跟它被後面節點的 isResolved 檢查引用時（它自己是「後面的節點」）。
  const doneWhenResults = nodes.map(node => (node.doneWhen === undefined ? undefined : evaluateDoneWhenAny(node.doneWhen, mission, enteredAt)))
  const tracksDone = nodes.map(node => node.tracks !== undefined && tracksNodeStatus(trackStates(node, mission, enteredAt)) === 'done')

  return nodes.map((node, i) => {
    if (isSkipped(node)) return { node, status: 'skip' as const, detail: skipReason(node) }

    if (node.tracks !== undefined) {
      const states = trackStates(node, mission, enteredAt)
      return { node, status: tracksNodeStatus(states), detail: tracksDetailText(states), trackStates: states }
    }

    const doneWhenResult = doneWhenResults[i]
    if (doneWhenResult !== undefined) {
      // 沒做完時一樣帶上 detail：既有的 commit／mr／worktree／acceptance-file 四種
      // doneWhenResult 在沒做完時從來沒給過 detail（undefined），這裡多帶一個欄位對
      // 它們沒有任何可見影響；regression-write 這類新節點要在沒做完時也顯示「2 條待寫」
      // 才需要這條路徑。
      const status = started[i] === true ? ('started' as const) : ('not-started' as const)
      if (doneWhenResult.done) return { node, status: 'done' as const, detail: doneWhenResult.detail }
      return { node, status, detail: doneWhenResult.detail }
    }

    if (started[i] !== true) return { node, status: 'not-started' as const }

    const hasLaterStart = started.slice(i + 1).some(Boolean)
    const laterAllResolved = nodes.slice(i + 1).every((later, offset) => {
      const idx = i + 1 + offset
      const doneViaDoneWhen = doneWhenResults[idx]?.done === true || tracksDone[idx] === true
      return isResolved(later, started[idx] === true, isSkipped(later), doneViaDoneWhen)
    })
    return { node, status: hasLaterStart || laterAllResolved ? ('done' as const) : ('started' as const) }
  })
}

/** 跳過的、或從沒開始過的 optional 節點都不擋路，跟 isBlocking 的判準一致。 */
function isTransparent(state: NodeState): boolean {
  return state.status === 'skip' || (state.status === 'not-started' && state.node.optional === true)
}

/** 一個 optional 節點從來沒開始過，不算擋路；其他沒做完或還在做的節點都擋。 */
export function isBlocking(state: NodeState): boolean {
  if (state.status === 'done' || state.status === 'skip') return false
  return !(state.status === 'not-started' && state.node.optional === true)
}

/** 階段顯示用的標籤：審查階段第 2 輪起附「（第 N 輪）」，其餘階段原樣顯示 stage.label。 */
export function stageLabelFor(stage: MissionStage, mission: Mission): string {
  if (stage.id === REVIEW_STAGE_ID && (mission.review?.round ?? 0) >= 2) {
    return `${stage.label}（第 ${mission.review?.round} 輪）`
  }
  return stage.label
}

// band.ts 也要用（畫 tabs／算高度預算），所以是 export 的。
export function stageAt(flow: MissionFlow, index: number): MissionStage {
  const stage = flow.stages[index]
  if (stage === undefined) {
    throw new Error(`mission-band: 階段索引超出範圍：${index}`)
  }
  return stage
}

/** node.hint 可能是固定字串，也可能是看任務當下狀態決定提示文字的函式（例如 acceptance-run）。 */
export function resolveNodeHint(node: MissionFlowNode, mission: Mission): string {
  return typeof node.hint === 'function' ? node.hint(mission) : node.hint
}

/** 節點顯示用的名字：有 label 就用 label（同一個 skill 負責好幾個節點時，用 skill 名稱加上分項），沒有就退回 id。band.ts 的窄寬單行也用同一條規則。 */
export function displayName(node: MissionFlowNode): string {
  return node.label ?? node.id
}

/** 目前階段裡下一步該做什麼；全部做完就提示 /mission-next 或 /mission-finish。 */
/** MR 已關閉沒合併時，不管哪個節點還沒做完都該這樣收尾——跟 finishMission 的用法一致。 */
function closedMrHint(mission: Mission): string {
  return `MR 已關閉沒合併，用 /mission-finish ${mission.name} --force 收尾`
}

export function nextStepHint(flow: MissionFlow, mission: Mission): string {
  const stage = stageAt(flow, mission.stage)

  // 審查階段的 MR 狀態一旦確定（合併或關閉），不管節點做完沒做完都該直接講這件事——
  // 不然 MR 已經關閉了，還會卡在某個節點自己的提示（例如「等同事看過」），誤導使用者
  // 繼續等一個已經不會發生的審查。這兩種狀態要排在逐節點迴圈之前判斷。
  if (stage.id === REVIEW_STAGE_ID) {
    if (mission.review?.mrState === 'closed') return closedMrHint(mission)
    if (mission.review?.mrState === 'merged') return `MR 已合併，/mission-next 進入「${stageAt(flow, mission.stage + 1).label}」`
  }

  const states = nodeStates(stage.nodes, mission)

  for (const [i, state] of states.entries()) {
    if (state.status === 'done' || isTransparent(state)) continue
    if (state.status === 'not-started') return resolveNodeHint(state.node, mission)
    // started：同階段更晚的節點裡，跳過已經做完或不擋路的（skip 或從沒開始過的 optional），才是真的接下來要做的事
    const upcoming = states.slice(i + 1).find(s => s.status !== 'done' && !isTransparent(s))
    if (upcoming !== undefined) return `進行中：${displayName(state.node)}　${resolveNodeHint(upcoming.node, mission)}`
    // 雙軌節點（例如 code-review）已經開始卻等不到後面佐證：至少還有一條軌道沒跑過，
    // 直接提示那條軌道該怎麼做（或怎麼跳過），不要只講「進行中」。
    const missingTrack = state.trackStates?.find(s => s.status === 'pending')
    if (missingTrack !== undefined) return `進行中：${displayName(state.node)}　${missingTrack.track.hint}`
    return `進行中：${displayName(state.node)}`
  }

  const isLastStage = mission.stage === flow.stages.length - 1

  // 走到這裡：審查階段的 MR 還是 opened（或還沒同步過，mrState undefined）——節點全部做完
  // 也不能直接 /mission-next，要不要進「收尾」看下一次同步會不會帶回 merged。
  if (stage.id === REVIEW_STAGE_ID) return '跑 /mission-review 同步 MR 狀態；合併後才能進入下一階段'

  // 不擋路的節點（跳過、或從沒開始過的 optional）不算「實際上的最後一個節點」，
  // 不然軟化語氣會講到一個使用者根本沒碰過的 optional 節點上。
  const practicalNodes = states.filter(s => !isTransparent(s))
  const lastNode = practicalNodes.at(-1)

  // lastNode 的 done 只可能來自「它是（扣掉後面不擋路的節點後）最後一個、自己開始就算數」，
  // 不像前面的節點有更晚的節點佐證，所以提示語氣要是「完成後」而不是「已經完成」。
  if (lastNode !== undefined && lastNode.status === 'done') {
    return isLastStage
      ? `${lastNode.node.id} 完成後，/mission-finish 清除紀錄`
      : `${lastNode.node.id} 完成後，/mission-next 進入「${stageAt(flow, mission.stage + 1).label}」`
  }

  return isLastStage
    ? '全部完成，/mission-finish 清除紀錄'
    : `這階段完成，/mission-next 進入「${stageAt(flow, mission.stage + 1).label}」`
}

/**
 * 還在實作階段、且進入實作階段之後 to-tickets 又跑過一次；band 要提示票可能有變動，檢查 issue
 * 描述要不要同步。離開實作階段（驗收、收尾）之後就不再提示——那時候票的狀態已經是收尾階段該處理
 * 的事，不該繼續佔著這個提示位置。
 */
export function ticketsChangedSinceBuild(flow: MissionFlow, mission: Mission): boolean {
  const buildIndex = flow.stages.findIndex(s => s.id === BUILD_STAGE_ID)
  if (buildIndex === -1 || mission.stage !== buildIndex) return false
  const enteredAt = stageEnteredAt(mission, buildIndex)
  return mission.events.some(event => event.at >= enteredAt && event.kind === 'skill' && stripPluginPrefix(event.name) === 'to-tickets')
}
