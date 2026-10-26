import { describe, expect, test } from 'claude-code/testing'

import type { Mission, MissionReview, ReviewDiscussion } from '../types'
import {
  applyReviewSync,
  approvedFrom,
  classifyDiscussion,
  discussionReplyMatch,
  evaluateApprovedDoneWhen,
  evaluateAwaitReviewDoneWhen,
  evaluatePushFixDoneWhen,
  evaluateReplyDoneWhen,
  evaluateReverifyDoneWhen,
  glabReplyIsPost,
  latestMrIid,
  markDiscussionRepliedLocally,
  mrStateFrom,
  type RawReviewDiscussion,
  resolveMrIid,
  reverifySkipReason,
  type ReviewSyncSnapshot,
  usernameFrom,
} from './review-stage'

function mission(overrides: Partial<Mission> = {}): Mission {
  return { name: 'demo', flow: 'new-feature', binding: '/repo', createdAt: 0, stage: 3, skips: {}, events: [], ...overrides }
}

function discussion(overrides: Partial<ReviewDiscussion> = {}): ReviewDiscussion {
  return { id: 'd1', isFeedback: true, resolved: false, lastBySelf: false, ...overrides }
}

function review(overrides: Partial<MissionReview> = {}): MissionReview {
  return { round: 1, roundStartedAt: 0, discussions: [], ...overrides }
}

describe('classifyDiscussion', () => {
  test('excludes a reading-map tour note with no reply from anyone else (isFeedback false, not dropped entirely)', () => {
    const raw: RawReviewDiscussion = { id: 'd1', notes: [{ body: '🤖💬 這段在做什麼\n<!-- mr:self-annotation -->', author: { username: 'me' } }] }
    expect(classifyDiscussion(raw, 'me')?.isFeedback).toBe(false)
  })

  test('a reply from someone else under a tour note turns the whole thread into feedback, tracking their note id', () => {
    const raw: RawReviewDiscussion = {
      id: 'd1',
      notes: [
        { id: 1, body: '🤖💬 這段在做什麼\n<!-- mr:self-annotation -->', author: { username: 'me' } },
        { id: 2, body: '這裡應該要處理 null', author: { username: 'reviewer' } },
      ],
    }
    const result = classifyDiscussion(raw, 'me')
    expect(result?.isFeedback).toBe(true)
    expect(result?.lastOtherNoteId).toBe(2)
  })

  test('a self-started non-tour note (a reminder) still counts as feedback, not excluded for being self-authored', () => {
    const raw: RawReviewDiscussion = { id: 'd1', notes: [{ body: '這裡還要改', author: { username: 'me' } }] }
    const result = classifyDiscussion(raw, 'me')
    expect(result?.isFeedback).toBe(true)
    expect(result?.lastBySelf).toBe(true)
  })

  test('system notes are filtered out and do not count as the first note', () => {
    const raw: RawReviewDiscussion = {
      id: 'd1',
      notes: [
        { body: 'resolved all threads', system: true },
        { body: '🤖💬 導覽\n<!-- mr:self-annotation -->', author: { username: 'me' } },
      ],
    }
    expect(classifyDiscussion(raw, 'me')?.isFeedback).toBe(false)
  })

  test('a discussion with no notes at all (after filtering system notes) is undefined', () => {
    expect(classifyDiscussion({ id: 'd1', notes: [{ body: 'x', system: true }] }, 'me')).toBeUndefined()
    expect(classifyDiscussion({ id: 'd1', notes: [] }, 'me')).toBeUndefined()
  })

  test('resolved is true only when every resolvable note is resolved', () => {
    const resolved: RawReviewDiscussion = { id: 'd1', notes: [{ body: 'please fix', resolvable: true, resolved: true, author: { username: 'reviewer' } }] }
    expect(classifyDiscussion(resolved, 'me')?.resolved).toBe(true)

    const unresolved: RawReviewDiscussion = {
      id: 'd1',
      notes: [
        { body: 'please fix', resolvable: true, resolved: true, author: { username: 'reviewer' } },
        { body: 'ack', resolvable: true, resolved: false, author: { username: 'me' } },
      ],
    }
    expect(classifyDiscussion(unresolved, 'me')?.resolved).toBe(false)
  })

  test('no resolvable notes at all means resolved is false (reply relies on lastBySelf instead)', () => {
    const raw: RawReviewDiscussion = { id: 'd1', notes: [{ body: 'just a comment', author: { username: 'reviewer' } }] }
    expect(classifyDiscussion(raw, 'me')?.resolved).toBe(false)
  })

  test('lastBySelf reflects only the very last note, not any earlier one', () => {
    const raw: RawReviewDiscussion = {
      id: 'd1',
      notes: [
        { body: 'issue', author: { username: 'reviewer' } },
        { body: 'fixed', author: { username: 'me' } },
      ],
    }
    expect(classifyDiscussion(raw, 'me')?.lastBySelf).toBe(true)
  })

  test('lastOtherNoteId is the max id among others’ notes, ignoring self notes interleaved with higher ids', () => {
    const raw: RawReviewDiscussion = {
      id: 'd1',
      notes: [
        { id: 10, body: 'issue', author: { username: 'reviewer' } },
        { id: 20, body: 'ack', author: { username: 'me' } },
        { id: 15, body: 'actually also this', author: { username: 'reviewer' } },
      ],
    }
    expect(classifyDiscussion(raw, 'me')?.lastOtherNoteId).toBe(15)
  })

  test('lastOtherNoteId is undefined when nobody else ever posted (or ids are missing)', () => {
    expect(classifyDiscussion({ id: 'd1', notes: [{ body: 'solo', author: { username: 'me' } }] }, 'me')?.lastOtherNoteId).toBeUndefined()
  })
})

