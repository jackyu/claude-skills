// 純函式層：不碰 $，只處理資料。register.tsx 負責讀寫 $.store／$.state，這裡只決定「結果該是什麼」。
// band 版面在 hooks/band.ts、setup 檢查在 hooks/setup.ts、commit／MR／issue 留言的偵測與判讀在
// hooks/products.ts、節點狀態與下一步提示在 hooks/node-states.ts（這裡原樣轉出去，呼叫端的
// import 路徑不用跟著改）、/mission-link 與 /mission-unlink 在 hooks/asset-commands.ts、
// /mission-list 與 /mission-log 的文字格式化在 hooks/reporting.ts，各自獨立成檔；這裡只留
// 指令解析與任務的增刪改查。
import type { Mission, MissionEvent, MissionFlow, MissionStage, Missions, NodeId } from '../types'
import { addCollectedAssets, ownIssueAsset } from './assets'
import { normalizeLabel } from './command-args'
import { isBlocking, nodeStates, REVIEW_STAGE_ID, stageAt, stageEnteredAt } from './node-states'

export { stripPluginPrefix, stageEnteredAt, nodeStates, stageAt, stageLabelFor, nextStepHint, ticketsChangedSinceBuild, REVIEW_STAGE_ID } from './node-states'
export type { NodeState, NodeStatus } from './node-states'

const EVENTS_CAP = 300
const ISSUE_SUFFIX_PATTERN = /#(\d+)$/
const SESSION_BINDING_PREFIX = 'session:'
const STORE_SIZE_WARNING_BYTES = 2 * 1024 * 1024

/** 推進到 stageIndex 時要寫回的完整陣列；補齊中間缺的 index，避免陣列有洞。 */
function withStageEnteredAt(mission: Mission, stageIndex: number, now: number): number[] {
  const next: number[] = []
  for (let i = 0; i <= stageIndex; i += 1) {
    next[i] = i === stageIndex ? now : stageEnteredAt(mission, i)
  }
  return next
}

// ===== 事件路由 =====

/** 找出綁定在這個 binding 的任務；一個 binding 同時只會綁定一個（由 start／restore 保證）。 */
export function findBoundMission(missions: Missions, binding: string): readonly [string, Mission] | undefined {
  const entry = Object.entries(missions).find(([, mission]) => mission.binding === binding)
  return entry
}

/** 把 session id 記到綁在這裡的任務；沒綁任務或已經記過就回傳同一個參考，mutate 才不會白寫 store。 */
export function withSessionId(missions: Missions, binding: string, sessionId: string): Missions {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return missions
  const [name, mission] = bound
  const ids = mission.sessionIds ?? []
  if (ids.includes(sessionId)) return missions
  return { ...missions, [name]: { ...mission, sessionIds: [...ids, sessionId] } }
}

export function appendMissionEvent(mission: Mission, event: MissionEvent): Mission {
  return { ...mission, events: [...mission.events, event].slice(-EVENTS_CAP) }
}

/**
 * 事件只會記到綁定在這個 binding 的任務；沒有任務綁在這個 binding 就原樣放過，不記錄。
 * 沒有變化時回傳原來的 missions 參考（不是新物件），讓呼叫端用 === 判斷要不要真的寫回 store。
 */
export function routeEvent(missions: Missions, binding: string, event: MissionEvent): Missions {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return missions
  const [name, mission] = bound
  return { ...missions, [name]: appendMissionEvent(mission, event) }
}

/**
 * 自動收集到的網址（prompt／Bash stdout）只會併進綁定在這個 binding 的任務；
 * 跟 routeEvent 一樣，沒有變化時回傳原來的 missions 參考。
 */
export function routeAssets(
  missions: Missions,
  binding: string,
  urls: readonly string[],
  source: 'prompt' | 'tool',
  now: number,
  ownProjectPath: string | undefined,
): Missions {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return missions
  const [name, mission] = bound
  const updated = addCollectedAssets(mission, urls, source, now, ownProjectPath)
  if (updated === mission) return missions
  return { ...missions, [name]: updated }
}

// 去掉日期前綴，提示裡給 #473 比 1022-#473 好打；hooks/handoff.ts 的 /mission-go 也要用。
export function shortName(name: string): string {
  return name.replace(/^\d{4}-/, '')
}

function withoutMission(missions: Missions, name: string): Missions {
  return Object.fromEntries(Object.entries(missions).filter(([key]) => key !== name))
}

// ===== 指令：引數解析（詳見 hooks/command-args.ts） =====

/** 任務名稱結尾是不是 #<issue 號>；是的話回傳號碼，拿去跟 repo remote 組出 issue 網址。 */
export function issueIidFromMissionName(name: string): string | undefined {
  return ISSUE_SUFFIX_PATTERN.exec(name)?.[1]
}

/** 主 checkout 會同時被好幾個分析中的 session 共用，綁路徑會撞在一起，所以改綁 session；worktree 一個分支一個目錄，綁路徑才能在新 session 接回。 */
export function bindingFor(root: string, repoRoot: string | undefined, sessionId: string): string {
  return repoRoot === root ? `${SESSION_BINDING_PREFIX}${sessionId}` : root
}

