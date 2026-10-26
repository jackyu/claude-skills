// /mission-start 前的 setup 檢查，問出事實的那一半：跟 register.tsx 分開放，讓它專心做
// hook 註冊。setup.ts 只管「給定事實、缺什麼」的純函式，這裡才碰 $.fs／$.env／$.session。
import type { EngineInterface } from 'claude-code'

import type { SetupFacts } from './setup'

const CLAUDE_MD_NAME = 'CLAUDE.md'
const ISSUE_TRACKER_PATH = 'docs/agents/issue-tracker.md'
const PSTACK_MODELS_RELATIVE_PATH = '.claude/rules/pstack-models.md'

// fs.exists／fs.read 偶爾會因為權限或暫時性 I/O 錯誤丟出例外（不只是「檔案不存在」那種
// 正常回 false 的情況）；/mission-start 絕對不能因為這種意外被整個拋出去，查不到就當作缺檔，
// 讓使用者看到「缺什麼」而不是看到一個沒處理過的錯誤堆疊。
async function safeExists($: EngineInterface, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch (error) {
    $.ui.log(`mission-band: 檢查「${path}」是否存在失敗，當作不存在：${String(error)}`)
    return false
  }
}

async function safeRead($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch (error) {
    $.ui.log(`mission-band: 讀取「${path}」失敗，當作沒有內容：${String(error)}`)
    return undefined
  }
}

/** 問出 /mission-start 前要檢查的三件事；讀檔前都先確認存在，不靠 fs.read 的 rejects 分支。 */
export async function gatherSetupFacts($: EngineInterface): Promise<SetupFacts> {
  const repo = await $.session.repo()
  const inRepo = repo !== null
  const root = await $.session.root()

  const claudeMdPath = `${root}/${CLAUDE_MD_NAME}`
  const claudeMdExists = inRepo && (await safeExists($, claudeMdPath))
  const claudeMdText = claudeMdExists ? await safeRead($, claudeMdPath) : undefined

  const issueTrackerExists = inRepo && (await safeExists($, `${root}/${ISSUE_TRACKER_PATH}`))

  const home = await $.env.get('HOME')
  const pstackModelsExists = home !== undefined && (await safeExists($, `${home}/${PSTACK_MODELS_RELATIVE_PATH}`))

  return { inRepo, claudeMdText, issueTrackerExists, pstackModelsExists }
}