describe('applyReviewSync', () => {
  const snapshot = (overrides: Partial<ReviewSyncSnapshot> = {}): ReviewSyncSnapshot => ({
    mrState: 'opened',
    approved: false,
    discussions: [],
    ...overrides,
  })

  test('first sync (no prior review state at all) starts at round 1 and never bumps even with feedback already present', () => {
    const result = applyReviewSync(undefined, snapshot({ discussions: [discussion({ lastOtherNoteId: 1 })] }), 1000)
    expect(result.round).toBe(1)
    expect(result.roundStartedAt).toBe(1000)
    expect(result.sawFeedback).toBe(true)
  })

  // 迴歸（bug A）：進入審查階段時 model.ts 的 nextStage 會先建立一份 round 1、discussions
  // 是空陣列、但沒有 lastSyncAt 的 review 物件（prev 不是 undefined！）。這份預建物件的
  // 第一次真同步，一樣不能算新一輪——用 prev===undefined 當判準會在這裡誤判。
  test('the pre-created review stub from entering the review stage (prev not undefined, lastSyncAt not yet set) is still treated as the first sync', () => {
    const preCreated = review({ round: 1, roundStartedAt: 500, discussions: [] }) // lastSyncAt 沒給，模擬 nextStage 剛建立的樣子
    const result = applyReviewSync(preCreated, snapshot({ discussions: [discussion({ lastOtherNoteId: 1 })] }), 1000)
    expect(result.round).toBe(1)
  })

  test('a second sync with no new notes by others keeps the same round', () => {
    const prev = review({ round: 1, roundStartedAt: 1000, lastSyncAt: 1000, discussions: [discussion({ lastOtherNoteId: 5 })] })
    const result = applyReviewSync(prev, snapshot({ discussions: [discussion({ lastOtherNoteId: 5 })] }), 2000)
    expect(result.round).toBe(1)
  })

  test('a new note by someone else (higher note id than last snapshot) bumps the round and resets roundStartedAt', () => {
    const prev = review({ round: 1, roundStartedAt: 1000, lastSyncAt: 1000, discussions: [discussion({ lastOtherNoteId: 5 })] })
    const result = applyReviewSync(prev, snapshot({ discussions: [discussion({ lastOtherNoteId: 6 })] }), 2000)
    expect(result.round).toBe(2)
    expect(result.roundStartedAt).toBe(2000)
  })

  test('a brand new discussion (not present in the previous snapshot) with an other note also bumps the round', () => {
    const prev = review({ round: 1, roundStartedAt: 1000, lastSyncAt: 1000, discussions: [] })
    const result = applyReviewSync(prev, snapshot({ discussions: [discussion({ id: 'd2', lastOtherNoteId: 1 })] }), 2000)
    expect(result.round).toBe(2)
  })

  test('the same note id as last snapshot (already seen) does not bump the round', () => {
    const prev = review({ round: 1, roundStartedAt: 1000, lastSyncAt: 1000, discussions: [discussion({ lastOtherNoteId: 5 })] })
    const result = applyReviewSync(prev, snapshot({ discussions: [discussion({ lastOtherNoteId: 5 })] }), 2000)
    expect(result.round).toBe(1)
  })

  test('a non-feedback discussion with a new "other" note id does not bump the round', () => {
    const prev = review({ round: 1, roundStartedAt: 1000, lastSyncAt: 1000, discussions: [] })
    const result = applyReviewSync(prev, snapshot({ discussions: [discussion({ isFeedback: false, lastOtherNoteId: 1 })] }), 2000)
    expect(result.round).toBe(1)
  })

  // 真實案例：使用者在 /mission-review 同步之前，先用本機回覆偵測（markDiscussionRepliedLocally）
  // 補了一筆還沒同步過的討論 stub（lastOtherNoteId undefined）；這筆本身不該讓輪次誤判——
  // 它沒有別人的 note id，不滿足 isFeedback && lastOtherNoteId !== undefined 的條件。
  test('a locally-stubbed discussion (from markDiscussionRepliedLocally, no lastOtherNoteId) does not itself bump the round', () => {
    const prev = review({ round: 1, roundStartedAt: 1000, lastSyncAt: 1000, discussions: [] })
    const stubbed = markDiscussionRepliedLocally(prev, 'd-new')
    const result = applyReviewSync(stubbed, snapshot({ discussions: stubbed.discussions }), 2000)
    expect(result.round).toBe(1)
  })

  test('sawFeedback is sticky: once true it stays true even if the next sync has no feedback discussions', () => {
    const prev = review({ sawFeedback: true })
    const result = applyReviewSync(prev, snapshot({ discussions: [] }), 2000)
    expect(result.sawFeedback).toBe(true)
  })

  test('approved alone (no discussions) also sets sawFeedback', () => {
    const result = applyReviewSync(undefined, snapshot({ approved: true }), 1000)
    expect(result.sawFeedback).toBe(true)
  })

  test('approved is not sticky: a later sync without approval reverts it', () => {
    const prev = review({ approved: true })
    const result = applyReviewSync(prev, snapshot({ approved: false }), 2000)
    expect(result.approved).toBe(false)
  })

  test('selfUsername keeps the cached value when the snapshot does not carry a fresh one', () => {
    const prev = review({ selfUsername: 'me' })
    const result = applyReviewSync(prev, snapshot({ selfUsername: undefined }), 2000)
    expect(result.selfUsername).toBe('me')
  })

  test('localHead/remoteHead are preserved across a sync (sync does not touch git heads)', () => {
    const prev = review({ localHead: 'abc', remoteHead: 'abc' })
    const result = applyReviewSync(prev, snapshot(), 2000)
    expect(result.localHead).toBe('abc')
    expect(result.remoteHead).toBe('abc')
  })
})

