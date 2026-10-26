// /mission-cost：從任務記下的 session id 找 transcript，算各階段的 token 用量。
// 解析 transcript 交給 scripts/mission-cost.py：檔案動輒幾十 MB，超過 $.fs.read 的 4 MiB 上限。
import type { EngineInterface } from 'claude-code'

import type { Mission, MissionFlow, Missions } from '../types'
import { type CommandOutcome, findBoundMission, resolveMissionName, withSessionId } from './model'
import { stageAt, stageEnteredAt } from './node-states'
import { currentBinding, loadMissions, mutate } from './store'

const SESSION_ID_PATTERN = /^[0-9a-f-]{8,}$/
const USAGE = '用法：/mission-cost [#<issue> | <名稱>] [--sessions <id>,<id>]'
const SCRIPT_TIMEOUT_MS = 120_000

export type ParsedCost = { query?: string; sessions: string[] } | { error: string }

export function parseCostArgs(args: string): ParsedCost {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const flagIndex = tokens.indexOf('--sessions')
  let sessions: string[] = []
  if (flagIndex !== -1) {
    const value = tokens[flagIndex + 1]
    if (value === undefined) return { error: USAGE }
    sessions = value.split(',').filter(Boolean)
    if (sessions.some(id => !SESSION_ID_PATTERN.test(id))) return { error: 'session id 至少要 8 碼（transcript 檔名的開頭）' }
    tokens.splice(flagIndex, 2)
  }
  const query = tokens[0]
  return query === undefined ? { sessions } : { query, sessions }
}

export type CostRequest = { sessions: string[]; stages: { label: string; from: number }[]; until: number }

export function buildCostRequest(mission: Mission, flow: MissionFlow, extraSessions: readonly string[], now: number): CostRequest {
  const sessions = [...new Set([...(mission.sessionIds ?? []), ...extraSessions])]
  const stages = []
  for (let i = 0; i <= mission.stage; i += 1) {
    stages.push({ label: stageAt(flow, i).label, from: stageEnteredAt(mission, i) })
  }
  return { sessions, stages, until: now }
}

type Usage = {
  calls: number
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
}

export type CostResult = {
  used: string[]
  missing: string[]
  ambiguous: string[]
  stages: { label: string; main: Usage; sub: Usage }[]
}

// 近似的 API 計價比例：快取讀 0.1、快取寫 1.25、輸出 5；只拿來比階段之間誰貴
function weighted(usage: Usage): number {
  return usage.input_tokens + 1.25 * usage.cache_creation_input_tokens + 0.1 * usage.cache_read_input_tokens + 5 * usage.output_tokens
}

function tenThousands(tokens: number): string {
  return `${(tokens / 10_000).toFixed(1)} 萬`
}

function millions(tokens: number): string {
  return `${(tokens / 1_000_000).toFixed(2)}M`
}

function stageLine(stage: CostResult['stages'][number]): string {
  const { main, sub } = stage
  if (main.calls === 0 && sub.calls === 0) return `${stage.label}：沒有用量`
  // 每次呼叫都要重讀整段上下文，所以「平均每次重讀多少」比總量更能看出對話是不是拉太長
  const context = main.input_tokens + main.cache_creation_input_tokens + main.cache_read_input_tokens
  const average = main.calls === 0 ? '' : `，平均每次重讀 ${tenThousands(context / main.calls)}`
  return `${stage.label}：主對話 ${main.calls} 次${average}；subagent ${sub.calls} 次；輸入等效 ${millions(weighted(main) + weighted(sub))}`
}

export function formatCostReport(name: string, result: CostResult): string {
  const total = result.stages.reduce((sum, s) => sum + weighted(s.main) + weighted(s.sub), 0)
  const lines = [`「${name}」各階段 token 用量（${result.used.length} 個 session）`, ...result.stages.map(stageLine)]
  lines.push(`合計輸入等效 ${millions(total)}（近似計價比例，不是額度公式）`)
  if (result.missing.length > 0) lines.push(`找不到 transcript：${result.missing.join('、')}`)
  if (result.ambiguous.length > 0) lines.push(`對到多份 transcript：${result.ambiguous.join('、')}，請給更長的 id`)
  lines.push('注意：這些 session 在同一段時間做的其他事也會算進去；Codex 不算')
  return lines.join('\n')
}

