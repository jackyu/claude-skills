// $.store／$.state 的讀寫與綁定鍵計算；register.tsx 的每個 hook 都疊在這層上面，
// 拆出來是為了讓 register.tsx 專心做「註冊了哪些 hook」，不被底層讀寫細節塞滿。
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { MissionEventKind, Missions } from '../types'
import { projectPathFromRemote } from './assets'
import { bindingFor, routeAssets, routeEvent, type CommandOutcome } from './model'

// update／read／$.state.get／$.state.set 的 ref 只認得「這個檔案裡寫死的字面常數」，
// 所以 missionsRef／missionsState 不能從這裡 export 給別的檔案的 update／read 用；
// register.tsx 自己也宣告一份一樣的常數（ref 內容相同，底層就是同一份 state）。
const STORE_KEY = 'missions'
const missionsRef = { plugin: 'mission-band', key: 'missions' } as const
const missionsState = atom(missionsRef, {})

export async function loadMissions($: EngineInterface): Promise<Missions> {
  return ((await $.store.get(STORE_KEY)) as Missions | undefined) ?? {}
}

// 寫入前重新讀一次 store，縮小跟其他 session／worktree 同時寫入時的競爭視窗；
// fn 回傳跟讀進來的參考完全相同時代表沒有變化，就不要真的寫 store，否則每個 session
// 的每次事件都會把可能已經過期的 missions 整包蓋回去，洗掉別人剛寫的資料。
export async function mutate($: EngineInterface, fn: (missions: Missions) => Missions): Promise<Missions> {
  const current = await loadMissions($)
  const next = fn(current)
  if (next === current) return current

  await $.store.set(STORE_KEY, next)
  await update($, missionsState, () => next)
  return next
}

/**
 * band 只讀自己這個 session 的 state，跨 session 的變化（別的 session 跑了 /mission-finish
 * 或 /mission-restore）要靠呼叫端在每次送出 prompt 前補讀一次 store。這段是非同步的：中間
 * 如果同一個 session 自己的 mutate()（事件、指令）剛好把 atom 寫到更新的版本，就不能再用
 * 這裡讀到的舊 store 內容蓋回去。atom 的值本身每次 read() 都是新複製出來的，不能拿參考比較；
 * 改用 $.state 自己的版本號，寫回時帶 ifVersion，版本在這段非同步空檔裡被別人動過就直接放棄
 * 這次寫入（isSet 會是 false）。$.state.get／$.state.set 的 ref 只能是這個檔案裡的字面常數，
 * 所以這段不能搬到呼叫端自己做。
 */
export async function refreshMissionsState($: EngineInterface): Promise<void> {
  const held = await $.state.get(missionsRef)
  const missions = await loadMissions($)
  await $.state.set(missionsRef, missions, { ifVersion: held.version })
}

export async function runMutation($: EngineInterface, compute: (missions: Missions) => CommandOutcome): Promise<{ text: string }> {
  let text = ''
  await mutate($, missions => {
    const outcome = compute(missions)
    text = outcome.text
    return outcome.ok ? outcome.missions : missions
  })
  return { text }
}

// 綁定鍵不能在 session.start 快取起來：同一個 session 中途可能因為 /cd、EnterWorktree
// 或搬移 worktree 換到別的目錄，session.root() 的值會跟著變。每次要用都要重問引擎。
// session.repo().root 在 worktree 裡回傳的是主 checkout，只能拿來判斷「現在是不是在主 checkout」。
export async function currentBinding($: EngineInterface): Promise<string> {
  const root = await $.session.root()
  const repo = await $.session.repo()
  const sessionId = await $.session.id()
  return bindingFor(root, repo?.root, sessionId)
}

// tool.call 的 next(e) 在工具不同時型別會收斂成 unknown（ToolResultOf 對非字面 Name 收斂不出來），
// 用 type guard 自己確認有 stdout 字串欄位，而不是斷言成特定型別。背景 Bash 的結果沒有 stdout。
export function bashStdout(result: unknown): string {
  if (typeof result !== 'object' || result === null) return ''
  const stdout = (result as { stdout?: unknown }).stdout
  return typeof stdout === 'string' ? stdout : ''
}

export async function recordEvent(
  $: EngineInterface,
  event: {
    at: number
    kind: MissionEventKind
    name: string
    agentId?: string
    missingSections?: readonly string[]
    missingAcs?: readonly string[]
    mrIid?: string
    round?: number
  },
): Promise<void> {
  const binding = await currentBinding($)
  await mutate($, missions => routeEvent(missions, binding, event))
}

/**
 * 單一步驟自己的 try/catch：失敗只記這一步、繼續往下一步跑，不會連累同一個 tool.call
 * hook 裡其他步驟。外層那句泛用的 .catch(next(e)) 一旦接到沒處理過的例外就會重跑一次
 * 原本的指令，所以這裡的 catch 本身一定要走到底、不能再往外丟。
 */
export async function runStep($: EngineInterface, label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    $.ui.log(`mission-band: ${label}失敗：${String(error)}`)
  }
}

export async function recordAssets($: EngineInterface, urls: readonly string[], source: 'prompt' | 'tool'): Promise<void> {
  if (urls.length === 0) return
  const binding = await currentBinding($)
  const now = await $.clock.now()
  const repo = await $.session.repo()
  const ownProjectPath = projectPathFromRemote(repo?.remote ?? null)?.path
  await mutate($, missions => routeAssets(missions, binding, urls, source, now, ownProjectPath))
}
