import { describe, expect, test } from 'claude-code/testing'

import { formatSetupGaps, setupGaps, type SetupFacts } from './setup'

describe('setupGaps', () => {
  const COMPLETE: SetupFacts = {
    inRepo: true,
    claudeMdText: '# x\n\n## Agent skills\n',
    issueTrackerExists: true,
    pstackModelsExists: true,
  }

  test('no gaps when everything is in place', () => {
    expect(setupGaps(COMPLETE)).toEqual([])
  })

  test('flags a missing Agent skills section, or a missing CLAUDE.md entirely, the same way', () => {
    const missingSection = setupGaps({ ...COMPLETE, claudeMdText: '# x\n' })
    expect(missingSection).toEqual([{ item: expect.stringContaining('Agent skills'), hint: expect.stringContaining('rebase') }])

    const missingFile = setupGaps({ ...COMPLETE, claudeMdText: undefined })
    expect(missingFile).toEqual(missingSection)
  })

  test('flags a missing issue-tracker.md with the same rebase hint', () => {
    const gaps = setupGaps({ ...COMPLETE, issueTrackerExists: false })
    expect(gaps).toEqual([{ item: expect.stringContaining('issue-tracker'), hint: expect.stringContaining('rebase') }])
  })

  test('flags a missing pstack-models.md with the setup-pstack hint', () => {
    const gaps = setupGaps({ ...COMPLETE, pstackModelsExists: false })
    expect(gaps).toEqual([{ item: expect.stringContaining('pstack-models'), hint: '請先執行 /setup-pstack' }])
  })

  test('skips the Pocock checks entirely outside a git repo', () => {
    const gaps = setupGaps({ inRepo: false, claudeMdText: undefined, issueTrackerExists: false, pstackModelsExists: false })
    expect(gaps).toEqual([{ item: expect.stringContaining('pstack-models'), hint: '請先執行 /setup-pstack' }])
  })

  test('lists every gap at once when several are missing', () => {
    const gaps = setupGaps({ inRepo: true, claudeMdText: undefined, issueTrackerExists: false, pstackModelsExists: false })
    expect(gaps).toHaveLength(3)
  })
})

describe('formatSetupGaps', () => {
  test('formats each gap with its hint in parentheses', () => {
    const text = formatSetupGaps([{ item: 'X 不存在', hint: '請先執行 /setup-pstack' }])
    expect(text).toContain('X 不存在')
    expect(text).toContain('請先執行 /setup-pstack')
  })
})