/** 把目前的 session id 記到綁在這裡的任務；/clear 會換新的 session id，所以每次都要檢查。 */
export async function rememberSession($: EngineInterface): Promise<void> {
  const binding = await currentBinding($)
  const sessionId = await $.session.id()
  await mutate($, missions => withSessionId(missions, binding, sessionId))
}

/** 指令不經模型回合、turn.complete 記不到，綁定或接回任務的指令要在同一次寫入裡補記。 */
export async function runMutationAndRemember($: EngineInterface, compute: (missions: Missions) => CommandOutcome): Promise<{ text: string }> {
  const binding = await currentBinding($)
  const sessionId = await $.session.id()
  let text = ''
  await mutate($, missions => {
    const outcome = compute(missions)
    text = outcome.text
    return outcome.ok ? withSessionId(outcome.missions, binding, sessionId) : missions
  })
  return { text }
}

export async function missionCostText($: EngineInterface, args: string, flow: MissionFlow): Promise<string> {
  const parsed = parseCostArgs(args)
  if ('error' in parsed) return parsed.error

  // /clear 後第一件事就打這個指令時，這個 session 還沒被 turn.complete 記到
  await rememberSession($)
  const missions = await loadMissions($)
  let name: string
  if (parsed.query === undefined) {
    const bound = findBoundMission(missions, await currentBinding($))
    if (bound === undefined) return '這裡沒有綁定任務；指定任務用 /mission-cost #<issue>'
    name = bound[0]
  } else {
    const resolved = resolveMissionName(missions, parsed.query)
    if ('error' in resolved) return resolved.error
    name = resolved.name
  }
  const mission = missions[name]
  if (mission === undefined) return `找不到任務「${name}」`

  const request = buildCostRequest(mission, flow, parsed.sessions, await $.clock.now())
  if (request.sessions.length === 0) return `「${name}」沒有記到 session id（舊任務），用 --sessions <id>,<id> 指定`

  const script = `${$.plugin.root}/scripts/mission-cost.py`
  const run = await $.process.run(['python3', '-I', script], { stdin: JSON.stringify(request), timeoutMs: SCRIPT_TIMEOUT_MS })
  if (run.exitCode !== 0) return `量測腳本失敗（exit ${run.exitCode}）：${run.stderr.trim().slice(0, 300)}`
  return formatCostReport(name, JSON.parse(run.stdout) as CostResult)
}

// 任務紀錄清掉後 worktree 跟分支還在；這句要排在成本報告之後、當整段回覆的最後一行。
const CLEANUP_HINT = '接著輸入 /cleanup 刪掉 worktree 和分支（在主 checkout 要帶分支名或 #issue）'

/**
 * /mission-finish 會把任務紀錄（階段時間、session id）整筆刪掉，刪了就量不到，所以先量再清。
 * 量失敗不擋 finish；finish 被拒（階段還沒做完）就不附報告，也不附 /cleanup 提示。
 */
export async function finishWithCost(
  $: EngineInterface,
  query: string | undefined,
  flow: MissionFlow,
  compute: (missions: Missions) => CommandOutcome,
): Promise<{ text: string }> {
  let report: string
  try {
    report = await missionCostText($, query ?? '', flow)
  } catch (error) {
    report = `成本沒量到：${String(error)}`
  }
  let outcome: CommandOutcome | undefined
  await mutate($, missions => {
    outcome = compute(missions)
    return outcome.ok ? outcome.missions : missions
  })
  if (outcome === undefined || !outcome.ok) return { text: outcome?.text ?? '' }
  return { text: `${outcome.text}\n\n${report}\n${CLEANUP_HINT}` }
}