describe('markDiscussionRepliedLocally', () => {
  test('marks an existing discussion as last-by-self', () => {
    const r = review({ discussions: [discussion({ id: 'd1', lastBySelf: false })] })
    const result = markDiscussionRepliedLocally(r, 'd1')
    expect(result.discussions.find(d => d.id === 'd1')?.lastBySelf).toBe(true)
  })

  test('adds a stub discussion when the id is not yet known (not synced before)', () => {
    const r = review({ discussions: [] })
    const result = markDiscussionRepliedLocally(r, 'd-new')
    expect(result.discussions).toEqual([{ id: 'd-new', isFeedback: true, resolved: false, lastBySelf: true }])
  })

  test('does not affect other discussions', () => {
    const r = review({ discussions: [discussion({ id: 'd1' }), discussion({ id: 'd2' })] })
    const result = markDiscussionRepliedLocally(r, 'd1')
    expect(result.discussions.find(d => d.id === 'd2')?.lastBySelf).toBe(false)
  })
})

describe('glabReplyIsPost', () => {
  test('an explicit -X POST or --method POST counts', () => {
    expect(glabReplyIsPost('glab api -X POST "x" -f body=y')).toBe(true)
    expect(glabReplyIsPost('glab api --method POST "x" -f body=y')).toBe(true)
    expect(glabReplyIsPost('glab api --method=POST "x" -f body=y')).toBe(true)
  })

  test('an explicit -X PUT/PATCH/DELETE never counts, even with a field flag present', () => {
    expect(glabReplyIsPost('glab api -X PUT "x" -f body=y')).toBe(false)
    expect(glabReplyIsPost('glab api --method PATCH "x" -f body=y')).toBe(false)
    expect(glabReplyIsPost('glab api --method DELETE "x"')).toBe(false)
  })

  test('no explicit method: a field-like flag (-f/-F/--field/--raw-field/--input) counts', () => {
    expect(glabReplyIsPost('glab api "x" -f body=y')).toBe(true)
    expect(glabReplyIsPost('glab api "x" -F body=y')).toBe(true)
    expect(glabReplyIsPost('glab api "x" --field body=y')).toBe(true)
    expect(glabReplyIsPost('glab api "x" --raw-field body=y')).toBe(true)
    expect(glabReplyIsPost('glab api "x" --input body.json')).toBe(true)
  })

  test('no explicit method and no field-like flag: a bare GET does not count', () => {
    expect(glabReplyIsPost('glab api "x"')).toBe(false)
  })

  // bug B：quoted 內容裡剛好提到 -X PATCH 不該被當成指令本身真的帶了那個方法——
  // 使用者回覆的文字內容，不是指令的 flag。
  test('a method-looking string inside a quoted reply body does not count as the actual method (real flag is -f, outside quotes)', () => {
    expect(glabReplyIsPost(`glab api "x" -f body="use -X PATCH instead"`)).toBe(true)
  })

  test('a method-looking string inside single-quoted content is ignored the same way', () => {
    expect(glabReplyIsPost(`glab api "x" -f body='please --method DELETE this'`)).toBe(true)
  })

  // bug 3：quote-stripping 把方法本身的引號內容也一起抹掉了，-X "POST" 這種合法寫法
  // （沒有另外帶 -f／--field 之類欄位旗標）會被誤判成沒有方法、也沒有欄位，整句變成 GET。
  test('a quoted method value (-X "POST") is still read correctly, even with no field flag present', () => {
    expect(glabReplyIsPost(`glab api -X "POST" "x"`)).toBe(true)
  })

  test('a single-quoted method value (--method \'POST\') is still read correctly, even with no field flag present', () => {
    expect(glabReplyIsPost(`glab api --method 'POST' "x"`)).toBe(true)
  })

  test('a quoted non-POST method value is still rejected (not just read as present)', () => {
    expect(glabReplyIsPost(`glab api -X "PATCH" "x"`)).toBe(false)
  })
})

