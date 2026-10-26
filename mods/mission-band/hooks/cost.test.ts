import { describe, expect, test } from 'claude-code/testing'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import type { Mission } from '../types'
import { buildCostRequest, formatCostReport, parseCostArgs, type CostResult } from './cost'

function mission(overrides: Partial<Mission> = {}): Mission {
  return { name: '1022-#473', flow: 'new-feature', binding: '/wt', createdAt: 100, stage: 0, skips: {}, events: [], ...overrides }
}

function bucket(calls: number, read: number, write = 0, output = 0) {
  return { calls, input_tokens: 0, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output }
}

describe('parseCostArgs', () => {
  test('no args measures the mission bound here', () => {
    expect(parseCostArgs('')).toEqual({ sessions: [] })
  })

  test('takes a mission query and extra session ids', () => {
    expect(parseCostArgs('#473 --sessions 932280e8,de175123')).toEqual({ query: '#473', sessions: ['932280e8', 'de175123'] })
  })

  test('rejects a session id shorter than 8 characters', () => {
    expect(parseCostArgs('--sessions 9322')).toEqual({ error: expect.stringContaining('8 碼') })
  })

  test('rejects --sessions without a value', () => {
    expect(parseCostArgs('--sessions')).toEqual({ error: expect.stringContaining('用法') })
  })
})

describe('buildCostRequest', () => {
  test('one window per reached stage, falling back to createdAt for old data', () => {
    const request = buildCostRequest(mission({ stage: 2, stageEnteredAt: [100, 200] }), NEW_FEATURE_FLOW, [], 999)
    expect(request.stages).toEqual([
      { label: '開始', from: 100 },
      { label: '實作', from: 200 },
      { label: '驗收', from: 100 },
    ])
    expect(request.until).toBe(999)
  })

  test('merges recorded and extra session ids without duplicates', () => {
    const request = buildCostRequest(mission({ sessionIds: ['aaaaaaaa-1', 'bbbbbbbb-2'] }), NEW_FEATURE_FLOW, ['bbbbbbbb-2', 'cccccccc'], 999)
    expect(request.sessions).toEqual(['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc'])
  })
})

describe('formatCostReport', () => {
  const result: CostResult = {
    used: ['932280e8-x', 'de175123-y'],
    missing: [],
    ambiguous: [],
    stages: [
      { label: '開始', main: bucket(0, 0), sub: bucket(0, 0) },
      { label: '驗收', main: bucket(138, 26_400_000, 419_000, 72_000), sub: bucket(47, 1_000_000) },
    ],
  }

  test('leads with main-conversation calls and average re-read context per call', () => {
    const text = formatCostReport('1022-#473', result)
    expect(text).toContain('驗收：主對話 138 次，平均每次重讀 19.4 萬；subagent 47 次')
    expect(text).toContain('開始：沒有用量')
  })

  test('labels the weighted total as an approximation and states what is not counted', () => {
    const text = formatCostReport('1022-#473', result)
    expect(text).toContain('輸入等效')
    expect(text).toContain('近似計價比例，不是額度公式')
    expect(text).toContain('Codex 不算')
    expect(text).toContain('其他事也會算進去')
  })

  test('warns about session ids it could not find or that matched several files', () => {
    const text = formatCostReport('1022-#473', { ...result, missing: ['nope9999'], ambiguous: ['dup1abcd'] })
    expect(text).toContain('找不到 transcript：nope9999')
    expect(text).toContain('對到多份 transcript：dup1abcd')
  })
})
