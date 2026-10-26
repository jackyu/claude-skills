import { describe, expect, test } from 'claude-code/testing'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import type { Mission } from '../types'
import { nextAttachment, NO_MISSION_TEXT, progressText } from './prompt-context'

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    name: '1022-issue-#473',
    flow: 'new-feature',
    binding: '/repo',
    createdAt: 0,
    stage: 0,
    skips: {},
    events: [],
    ...overrides,
  }
}

const VERIFY = 2
const BUILD = 1

describe('progressText', () => {
  test('names the mission and marks the current stage among all stages', () => {
    const text = progressText(NEW_FEATURE_FLOW, mission({ stage: VERIFY }))
    expect(text).toContain('任務 1022-issue-#473')
    expect(text).toContain('開始 → 實作 → 「驗收」 → 審查 → 收尾')
  })

  test('lists unfinished nodes of the current stage with status and hint, by skill name', () => {
    const text = progressText(NEW_FEATURE_FLOW, mission({ stage: VERIFY }))
    expect(text).toContain('- blast-radius：還沒開始。提示：讀過 pstack 的 blast-radius 判準，確認改動的爆炸半徑')
    expect(text).toContain('- verify-acceptance/overall：還沒開始。')
  })

  test('marks optional nodes and keeps them in the unfinished list', () => {
    const text = progressText(NEW_FEATURE_FLOW, mission({ stage: VERIFY }))
    expect(text).toContain('- interrogate（選用）：還沒開始。')
  })

  test('moves done and skipped nodes to the finished line', () => {
    const m = mission({
      stage: VERIFY,
      skips: { 'acceptance-run': 'AC-6 UAT 沒資料' },
      events: [{ at: 1, kind: 'read', name: 'pstack:blast-radius' }],
    })
    const text = progressText(NEW_FEATURE_FLOW, m)
    expect(text).toContain('verify-acceptance 已跳過')
    expect(text).not.toContain('- verify-acceptance：')
    expect(text).not.toContain('- blast-radius：')
  })

  test('shows the track detail and the pending track hint for a two-track node', () => {
    const m = mission({ stage: BUILD, events: [{ at: 1, kind: 'skill', name: 'cr' }] })
    const text = progressText(NEW_FEATURE_FLOW, m)
    expect(text).toContain('- code-review：進行中（Claude ✓ · Codex ○）。提示：Codex 還沒審')
  })

  test('ends with the next step and the rules that stop the model from jumping ahead', () => {
    const text = progressText(NEW_FEATURE_FLOW, mission({ stage: VERIFY }))
    expect(text).toMatch(/下一步：.+/)
    expect(text).toContain('不要建議後面階段的事')
    expect(text).toContain('不要自己宣稱某步已完成')
  })

  test('says the stage is finished and points at /mission-next when nothing is left', () => {
    const skips = Object.fromEntries(NEW_FEATURE_FLOW.stages[VERIFY]!.nodes.map(n => [n.id, 'x']))
    const text = progressText(NEW_FEATURE_FLOW, mission({ stage: VERIFY, skips }))
    expect(text).toContain('這個階段的步驟都完成或跳過了')
    expect(text).toContain('/mission-next')
  })

  test('shows the round suffix on the current stage from round 2 onward, in both places it is mentioned', () => {
    const m = mission({ stage: 3, review: { round: 2, roundStartedAt: 0, discussions: [] } })
    const text = progressText(NEW_FEATURE_FLOW, m)
    expect(text).toContain('目前在「審查（第 2 輪）」階段')
    expect(text).toContain('開始 → 實作 → 驗收 → 「審查（第 2 輪）」 → 收尾')
  })

  test('MR closed (not merged): the "下一步" line suggests /mission-finish <名稱> --force, not a generic wait-for-review hint', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [], mrState: 'closed' } })
    const text = progressText(NEW_FEATURE_FLOW, m)
    expect(text).toContain('下一步：MR 已關閉沒合併，用 /mission-finish 1022-issue-#473 --force 收尾')
  })

  // bug C：關閉時不該再列一串「還沒完成」的節點（await-review 之類），那些清單已經沒有
  // 意義——MR 關了，不會再有人回饋也不會再核准，只留收尾提示就好。
  test('MR closed (not merged): omits the per-node pending list entirely, showing only the --force hint', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [], mrState: 'closed' } })
    const text = progressText(NEW_FEATURE_FLOW, m)
    expect(text).not.toContain('還沒完成')
    expect(text).not.toContain('await-review')
    expect(text).not.toContain('已完成或跳過')
  })
})

describe('nextAttachment', () => {
  test('attaches only when the text changed since the last attach', () => {
    expect(nextAttachment(undefined, 'A')).toBe('A')
    expect(nextAttachment('A', 'A')).toBeUndefined()
    expect(nextAttachment('A', 'B')).toBe('B')
  })

  test('says once that the mission is gone after one was attached, and nothing when none ever was', () => {
    expect(nextAttachment(undefined, undefined)).toBeUndefined()
    expect(nextAttachment('A', undefined)).toBe(NO_MISSION_TEXT)
    expect(nextAttachment(NO_MISSION_TEXT, undefined)).toBeUndefined()
  })
})
