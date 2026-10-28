import { describe, expect, test } from 'claude-code/testing'

import { parseFinishArgs, parseRenameArgs, parseRestoreArgs, parseSkipArgs, parseStartArgs } from './command-args'

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

  const OWN = { host: 'git.fugle.tw', path: 'fugle/brokerage-service-development/r-securities/rsc-frontend' }
  const OWN_BASE = 'https://git.fugle.tw/fugle/brokerage-service-development/r-securities/rsc-frontend'
  const PM_BASE = 'https://git.fugle.tw/fugle/brokerage-service-development/r-securities/rsc-pm'

  test('parseStartArgs turns an issue or work item URL of this repo into #<n>', () => {
    expect(parseStartArgs(`${OWN_BASE}/-/work_items/473`, OCT_22, OWN)).toEqual({ name: '1022-#473' })
    expect(parseStartArgs(`${OWN_BASE}/-/issues/474#note_123`, OCT_22, OWN)).toEqual({ name: '1022-#474' })
    expect(parseStartArgs(`${OWN_BASE}/-/work_items/475?iid_path=true`, OCT_22, OWN)).toEqual({ name: '1022-#475' })
  })

  test('parseStartArgs rejects an issue URL of another project and names that project', () => {
    const result = parseStartArgs(`${PM_BASE}/-/work_items/190`, OCT_22, OWN)
    expect(result).toEqual({ error: expect.stringContaining('rsc-pm') })
  })

  test('parseStartArgs accepts a URL whose host differs from an ssh alias remote when the project path matches', () => {
    const alias = { host: 'gitlab-work', path: OWN.path }
    expect(parseStartArgs(`${OWN_BASE}/-/work_items/473`, OCT_22, alias)).toEqual({ name: '1022-#473' })
  })

  test('parseStartArgs rejects any URL when the repo remote is unknown', () => {
    expect(parseStartArgs(`${OWN_BASE}/-/work_items/473`, OCT_22, undefined)).toEqual({ error: expect.stringContaining('#<') })
  })

  test('parseStartArgs rejects a URL that is not an issue', () => {
    expect(parseStartArgs(`${OWN_BASE}/-/merge_requests/12`, OCT_22, OWN)).toEqual({ error: expect.any(String) })
  })

  test('parseRenameArgs takes the old mission and a new label normalized like /mission-start', () => {
    expect(parseRenameArgs(`${OWN_BASE}/-/work_items/473 #473`, OWN)).toEqual({ query: `${OWN_BASE}/-/work_items/473`, label: '#473' })
    expect(parseRenameArgs(`1027-x ${OWN_BASE}/-/issues/476`, OWN)).toEqual({ query: '1027-x', label: '#476' })
    expect(parseRenameArgs('1027-x 銀行按鈕', OWN)).toEqual({ query: '1027-x', label: '銀行按鈕' })
  })

  test('parseRenameArgs needs exactly two arguments and applies the same URL rule', () => {
    expect(parseRenameArgs('', OWN)).toEqual({ error: expect.any(String) })
    expect(parseRenameArgs('only-one', OWN)).toEqual({ error: expect.any(String) })
    expect(parseRenameArgs('a b c', OWN)).toEqual({ error: expect.any(String) })
    expect(parseRenameArgs(`1027-x ${PM_BASE}/-/work_items/190`, OWN)).toEqual({ error: expect.stringContaining('rsc-pm') })
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