export function isSessionBinding(binding: string): boolean {
  return binding.startsWith(SESSION_BINDING_PREFIX)
}

export function matchesName(name: string, query: string): boolean {
  return name === query || name.endsWith(`-${normalizeLabel(query)}`)
}

export type ResolvedName = { name: string } | { error: string }

/** 接受完整名稱，或省略日期的 #issue／名稱；省略日期對到多個任務就要求打完整名稱。 */
export function resolveMissionName(missions: Missions, query: string): ResolvedName {
  if (query in missions) return { name: query }

  const hits = Object.keys(missions).filter(name => matchesName(name, query))
  const [only] = hits
  if (hits.length === 1 && only !== undefined) return { name: only }
  if (hits.length === 0) return { error: `找不到任務「${query}」，用 /mission-list 看有哪些` }
  return { error: `「${query}」對到好幾個任務：${hits.join('、')}，請打完整名稱` }
}

// ===== 指令：會改資料的 =====

export type CommandOutcome = { ok: true; missions: Missions; text: string } | { ok: false; text: string }

// issueUrl／issueIid 只在任務名稱結尾是 #<issue 號>、且 repo remote 組得出網址時才有值；
// 這個資產不靠猜（直接拿 repo remote 組出來），所以不經一般的分類與撞名流程。
export function startMission(
  missions: Missions,
  name: string,
  binding: string,
  now: number,
  issueUrl?: string,
  issueIid?: string,
): CommandOutcome {
  if (name in missions) return { ok: false, text: `任務「${name}」已經存在，要接回請打 /mission-restore ${name}` }

  const bound = findBoundMission(missions, binding)
  if (bound !== undefined) return { ok: false, text: `這裡已經綁定任務「${bound[0]}」` }

  const assets = issueUrl !== undefined && issueIid !== undefined ? [ownIssueAsset(issueUrl, issueIid, now)] : []
  const mission: Mission = {
    name,
    flow: 'new-feature',
    binding,
    createdAt: now,
    stage: 0,
    skips: {},
    events: [],
    assets,
    stageEnteredAt: [now],
  }
  return { ok: true, missions: { ...missions, [name]: mission }, text: `已建立任務「${name}」` }
}

export function restoreMission(missions: Missions, binding: string, query: string): CommandOutcome {
  const resolved = resolveMissionName(missions, query)
  if ('error' in resolved) return { ok: false, text: resolved.error }

  const { name } = resolved
  const mission = missions[name]
  if (mission === undefined) return { ok: false, text: `找不到任務「${name}」` }

  const bound = findBoundMission(missions, binding)
  if (bound !== undefined && bound[0] !== name) return { ok: false, text: `這裡已經綁定任務「${bound[0]}」` }

  // 在主 checkout 綁 session，不碰 worktreePath；在別的目錄接回來，那個目錄就是 worktree 本身。
  const worktreePath = isSessionBinding(binding) ? mission.worktreePath : binding
  return {
    ok: true,
    missions: { ...missions, [name]: { ...mission, binding, worktreePath } },
    text: `已將任務「${name}」綁定到這裡`,
  }
}

/** 哪個節點、哪條軌道的 legacySkipIds 裡列了這個舊 id；找不到就是 undefined。 */
function legacyTrackFor(stage: MissionStage, legacyId: string): { nodeId: NodeId; trackId: string } | undefined {
  for (const node of stage.nodes) {
    const track = node.tracks?.find(t => (t.legacySkipIds ?? []).includes(legacyId))
    if (track !== undefined) return { nodeId: node.id, trackId: track.id }
  }
  return undefined
}

/**
 * `<nodeId>` 跳過整個節點；`<nodeId>:<trackId>` 只跳過雙軌節點（例如 code-review）底下的
 * 一條軌道——寫回 mission.skips 的 key 原樣帶著冒號，跟整節點跳過的 key 分開，
 * node-states.ts 的 isTrackSkipped 只認這個格式。沒有冒號、但剛好是某條軌道合併前的舊 id
 * （例如 codex-review），就當成在跳過那條軌道，寫回新格式的 key，不當成找不到節點。
 */
export function skipNode(missions: Missions, binding: string, nodeId: NodeId, reason: string, flow: MissionFlow): CommandOutcome {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return { ok: false, text: '這裡沒有綁定任務' }

  const [name, mission] = bound
  const stage = stageAt(flow, mission.stage)
  const colonIndex = nodeId.indexOf(':')
  let key = nodeId

  if (colonIndex !== -1) {
    const baseId = nodeId.slice(0, colonIndex)
    const trackId = nodeId.slice(colonIndex + 1)
    const trackExists = stage.nodes.find(node => node.id === baseId)?.tracks?.some(track => track.id === trackId) === true
    if (!trackExists) return { ok: false, text: `「${nodeId}」不是目前階段「${stage.label}」裡的節點或軌道` }
  } else if (!stage.nodes.some(node => node.id === nodeId)) {
    // band 上顯示的是 label，使用者照畫面打也要認得
    const byLabel = stage.nodes.find(node => node.label === nodeId)
    const legacy = byLabel === undefined ? legacyTrackFor(stage, nodeId) : undefined
    if (byLabel !== undefined) key = byLabel.id
    else if (legacy !== undefined) key = `${legacy.nodeId}:${legacy.trackId}`
    else {
      const ids = stage.nodes.map(node => node.id).join('、')
      return { ok: false, text: `「${nodeId}」不在目前階段「${stage.label}」裡；可用的 id：${ids}` }
    }
  }

  const updated: Mission = { ...mission, skips: { ...mission.skips, [key]: reason } }
  return { ok: true, missions: { ...missions, [name]: updated }, text: `已跳過「${key}」：${reason}` }
}

