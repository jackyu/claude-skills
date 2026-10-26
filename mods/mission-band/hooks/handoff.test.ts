import { describe, expect, test } from 'claude-code/testing'

import { missionGoArgv, orcaLaunchOutcome } from './handoff'

describe('missionGoArgv', () => {
  test('builds the exact argv for orca agent launch', () => {
    expect(missionGoArgv('/Users/jackyu/Projects/rsc-frontend/.claude/worktrees/rsc-frontend/feat_manual_filing_backend_order', '#473')).toEqual([
      'orca',
      'agent',
      'launch',
      '--agent',
      'claude',
      '--worktree',
      'path:/Users/jackyu/Projects/rsc-frontend/.claude/worktrees/rsc-frontend/feat_manual_filing_backend_order',
      '--prompt',
      '/mission-restore #473',
      '--focus',
      '--json',
    ])
  })
})

describe('orcaLaunchOutcome', () => {
  test('exit 0 with no JSON at all is still success (ok unknown, not false)', () => {
    expect(orcaLaunchOutcome(0, '', '')).toEqual({ ok: true })
  })

  test('exit 0 with an envelope ok:true is success', () => {
    expect(orcaLaunchOutcome(0, JSON.stringify({ id: 'x', ok: true, result: {} }), '')).toEqual({ ok: true })
  })

  test('exit 0 but the envelope says ok:false is still a failure', () => {
    const stdout = JSON.stringify({ id: 'x', ok: false, error: '找不到那個 worktree' })
    expect(orcaLaunchOutcome(0, stdout, '')).toEqual({ ok: false, detail: '找不到那個 worktree' })
  })

  test('non-zero exit is a failure even with no JSON output, using stderr’s first line', () => {
    expect(orcaLaunchOutcome(127, '', 'orca: command not found\nsome other noise')).toEqual({ ok: false, detail: 'orca: command not found' })
  })

  test('a JSON error message is preferred over stderr when both are present', () => {
    const stdout = JSON.stringify({ ok: false, error: '來自信封的錯誤' })
    expect(orcaLaunchOutcome(1, stdout, 'some stderr noise')).toEqual({ ok: false, detail: '來自信封的錯誤' })
  })

  test('falls back to a nested result.error when there is no top-level error', () => {
    const stdout = JSON.stringify({ ok: false, result: { error: '巢狀的錯誤' } })
    expect(orcaLaunchOutcome(1, stdout, '')).toEqual({ ok: false, detail: '巢狀的錯誤' })
  })

  test('failure with neither a JSON error nor stderr has an undefined detail', () => {
    expect(orcaLaunchOutcome(1, '', '')).toEqual({ ok: false, detail: undefined })
  })

  test('failure with non-JSON stdout falls back to stderr', () => {
    expect(orcaLaunchOutcome(1, 'not json at all', '真正的錯誤訊息\n第二行')).toEqual({ ok: false, detail: '真正的錯誤訊息' })
  })
})