describe('discussionReplyMatch', () => {
  const MR_IID = '5'
  const PROJECT = 'org/repo'

  test('matches a real POST to a discussion note', () => {
    const cmd = `glab api --method POST "projects/org%2Frepo/merge_requests/5/discussions/abc123/notes" -f body="x"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBe('abc123')
  })

  test('does not match --dry-run', () => {
    const cmd = `glab api --method POST --dry-run "projects/org%2Frepo/merge_requests/5/discussions/abc123/notes" -f body="x"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBeUndefined()
  })

  test('does not match mr-note.sh (MR-level comment, no /discussions/<id>/ segment)', () => {
    const cmd = `mr-note.sh org/repo 5 --body "x"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBeUndefined()
  })

  test('does not match a GET (no POST-style flag)', () => {
    const cmd = `glab api "projects/org%2Frepo/merge_requests/5/discussions/abc123/notes"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBeUndefined()
  })

  test('does not match -X PUT even with a field flag (editing a note, not a new reply)', () => {
    const cmd = `glab api -X PUT "projects/org%2Frepo/merge_requests/5/discussions/abc123/notes/9" -f body="edited"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBeUndefined()
  })

  test('does not match -X DELETE (deleting a note)', () => {
    const cmd = `glab api -X DELETE "projects/org%2Frepo/merge_requests/5/discussions/abc123/notes/9"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBeUndefined()
  })

  test('matches with --raw-field in place of -f', () => {
    const cmd = `glab api "projects/org%2Frepo/merge_requests/5/discussions/abc123/notes" --raw-field body="x"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBe('abc123')
  })

  test('does not match a different MR iid', () => {
    const cmd = `glab api --method POST "projects/org%2Frepo/merge_requests/9/discussions/abc123/notes" -f body="x"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBeUndefined()
  })

  test('does not match a different project', () => {
    const cmd = `glab api --method POST "projects/other%2Fproject/merge_requests/5/discussions/abc123/notes" -f body="x"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBeUndefined()
  })

  // bug B：回覆文字裡提到「用 -X PATCH」不該讓整句被誤判成在編輯而不是在發文。
  test('a real reply is still detected even when its quoted body text happens to mention a different HTTP method', () => {
    const cmd = `glab api "projects/org%2Frepo/merge_requests/5/discussions/abc123/notes" -f body="use -X PATCH instead"`
    expect(discussionReplyMatch(cmd, MR_IID, PROJECT)).toBe('abc123')
  })
})

describe('latestMrIid', () => {
  test('returns the most recent mr product event that carries an iid', () => {
    const m = mission({
      events: [
        { at: 1, kind: 'product', name: 'mr', mrIid: '5' },
        { at: 2, kind: 'product', name: 'mr', mrIid: '9' },
      ],
    })
    expect(latestMrIid(m)).toBe('9')
  })

  test('returns undefined with no mr event at all', () => {
    expect(latestMrIid(mission())).toBeUndefined()
  })
})

describe('resolveMrIid', () => {
  const OWN_PROJECT = 'fugle/brokerage-service-development/r-securities/rsc-frontend'
  const ownMrUrl = (iid: string) => `https://git.fugle.tw/${OWN_PROJECT}/-/merge_requests/${iid}`
  const otherProjectMrUrl = (iid: string) => `https://git.fugle.tw/some/other/project/-/merge_requests/${iid}`

  test('an mr event that already carries mrIid wins, even with no assets at all', () => {
    const m = mission({ events: [{ at: 1, kind: 'product', name: 'mr', mrIid: '5' }] })
    expect(resolveMrIid(m, OWN_PROJECT)).toBe('5')
  })

  test('an mr event with mrIid wins over a conflicting MR asset (event is authoritative)', () => {
    const m = mission({
      events: [{ at: 1, kind: 'product', name: 'mr', mrIid: '5' }],
      assets: [{ url: ownMrUrl('9'), label: '!9', description: 'MR', source: 'tool', at: 2 }],
    })
    expect(resolveMrIid(m, OWN_PROJECT)).toBe('5')
  })

  // 真實案例：舊任務的 mr product 事件記錄在加 mrIid 欄位之前，完全沒有這個欄位，
  // 但開 MR 當時的 Bash stdout 早就把 MR 網址收進 assets 了。
  test('falls back to the MR asset when the mr event carries no mrIid at all (legacy mission)', () => {
    const m = mission({
      events: [{ at: 1, kind: 'product', name: 'mr', missingSections: [], missingAcs: [] }],
      assets: [{ url: ownMrUrl('495'), label: '!495', description: 'MR', source: 'tool', at: 2 }],
    })
    expect(resolveMrIid(m, OWN_PROJECT)).toBe('495')
  })

  test('falls back to the most recent matching MR asset when there are several', () => {
    const m = mission({
      assets: [
        { url: ownMrUrl('1'), label: '!1', description: 'MR', source: 'tool', at: 1 },
        { url: ownMrUrl('2'), label: '!2', description: 'MR', source: 'tool', at: 5 },
        { url: ownMrUrl('3'), label: '!3', description: 'MR', source: 'tool', at: 3 },
      ],
    })
    expect(resolveMrIid(m, OWN_PROJECT)).toBe('2')
  })

  test('excludes an MR asset belonging to another project, even with no own-project asset to prefer', () => {
    const m = mission({ assets: [{ url: otherProjectMrUrl('9'), label: 'other!9', description: 'MR', source: 'tool', at: 1 }] })
    expect(resolveMrIid(m, OWN_PROJECT)).toBeUndefined()
  })

  test('ignores a non-MR asset (e.g. the issue itself)', () => {
    const m = mission({ assets: [{ url: `https://git.fugle.tw/${OWN_PROJECT}/-/issues/473`, label: '#473', description: 'issue', source: 'issue', at: 1 }] })
    expect(resolveMrIid(m, OWN_PROJECT)).toBeUndefined()
  })

  test('returns undefined (does not guess) when ownProjectPath is unknown, even with a plausible-looking asset', () => {
    const m = mission({ assets: [{ url: ownMrUrl('495'), label: '!495', description: 'MR', source: 'tool', at: 1 }] })
    expect(resolveMrIid(m, undefined)).toBeUndefined()
  })

  test('no event and no assets at all: undefined', () => {
    expect(resolveMrIid(mission(), OWN_PROJECT)).toBeUndefined()
  })
})

describe('glab api response parsing', () => {
  test('mrStateFrom maps locked to opened and passes through merged/closed', () => {
    expect(mrStateFrom({ state: 'merged' })).toBe('merged')
    expect(mrStateFrom({ state: 'closed' })).toBe('closed')
    expect(mrStateFrom({ state: 'opened' })).toBe('opened')
    expect(mrStateFrom({ state: 'locked' })).toBe('opened')
    expect(mrStateFrom({ state: 'weird' })).toBeUndefined()
    expect(mrStateFrom(null)).toBeUndefined()
  })

  test('approvedFrom ignores the `approved` boolean entirely (approvals_required:0 lies) and only trusts a non-empty approved_by', () => {
    expect(approvedFrom({ approved: true, approved_by: [] })).toBe(false)
    expect(approvedFrom({ approved: false, approved_by: [{ user: 'x' }] })).toBe(true)
    expect(approvedFrom({ approved_by: [{ user: 'x' }] })).toBe(true)
    expect(approvedFrom({ approved_by: [] })).toBe(false)
    expect(approvedFrom({})).toBe(false)
  })

  test('usernameFrom reads a string username field', () => {
    expect(usernameFrom({ username: 'me' })).toBe('me')
    expect(usernameFrom({ username: 42 })).toBeUndefined()
    expect(usernameFrom(null)).toBeUndefined()
  })
})

describe('evaluateAwaitReviewDoneWhen', () => {
  test('not done with no review state at all', () => {
    expect(evaluateAwaitReviewDoneWhen(mission()).done).toBe(false)
  })

  test('not done when review exists but sawFeedback is not yet true', () => {
    expect(evaluateAwaitReviewDoneWhen(mission({ review: review({ sawFeedback: false }) })).done).toBe(false)
  })

  test('done once sawFeedback is true', () => {
    expect(evaluateAwaitReviewDoneWhen(mission({ review: review({ sawFeedback: true }) })).done).toBe(true)
  })
})

describe('evaluateApprovedDoneWhen', () => {
  test('tracks the live approved flag, not sticky', () => {
    expect(evaluateApprovedDoneWhen(mission({ review: review({ approved: true }) })).done).toBe(true)
    expect(evaluateApprovedDoneWhen(mission({ review: review({ approved: false }) })).done).toBe(false)
    expect(evaluateApprovedDoneWhen(mission()).done).toBe(false)
  })
})

describe('evaluateReplyDoneWhen', () => {
  test('not done before the first sync at all (lastSyncAt undefined), even with an empty discussions array', () => {
    expect(evaluateReplyDoneWhen(mission({ review: review({ lastSyncAt: undefined, discussions: [] }) })).done).toBe(false)
    expect(evaluateReplyDoneWhen(mission()).done).toBe(false)
  })

  test('done with no discussions at all once a sync has actually happened (direct approve, no feedback)', () => {
    expect(evaluateReplyDoneWhen(mission({ review: review({ lastSyncAt: 1, discussions: [] }) })).done).toBe(true)
  })

  test('not done when a feedback discussion is unresolved and the last note is not by self', () => {
    const m = mission({ review: review({ lastSyncAt: 1, discussions: [discussion({ isFeedback: true, resolved: false, lastBySelf: false })] }) })
    const result = evaluateReplyDoneWhen(m)
    expect(result.done).toBe(false)
    expect(result.detail).toBe('1 則待回')
  })

  test('done when the last note is by self even if unresolved', () => {
    const m = mission({ review: review({ lastSyncAt: 1, discussions: [discussion({ resolved: false, lastBySelf: true })] }) })
    expect(evaluateReplyDoneWhen(m).done).toBe(true)
  })

  test('done when resolved even if the last note is not by self', () => {
    const m = mission({ review: review({ lastSyncAt: 1, discussions: [discussion({ resolved: true, lastBySelf: false })] }) })
    expect(evaluateReplyDoneWhen(m).done).toBe(true)
  })

  test('a non-feedback discussion never blocks reply', () => {
    const m = mission({ review: review({ lastSyncAt: 1, discussions: [discussion({ isFeedback: false, resolved: false, lastBySelf: false })] }) })
    expect(evaluateReplyDoneWhen(m).done).toBe(true)
  })
})

describe('evaluatePushFixDoneWhen', () => {
  test('not done with no localHead at all', () => {
    expect(evaluatePushFixDoneWhen(mission({ review: review() })).done).toBe(false)
  })

  test('not done when the remote head could not be read', () => {
    const result = evaluatePushFixDoneWhen(mission({ review: review({ localHead: 'abc', remoteHead: undefined }) }))
    expect(result.done).toBe(false)
    expect(result.detail).toBe('讀不到遠端分支')
  })

  test('not done when local and remote heads differ', () => {
    const result = evaluatePushFixDoneWhen(mission({ review: review({ localHead: 'abc', remoteHead: 'def' }) }))
    expect(result.done).toBe(false)
    expect(result.detail).toBe('還沒 push')
  })

  test('done when local and remote heads match', () => {
    expect(evaluatePushFixDoneWhen(mission({ review: review({ localHead: 'abc', remoteHead: 'abc' }) })).done).toBe(true)
  })
})

describe('reverifySkipReason (when the node auto-skips vs stays listed)', () => {
  test('no acceptance checklist at all: skipped, with the "no checklist" reason', () => {
    expect(reverifySkipReason(mission())).toBe('沒有驗收清單，不用重驗')
  })

  test('checklist exists but overall-regression was skipped in the verify stage: skipped, with the "verify stage skipped it" reason', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '未跑' }, readAt: 0 }, skips: { 'overall-regression': '沒有驗收環境' } })
    expect(reverifySkipReason(m)).toBe('驗收階段已跳過整體回歸')
  })

  // 核心迴歸：重跑 /verify-acceptance 把結果改成未過或受阻，或清單重置成未跑，都不該讓
  // 這個節點消失——清單存在、整體回歸沒被跳過，就一律正常顯示，不管目前記錄的狀態是什麼。
  test('checklist exists, overall-regression not skipped: never auto-skips, regardless of its current status', () => {
    expect(reverifySkipReason(mission({ acceptance: { exists: true, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 } }))).toBeUndefined()
    expect(reverifySkipReason(mission({ acceptance: { exists: true, overall: { status: '未過' }, readAt: 0 } }))).toBeUndefined()
    expect(reverifySkipReason(mission({ acceptance: { exists: true, overall: { status: '受阻' }, readAt: 0 } }))).toBeUndefined()
    expect(reverifySkipReason(mission({ acceptance: { exists: true, overall: { status: '未跑' }, readAt: 0 } }))).toBeUndefined()
  })

  // 迴歸：審查途中清單檔被歸檔或搬走，下次刷新會把 mission.acceptance 整個換成
  // { exists:false }，但如果任務「曾經」讀到過 overall 紀錄（這裡直接構造，不經過真正
  // 的刷新流程），不該因為檔案現在不見了就讓節點消失——照樣列出來、顯示沒完成，提示
  // 還是叫使用者重跑整體回歸。
  test('acceptance.exists is false but an overall record is still present (checklist archived/moved mid-review): not auto-skipped', () => {
    const m = mission({ acceptance: { exists: false, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 } })
    expect(reverifySkipReason(m)).toBeUndefined()
  })

  // 同一個情境接到 evaluateReverifyDoneWhen：節點留著，照一般規則判斷完成與否（這裡
  // localHead 跟紀錄的 sha 不一樣，顯示沒完成），不會因為檔案消失而額外特殊處理。
  test('acceptance.exists false with an overall record present: evaluateReverifyDoneWhen still judges normally (not done when the sha differs)', () => {
    const m = mission({
      acceptance: { exists: false, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 },
      review: review({ localHead: 'sha-rebased' }),
    })
    expect(reverifySkipReason(m)).toBeUndefined()
    expect(evaluateReverifyDoneWhen(m).done).toBe(false)
  })

  test('no acceptance object at all, and no overall record: still auto-skips with the "no checklist" reason', () => {
    expect(reverifySkipReason(mission({ acceptance: undefined }))).toBe('沒有驗收清單，不用重驗')
  })

  test('acceptance.exists is false and there is no overall record either: auto-skips (the ordinary "never had a checklist" case)', () => {
    expect(reverifySkipReason(mission({ acceptance: { exists: false, readAt: 0 } }))).toBe('沒有驗收清單，不用重驗')
  })
})

