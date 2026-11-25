import type { EngineInterface, HookFailure } from 'claude-code'

const STORE_KEY = 'hookFailures'
const MAX_RECORDS = 20
const RECENT_RECORDS_SHOWN = 5

export type HookFailureRecord = { readonly at: number; readonly hook: string; readonly kind: string; readonly message?: string }

async function loadHookFailures($: EngineInterface): Promise<readonly HookFailureRecord[]> {
  const stored = await $.store.get(STORE_KEY)
  return Array.isArray(stored) ? (stored as HookFailureRecord[]) : []
}

/** 留一筆 hook 失敗記錄，最多 20 筆；跟前一筆完全相同就不記。store 出錯時靜默略過，不會 throw。 */
export async function recordHookFailure($: EngineInterface, hook: string, failure: HookFailure): Promise<void> {
  try {
    const current = await loadHookFailures($)
    const last = current.at(-1)
    if (last !== undefined && last.hook === hook && last.kind === failure.kind && last.message === failure.message) return

    const at = await $.clock.now()
    const next = [...current, { at, hook, kind: failure.kind, message: failure.message }].slice(-MAX_RECORDS)
    await $.store.set(STORE_KEY, next)
  } catch {
    return
  }
}

/** `/mission-log` 附的「最近 hook 失敗」區塊；沒有記錄或讀取失敗時回 undefined。 */
export async function recentHookFailuresText($: EngineInterface): Promise<string | undefined> {
  const records = await loadHookFailures($).catch(() => [])
  if (records.length === 0) return undefined

  const lines = records
    .slice(-RECENT_RECORDS_SHOWN)
    .map(r => `${new Date(r.at).toISOString()}　${r.hook}　${r.kind}${r.message === undefined ? '' : `：${r.message}`}`)
    .join('\n')
  return `最近的 hook 失敗：\n${lines}`
}

/** `command.run` 的 `.catch`：記一筆失敗，回一句帶指令名與原因的文字；store 寫不進去也照樣回。 */
export async function commandFailureCatch($: EngineInterface, commandName: string, error: HookFailure): Promise<{ text: string }> {
  await recordHookFailure($, `/${commandName}`, error)
  const detail = error.message === undefined ? '' : `：${error.message}`
  return { text: `mission-band：/${commandName} 失敗（${error.kind}）${detail}` }
}
