// 把任務進度附在使用者送出的訊息後面給 AI 看（prompt.submit 的 context，使用者看不到）。
// band 只畫給人看，AI 拿不到進度，被問「下一步」時會自己猜，例如驗收還沒做完就叫人 push。
// 不放 system prompt：prompt.compose 在同一段對話只有第一次的答案會送出去，之後改了也沒用。
// 文字只在進度變了才附，舊的留在對話歷史裡，所以開頭要寫明以最新一則為準。
import type { EngineInterface, PromptSubmitInput } from 'claude-code'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import type { Mission, MissionFlow } from '../types'
import { findBoundMission } from './model'
import { displayName, nextStepHint, nodeStates, resolveNodeHint, REVIEW_STAGE_ID, stageAt, stageLabelFor, type NodeState } from './node-states'
import { currentBinding, loadMissions } from './store'

const HEADER = '[mission-band 任務進度] 以最新的一則為準，較早的已經過時。'

export const NO_MISSION_TEXT = '[mission-band 任務進度] 這裡已經沒有綁定任務，之前的進度不再適用。'

const RULES = [
  '規則：',
  '- 使用者問下一步、或問能不能往下做時，照這份進度回答',
  '- 目前階段的步驟做完、或使用者用 /mission-skip 跳過之前，不要建議後面階段的事（例如還在驗收就叫人開 MR）',
  '- 進度由 mission-band 從實際發生的事件判斷，不要自己宣稱某步已完成；/mission-* 指令只有使用者能打',
  '- 這是使用者送出訊息當下的快照：這一回合你自己剛做完的步驟還沒反映在上面',
]

const STATUS_TEXT = { 'not-started': '還沒開始', started: '進行中' } as const

function pendingLine(state: NodeState, mission: Mission): string {
  const optional = state.node.optional === true ? '（選用）' : ''
  const status = state.status === 'started' ? STATUS_TEXT.started : STATUS_TEXT['not-started']
  const detail = state.detail === undefined ? '' : `（${state.detail}）`
  // 雙軌節點已經有一條跑過時，提示還沒跑的那條怎麼做，比節點本身的總提示具體。
  const pendingTrack = state.status === 'started' ? state.trackStates?.find(s => s.status === 'pending') : undefined
  const hint = pendingTrack?.track.hint ?? resolveNodeHint(state.node, mission)
  return `- ${displayName(state.node)}${optional}：${status}${detail}。提示：${hint}`
}

function finishedItem(state: NodeState): string {
  return state.status === 'skip' ? `${displayName(state.node)} 已跳過` : `${displayName(state.node)} ✓`
}

/** 綁在這裡的任務目前進度，給 AI 讀的純文字；內容沒變時字串也一樣，呼叫端靠這點判斷要不要再附。 */
export function progressText(flow: MissionFlow, mission: Mission): string {
  const stage = stageAt(flow, mission.stage)
  const stages = flow.stages.map((s, i) => (i === mission.stage ? `「${stageLabelFor(s, mission)}」` : s.label)).join(' → ')
  const header = [HEADER, `任務 ${mission.name}，目前在「${stageLabelFor(stage, mission)}」階段（${stages}）。`]

  // MR 已關閉沒合併時，節點待辦清單已經沒有意義（不會再有人回饋、也不會再核准），
  // 只留 --force 收尾的提示，不要跟一串「還沒開始」的節點混在一起讓人分心。
  if (stage.id === REVIEW_STAGE_ID && mission.review?.mrState === 'closed') {
    return [...header, `下一步：${nextStepHint(flow, mission)}`, ...RULES].join('\n')
  }

  const states = nodeStates(stage.nodes, mission)
  const pending = states.filter(s => s.status === 'not-started' || s.status === 'started')
  const finished = states.filter(s => s.status === 'done' || s.status === 'skip')

  const lines = [...header]
  if (pending.length === 0) {
    lines.push('這個階段的步驟都完成或跳過了。')
  } else {
    lines.push('這個階段還沒完成：', ...pending.map(s => pendingLine(s, mission)))
  }
  if (finished.length > 0) lines.push(`已完成或跳過：${finished.map(finishedItem).join('、')}`)
  lines.push(`下一步：${nextStepHint(flow, mission)}`, ...RULES)
  return lines.join('\n')
}

/**
 * 這回合要附的文字：跟上次附的一樣就回 undefined。沒綁任務（text 是 undefined）時，只有
 * 之前附過進度才補一句「進度作廢」，免得 AI 照著舊進度回答。
 */
export function nextAttachment(last: string | undefined, text: string | undefined): string | undefined {
  const next = text ?? (last === undefined || last === NO_MISSION_TEXT ? undefined : NO_MISSION_TEXT)
  return next === last ? undefined : next
}

// 上次附了什麼是這個 session 自己的事，存在 $.state（hot reload 不會丟）；ref 要是這個檔案裡的字面常數。
// 送出時先記成 pending，主迴圈的回合真的跑完才轉成 text（已附）：prompt 被下層 drop 掉，或是
// /model 這類不經過模型的指令，都不會有回合結束，下一則就會重附。
const progressRef = { plugin: 'mission-band', key: 'progressContext' } as const

/**
 * 把這回合該附的進度加進 e.context。/mission-* 指令一定不經過模型，直接跳過。
 * /clear 之後 session id 會換，視同新對話重附一次。
 */
export async function withProgressContext($: EngineInterface, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (e.command?.name.startsWith('mission-') === true || e.isMeta === true) return e
  const sessionId = await $.session.id()
  const { value: held } = await $.state.get(progressRef)
  const attached = held?.sessionId === sessionId ? held.text : null

  const bound = findBoundMission(await loadMissions($), await currentBinding($))
  const extra = nextAttachment(attached ?? undefined, bound === undefined ? undefined : progressText(NEW_FEATURE_FLOW, bound[1]))
  if (extra === undefined) return e

  await $.state.set(progressRef, { sessionId, text: attached, pending: extra })
  return { ...e, context: [...(e.context ?? []), extra] }
}

/** 主迴圈的回合跑完時呼叫：這回合送出的進度模型已經讀到，記成已附。 */
export async function confirmProgressContext($: EngineInterface): Promise<void> {
  const { value: held } = await $.state.get(progressRef)
  if (held?.pending == null) return
  await $.state.set(progressRef, { sessionId: held.sessionId, text: held.pending, pending: null })
}

/** 對話被壓縮後，舊的進度可能被摘要掉；清掉紀錄，下一回合不管有沒有變都重附一次。 */
export async function resetProgressContext($: EngineInterface): Promise<void> {
  await $.state.set(progressRef, { sessionId: null, text: null, pending: null })
}