/**
 * 審查階段不吃一般的「節點都做完才能走」規則：要不要進「收尾」看 MR 是不是真的合併了
 * （/mission-review 同步出來的事實），不是節點判斷得出來的——節點全部做完但 MR 還沒合併
 * 一樣要擋住，MR 被關閉沒合併也一樣要擋住，提示改走 /mission-finish --force。
 */
export function nextStage(missions: Missions, binding: string, flow: MissionFlow, now: number, domainDocsDirty: boolean): CommandOutcome {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return { ok: false, text: '這裡沒有綁定任務' }

  const [name, mission] = bound
  const stage = stageAt(flow, mission.stage)

  if (stage.id === REVIEW_STAGE_ID) {
    if (mission.review?.mrState !== 'merged') {
      return { ok: false, text: `MR 還沒合併。跑 /mission-review 同步狀態；MR 被關閉沒合併就用 /mission-finish ${name} --force` }
    }
  } else {
    const states = nodeStates(stage.nodes, mission)
    const pending = states.filter(isBlocking)
    if (pending.length > 0) {
      const list = pending.map(s => s.node.id).join('、')
      return { ok: false, text: `這個階段還沒做完：${list}` }
    }
  }

  if (mission.stage === flow.stages.length - 1) {
    return { ok: false, text: '已經是最後階段了，用 /mission-finish 清除紀錄' }
  }

  const nextIndex = mission.stage + 1
  // 進入審查階段時才建立 review 狀態（第 1 輪從進入審查開始算，不是從第一次同步算）；
  // 已經有 review 狀態（理論上不會發生：審查階段只會進入一次）就不覆蓋。
  const enteringReview = mission.review === undefined && stageAt(flow, nextIndex).id === REVIEW_STAGE_ID
  const review = enteringReview ? { round: 1, roundStartedAt: now, discussions: [] } : mission.review
  const updated: Mission = { ...mission, stage: nextIndex, stageEnteredAt: withStageEnteredAt(mission, nextIndex, now), review }
  const entered = `已進入「${stageAt(flow, updated.stage).label}」`
  // 分析在主 checkout 做完，實作要換到 worktree 的新 session；worktree 在「開始」階段就建好了
  // （create-worktree 節點），/mission-go 會自動開新分頁並打 /mission-restore，這裡只是指路。
  // 已經在 worktree 就建議 /clear：每次呼叫模型都要重讀整段對話，越後面的階段越貴；
  // 各階段要接的資料都在 spec、驗收清單和任務紀錄裡，不靠對話記憶。收尾例外：/retro 回顧的就是這段對話。
  const dirtyPrefix = domainDocsDirty ? '先把 GLOSSARY.md／ADR 的改動搬到 worktree，' : ''
  const enteringLast = nextIndex === flow.stages.length - 1
  const text = isSessionBinding(binding)
    ? `${entered}\n下一步：${dirtyPrefix}打 /mission-go 在 worktree 開新分頁接續（留在這裡 cd 進去開發也追蹤得到）`
    : enteringLast
      ? `${entered}\n先不要 /clear：/retro 要回顧這段對話`
      : `${entered}\n建議先 /clear 再開始：任務綁在 worktree 路徑，清掉對話不會斷線，下一個階段從小的上下文開始累積；需要帶著前面的討論就改用 /compact`
  return { ok: true, missions: { ...missions, [name]: updated }, text }
}

export function finishMission(
  missions: Missions,
  binding: string,
  name: string | undefined,
  force: boolean,
  flow: MissionFlow,
): CommandOutcome {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return { ok: false, text: '這裡沒有綁定任務' }

  const [boundName, mission] = bound
  const lastStage = flow.stages.length - 1

  if (mission.stage === lastStage) {
    return { ok: true, missions: withoutMission(missions, boundName), text: `已清除任務「${boundName}」` }
  }

  if (force && name !== undefined && matchesName(boundName, name)) {
    return {
      ok: true,
      missions: withoutMission(missions, boundName),
      text: `已清除任務「${boundName}」（尚未到最後階段，強制清除）`,
    }
  }

  const stageLabel = stageAt(flow, mission.stage).label
  return {
    ok: false,
    text: `任務「${boundName}」還沒到最後階段（目前：${stageLabel}）。要清除請輸入 /mission-finish ${boundName} --force`,
  }
}

// listMissionsText／missionLogText 的文字格式化搬到 hooks/reporting.ts，用上面的 isSessionBinding／
// matchesName／stageAt／findBoundMission。
