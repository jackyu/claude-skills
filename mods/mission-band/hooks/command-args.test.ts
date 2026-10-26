import { describe, expect, test } from 'claude-code/testing'

import { parseFinishArgs, parseRestoreArgs, parseSkipArgs, parseStartArgs } from './command-args'

const OCT_22 = new Date(2026, 9, 22, 12).getTime()

describe('command arg parsing', () => {
  test('parseStartArgs prefixes the date and normalizes an issue number to #<n>', () => {
    expect(parseStartArgs('#473', OCT_22)).toEqual({ name: '1022-#473' })
    expect(parseStartArgs('473', OCT_22)).toEqual({ name: '1022-#473' })
    expect(parseStartArgs('ctbc-layout', OCT_22)).toEqual({ name: '1022-ctbc-layout' })
    expect(parseStartArgs('銀行按鈕', OCT_22)).toEqual({ name: '1022-銀行按鈕' })
  })

  test('parseStartArgs rejects an empty argument or one with spaces', () => {
    expect(parseStartArgs('', OCT_22)).toEqual({ error: expect.any(String) })
    expect(parseStartArgs('has spaces', OCT_22)).toEqual({ error: expect.any(String) })
  })

  test('parseSkipArgs requires both a node id and a reason', () => {
    expect(parseSkipArgs('prototype')).toEqual({ error: expect.any(String) })
    expect(parseSkipArgs('prototype 不需要設計決定')).toEqual({ nodeId: 'prototype', reason: '不需要設計決定' })
  })

  test('parseSkipArgs usage string mentions the [:<track>] suffix', () => {
    expect(parseSkipArgs('')).toEqual({ error: '用法：/mission-skip <nodeId>[:<track>] <理由>' })
    expect(parseSkipArgs('prototype')).toEqual({ error: '用法：/mission-skip <nodeId>[:<track>] <理由>' })
  })

  test('parseSkipArgs keeps a <node>:<track> id intact (validated later by skipNode)', () => {
    expect(parseSkipArgs('code-review:codex 不需要第二意見')).toEqual({ nodeId: 'code-review:codex', reason: '不需要第二意見' })
  })

  test('parseRestoreArgs requires a name', () => {
    expect(parseRestoreArgs('')).toEqual({ error: expect.any(String) })
    expect(parseRestoreArgs('feat-1')).toEqual({ name: 'feat-1' })
  })

  test('parseFinishArgs reads the name and the --force flag in any order', () => {
    expect(parseFinishArgs('')).toEqual({ name: undefined, force: false })
    expect(parseFinishArgs('feat-1 --force')).toEqual({ name: 'feat-1', force: true })
    expect(parseFinishArgs('--force feat-1')).toEqual({ name: 'feat-1', force: true })
  })
})
