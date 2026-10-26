// /mission-start 前的 setup 檢查：純函式層，只處理「給定哪些事實、缺什麼」。
// register.tsx 負責問出事實（$.fs／$.env／$.session），這裡只決定結果。

const AGENT_SKILLS_HEADING = '## Agent skills'
const POCOCK_HINT = '/setup-matt-pocock-skills 已合進 origin/main，這個分支若較舊請先 rebase 到 origin/main'
const PSTACK_HINT = '請先執行 /setup-pstack'

/** register.tsx 從 $.fs／$.session 問出來的事實；不在 git repo 裡時 Pocock 兩項跳過不檢查。 */
export type SetupFacts = {
  inRepo: boolean
  claudeMdText: string | undefined
  issueTrackerExists: boolean
  pstackModelsExists: boolean
}

export type SetupGap = { item: string; hint: string }

/** /mission-start 前的檢查；缺任何一項都回報，不是只回報第一個。 */
export function setupGaps(facts: SetupFacts): SetupGap[] {
  const gaps: SetupGap[] = []

  if (facts.inRepo) {
    if (facts.claudeMdText === undefined || !facts.claudeMdText.includes(AGENT_SKILLS_HEADING)) {
      gaps.push({ item: 'CLAUDE.md 沒有「## Agent skills」這段', hint: POCOCK_HINT })
    }
    if (!facts.issueTrackerExists) {
      gaps.push({ item: 'docs/agents/issue-tracker.md 不存在', hint: POCOCK_HINT })
    }
  }

  if (!facts.pstackModelsExists) {
    gaps.push({ item: '~/.claude/rules/pstack-models.md 不存在', hint: PSTACK_HINT })
  }

  return gaps
}

export function formatSetupGaps(gaps: readonly SetupGap[]): string {
  const lines = gaps.map(gap => `- ${gap.item}（${gap.hint}）`)
  return `還沒設定好，無法建立任務：\n${lines.join('\n')}`
}