describe('evaluateReverifyDoneWhen (state-based, not round-based)', () => {
  test('not done with no acceptance checklist at all', () => {
    expect(evaluateReverifyDoneWhen(mission()).done).toBe(false)
  })

  test('not done when localHead has not been read yet, even with a recorded sha', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 }, review: review() })
    expect(evaluateReverifyDoneWhen(m).done).toBe(false)
  })

  test('done when the local HEAD matches the recorded overall-regression sha', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 }, review: review({ localHead: 'sha-a1234567' }) })
    expect(evaluateReverifyDoneWhen(m).done).toBe(true)
  })

  // 跟驗收階段的 overall-regression 節點（acceptance-events.ts 的 computeOverallStale）
  // 用同一套比對：清單記錄的 sha 可能是縮寫（≥7 字元就信任，用 head.startsWith() 比對），
  // 不要求字數對齊——否則同一份清單在驗收階段判斷「沒過期」，到審查階段卻判斷「沒驗過」。
  test('an abbreviated recorded sha (>=7 chars) matches a full-length localHead via prefix, not strict equality', () => {
    const m = mission({
      acceptance: { exists: true, overall: { status: '通過', sha: 'abc1234' }, readAt: 0 },
      review: review({ localHead: 'abc1234567890abcdef1234567890abcdef1234' }),
    })
    expect(evaluateReverifyDoneWhen(m).done).toBe(true)
  })

  test('a recorded sha with a trailing ellipsis (…) is stripped before the prefix match', () => {
    const m = mission({
      acceptance: { exists: true, overall: { status: '通過', sha: 'abc1234…' }, readAt: 0 },
      review: review({ localHead: 'abc1234567890abcdef1234567890abcdef1234' }),
    })
    expect(evaluateReverifyDoneWhen(m).done).toBe(true)
  })

  test('a recorded sha shorter than 7 chars is not trusted — treated as unchanged (done), the same conservative rule as the verify stage', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '通過', sha: 'abc12' }, readAt: 0 }, review: review({ localHead: 'completely-different-head' }) })
    expect(evaluateReverifyDoneWhen(m).done).toBe(true)
  })

  // 看現狀不看輪次：rebase 之後 HEAD 變了，不管這個 rebase 發生在第幾輪，reverify 都要
  // 顯示沒驗過——不會有「本輪沒有新 commit 所以不算」這種豁免。
  test('not done once a rebase changes the local HEAD away from the recorded sha, regardless of round', () => {
    const m = mission({
      acceptance: { exists: true, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 },
      review: review({ round: 1, localHead: 'sha-rebased' }),
    })
    const result = evaluateReverifyDoneWhen(m)
    expect(result.done).toBe(false)
    expect(result.detail).toBe('commit 變了')
  })

  // 防呆：status 不是「通過」就不算完成，即使 sha 碰巧還留著、還跟 localHead 一樣——
  // parseOverall 實際上不會讓非「通過」狀態帶 sha，但這支函式本身要獨立守住這條規則，
  // 不能只靠「sha 通常不會出現」這個外部保證。
  test('a stale sha that happens to match localHead does not count when status is not 通過', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '未過', sha: 'sha-a1234567' }, readAt: 0 }, review: review({ localHead: 'sha-a1234567' }) })
    expect(evaluateReverifyDoneWhen(m).done).toBe(false)
  })

  // 迴歸：重跑整體回歸拿到「未過」(或「受阻」)——之前的寫法會因為沒有 sha 而連節點都不出現，
  // band 看起來一片乾淨，但實際上根本沒有重驗過。現在節點要留著、顯示沒完成。
  test('status reset to 未過 after a regression rerun: not done (and the node is not auto-skipped)', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '未過' }, readAt: 0 }, review: review({ localHead: 'sha-a1234567' }) })
    expect(evaluateReverifyDoneWhen(m).done).toBe(false)
    expect(reverifySkipReason(m)).toBeUndefined()
  })

  // 迴歸：verify-acceptance 只要有任何一條 AC 結果改變，就會把整體回歸重置成「未跑」；
  // 同一個道理，不該讓節點消失。
  test('status reset to 未跑 (e.g. an AC result changed, resetting overall-regression): not done, not auto-skipped', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '未跑' }, readAt: 0 }, review: review({ localHead: 'sha-a1234567' }) })
    expect(evaluateReverifyDoneWhen(m).done).toBe(false)
    expect(reverifySkipReason(m)).toBeUndefined()
  })
})
