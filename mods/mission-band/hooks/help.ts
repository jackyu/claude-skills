// band 的「?」按鈕跟 /mission-help 共用的開啟教學頁邏輯：macOS 用 `open` 開本機 HTML 檔。
// 按鈕的 onPress 不回文字給使用者，只管開檔，失敗就記 log；/mission-help 要回一句話，
// 開失敗就把路徑原樣交回去，讓使用者自己雙擊打開。跟 register.tsx 分開放，避免它繼續長下去。
import type { EngineInterface } from 'claude-code'

const GUIDE_RELATIVE_PATH = 'docs/guide.html'
const OPEN_TIMEOUT_MS = 10_000

export type OpenGuideResult = { ok: true } | { ok: false; path: string }

/** 教學頁的絕對路徑，跟著這個 mod 的安裝位置走，不寫死本機路徑。 */
export function guidePath($: EngineInterface): string {
  return `${$.plugin.root}/${GUIDE_RELATIVE_PATH}`
}

/** 開啟失敗（exit 非 0 或丟例外）都回報失敗，不讓錯誤炸出呼叫端——按鈕的 onPress 接不住 reject。 */
export async function openGuide($: EngineInterface): Promise<OpenGuideResult> {
  const path = guidePath($)
  try {
    const result = await $.process.run(['open', path], { timeoutMs: OPEN_TIMEOUT_MS })
    if (result.exitCode === 0) return { ok: true }
    $.ui.log(`mission-band: 開啟教學頁失敗（exit ${result.exitCode}）：${path}`)
    return { ok: false, path }
  } catch (error) {
    $.ui.log(`mission-band: 開啟教學頁失敗：${String(error)}`)
    return { ok: false, path }
  }
}

/** `/mission-help` 的回應文字：成功就一句提示，失敗把路徑交回去讓使用者自己開。 */
export async function missionHelpText($: EngineInterface): Promise<string> {
  const result = await openGuide($)
  return result.ok ? '已開啟教學頁（mission-band 使用說明）' : `開啟失敗，請自己開啟教學頁：${result.path}`
}
