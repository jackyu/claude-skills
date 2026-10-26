import { describe, expect, test } from 'claude-code/testing'

import type { Mission, Missions } from '../types'
import { missionAssets } from './assets'
import { linkAsset, parseLinkArgs, parseUnlinkArgs, unlinkAsset } from './asset-commands'

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

describe('parseLinkArgs and parseUnlinkArgs', () => {
  test('parseLinkArgs requires both a label and a url', () => {
    expect(parseLinkArgs('設計稿')).toEqual({ error: expect.any(String) })
    expect(parseLinkArgs('設計稿 https://figma.com/x')).toEqual({ label: '設計稿', url: 'https://figma.com/x' })
  })

  test('parseUnlinkArgs requires a label', () => {
    expect(parseUnlinkArgs('')).toEqual({ error: expect.any(String) })
    expect(parseUnlinkArgs('設計稿')).toEqual({ label: '設計稿' })
  })
})

describe('linkAsset and unlinkAsset', () => {
  test('linkAsset adds the asset to the mission bound here', () => {
    const missions: Missions = { demo: mission() }
    const outcome = linkAsset(missions, '/repo', '設計稿', 'https://figma.com/x', 1)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const demo = outcome.missions.demo
      expect(demo && missionAssets(demo)).toEqual([
        { url: 'https://figma.com/x', label: '設計稿', description: 'figma', source: 'manual', at: 1 },
      ])
    }
  })

  test('linkAsset refuses when nothing is bound here', () => {
    const outcome = linkAsset({}, '/repo', 'x', 'https://a', 1)
    expect(outcome.ok).toBe(false)
  })

  test('unlinkAsset removes the matching label and refuses an unknown one', () => {
    const missions: Missions = {
      demo: mission({ assets: [{ url: 'https://a', label: 'spec', description: '', source: 'manual', at: 0 }] }),
    }
    const removed = unlinkAsset(missions, '/repo', 'spec')
    expect(removed.ok).toBe(true)
    if (removed.ok) {
      const demo = removed.missions.demo
      expect(demo && missionAssets(demo)).toEqual([])
    }

    const refused = unlinkAsset(missions, '/repo', 'no-such')
    expect(refused.ok).toBe(false)
  })
})
