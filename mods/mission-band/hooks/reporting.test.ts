import { describe, expect, test } from 'claude-code/testing'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import type { Mission, Missions } from '../types'
import { listMissionsText, missionLogText } from './reporting'

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    name: 'demo',
    flow: 'new-feature',
    binding: '/repo',
    createdAt: 0,
    stage: 0,
    skips: {},
    events: [],
    ...overrides,
  }
}

describe('listMissionsText and missionLogText', () => {
  test('lists every mission and marks the one bound here', () => {
    const missions: Missions = { demo: mission(), other: mission({ name: 'other', binding: '/repo-2' }) }
    const text = listMissionsText(missions, '/repo', NEW_FEATURE_FLOW)
    expect(text).toContain('demo')
    expect(text).toContain('← 目前')
  })

  test('says so when nothing is bound here', () => {
    expect(missionLogText({}, '/repo')).toContain('沒有綁定')
  })

  test('lists the events of the bound mission', () => {
    const missions: Missions = { demo: mission({ events: [{ at: 1, kind: 'skill', name: 'x:grill-with-docs' }] }) }
    expect(missionLogText(missions, '/repo')).toContain('grill-with-docs')
  })

  test('appends the missing MR sections to a product mr event, and omits them when none are missing', () => {
    const withMissing: Missions = {
      demo: mission({ events: [{ at: 1, kind: 'product', name: 'mr', missingSections: ['Merge Danger', 'Evidence'] }] }),
    }
    expect(missionLogText(withMissing, '/repo')).toContain('缺：Merge Danger、Evidence')

    const clean: Missions = { demo: mission({ events: [{ at: 1, kind: 'product', name: 'mr', missingSections: [] }] }) }
    expect(missionLogText(clean, '/repo')).not.toContain('缺：')
  })

  test('appends the round number to a review-sync product event, for /mission-log history', () => {
    const missions: Missions = { demo: mission({ events: [{ at: 1, kind: 'product', name: 'review-sync', round: 2 }] }) }
    expect(missionLogText(missions, '/repo')).toContain('第 2 輪')
  })

  test('warns on the list once the store is bigger than 2 MiB, without deleting anything', () => {
    const giantReason = 'x'.repeat(3 * 1024 * 1024)
    const missions: Missions = { demo: mission({ skips: { prototype: giantReason } }) }
    const text = listMissionsText(missions, '/repo', NEW_FEATURE_FLOW)
    expect(text).toContain('demo')
    expect(text).toContain('MiB')
    expect(text).toContain('/mission-finish')
  })

  test('listMissionsText shows the review round suffix on the stage label', () => {
    const missions: Missions = { demo: mission({ stage: 3, review: { round: 2, roundStartedAt: 0, discussions: [] } }) }
    expect(listMissionsText(missions, '/repo', NEW_FEATURE_FLOW)).toContain('審查（第 2 輪）')
  })

  test('shows a session-bound mission as being in the main checkout', () => {
    const text = listMissionsText({ '1022-#473': mission({ name: '1022-#473', binding: 'session:sess-1' }) }, '/elsewhere', NEW_FEATURE_FLOW)
    expect(text).toContain('主 checkout')
    expect(text).not.toContain('session:')
  })
})
