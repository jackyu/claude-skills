import { describe, expect, test } from 'claude-code/testing'

import type { Mission, MissionReview, MissionReviewTriage, ReviewDiscussion, ReviewTriageReportMeta } from '../types'
import {
  evaluateReviewTriageDoneWhen,
  latestReviewTriageReport,
  looksLikeReviewTriageReportWrite,
  parseReviewTriageMeta,
  reviewTriageCountsDetail,
  reviewTriageKey,
  reviewTriageSkipReason,
  reviewTriageWarn,
} from './review-triage'

function mission(overrides: Partial<Mission> = {}): Mission {
  return { name: 'demo', flow: 'new-feature', binding: '/repo', createdAt: 0, stage: 3, skips: {}, events: [], ...overrides }
}

function discussion(overrides: Partial<ReviewDiscussion> = {}): ReviewDiscussion {
  return { id: 'd1', isFeedback: true, resolved: false, lastBySelf: false, ...overrides }
}

function review(overrides: Partial<MissionReview> = {}): MissionReview {
  return { round: 1, roundStartedAt: 0, discussions: [], ...overrides }
}

function report(overrides: Partial<ReviewTriageReportMeta> = {}): ReviewTriageReportMeta {
  return { round: 1, head: 'abc123', notes: [], counts: { confirmed: 0, pending: 0, withdrawn: 0, defensive: 0, premise: 0 }, warn: false, ...overrides }
}

function reviewTriage(reports: readonly ReviewTriageReportMeta[]): MissionReviewTriage {
  return { reports }
}

const VALID_META_LINE = '<!-- review-triage: {"round":1,"head":"abc123","notes":[101,102],"counts":{"confirmed":1,"pending":0,"withdrawn":0,"defensive":0,"premise":0},"warn":false} -->'

describe('parseReviewTriageMeta', () => {
  test('parses a well-formed first line into a ReviewTriageReportMeta', () => {
    const text = `${VALID_META_LINE}\n\n# review-triage r1\n...`
    expect(parseReviewTriageMeta(text)).toEqual({
      round: 1,
      head: 'abc123',
      notes: [101, 102],
      counts: { confirmed: 1, pending: 0, withdrawn: 0, defensive: 0, premise: 0 },
      warn: false,
    })
  })

  test('warn:true and an empty notes array (ai-review source) parse fine', () => {
    const text = '<!-- review-triage: {"round":2,"head":"def456","notes":[],"counts":{"confirmed":0,"pending":1,"withdrawn":0,"defensive":0,"premise":1},"warn":true} -->'
    const meta = parseReviewTriageMeta(text)
    expect(meta?.warn).toBe(true)
    expect(meta?.notes).toEqual([])
  })

  test('the meta line must be the first line; meta appearing on a later line is ignored', () => {
    const text = `# review-triage r1\n${VALID_META_LINE}\n`
    expect(parseReviewTriageMeta(text)).toBeUndefined()
  })

  test('broken JSON in the meta comment returns undefined, not a thrown error', () => {
    const text = '<!-- review-triage: {"round":1,"head": -->\n'
    expect(parseReviewTriageMeta(text)).toBeUndefined()
  })

  test('a missing required field (warn) returns undefined', () => {
    const text = '<!-- review-triage: {"round":1,"head":"abc123","notes":[],"counts":{"confirmed":0,"pending":0,"withdrawn":0,"defensive":0,"premise":0}} -->'
    expect(parseReviewTriageMeta(text)).toBeUndefined()
  })

  test('a non-number id inside notes returns undefined', () => {
    const text = '<!-- review-triage: {"round":1,"head":"abc123","notes":["101"],"counts":{"confirmed":0,"pending":0,"withdrawn":0,"defensive":0,"premise":0},"warn":false} -->'
    expect(parseReviewTriageMeta(text)).toBeUndefined()
  })

  test('a counts object missing one of the five keys returns undefined', () => {
    const text = '<!-- review-triage: {"round":1,"head":"abc123","notes":[],"counts":{"confirmed":0,"pending":0,"withdrawn":0,"defensive":0},"warn":false} -->'
    expect(parseReviewTriageMeta(text)).toBeUndefined()
  })

  test('text with no meta comment at all returns undefined', () => {
    expect(parseReviewTriageMeta('# just a report\nno meta line here\n')).toBeUndefined()
  })
})

describe('latestReviewTriageReport', () => {
  test('no reports at all is undefined', () => {
    expect(latestReviewTriageReport(mission())).toBeUndefined()
  })

  test('picks the report with the highest round, regardless of array order', () => {
    const m = mission({ reviewTriage: reviewTriage([report({ round: 2, head: 'r2' }), report({ round: 1, head: 'r1' }), report({ round: 3, head: 'r3' })]) })
    expect(latestReviewTriageReport(m)?.head).toBe('r3')
  })
})

describe('reviewTriageCountsDetail', () => {
  test('no reports yet: undefined', () => {
    expect(reviewTriageCountsDetail(mission())).toBeUndefined()
  })

  test('zero-count categories are omitted, non-zero ones joined with ／', () => {
    const m = mission({ reviewTriage: reviewTriage([report({ counts: { confirmed: 2, pending: 1, withdrawn: 0, defensive: 0, premise: 1 } })]) })
    expect(reviewTriageCountsDetail(m)).toBe('確認 2／待驗證 1／前提 1')
  })

  test('every category at zero: undefined (nothing to show)', () => {
    const m = mission({ reviewTriage: reviewTriage([report()]) })
    expect(reviewTriageCountsDetail(m)).toBeUndefined()
  })

  test('uses the latest report（highest round）when several exist', () => {
    const m = mission({
      reviewTriage: reviewTriage([
        report({ round: 1, counts: { confirmed: 5, pending: 0, withdrawn: 0, defensive: 0, premise: 0 } }),
        report({ round: 2, counts: { confirmed: 0, pending: 0, withdrawn: 1, defensive: 0, premise: 0 } }),
      ]),
    })
    expect(reviewTriageCountsDetail(m)).toBe('撤銷 1')
  })
})

describe('reviewTriageWarn', () => {
  test('no reports: false', () => {
    expect(reviewTriageWarn(mission())).toBe(false)
  })

  test('true when the latest report is warn:true, even if an earlier round was warn:false', () => {
    const m = mission({ reviewTriage: reviewTriage([report({ round: 1, warn: false }), report({ round: 2, warn: true })]) })
    expect(reviewTriageWarn(m)).toBe(true)
  })

  test('false when the latest report is warn:false, even if an earlier round was warn:true', () => {
    const m = mission({ reviewTriage: reviewTriage([report({ round: 1, warn: true }), report({ round: 2, warn: false })]) })
    expect(reviewTriageWarn(m)).toBe(false)
  })
})

describe('reviewTriageSkipReason', () => {
  test('no review synced at all: skipped (nothing to judge yet)', () => {
    expect(reviewTriageSkipReason(mission())).toBeDefined()
  })

  test('discussions exist but none are feedback with another person’s note: skipped', () => {
    const m = mission({ review: review({ discussions: [discussion({ isFeedback: false }), discussion({ id: 'd2', isFeedback: true, lastOtherNoteId: undefined })] }) })
    expect(reviewTriageSkipReason(m)).toBeDefined()
  })

  test('a resolved discussion needs no triage, even with another person’s note: skipped', () => {
    const m = mission({ review: review({ discussions: [discussion({ resolved: true, lastOtherNoteId: 101 })] }) })
    expect(reviewTriageSkipReason(m)).toBeDefined()
  })

  test('at least one feedback discussion with another person’s note: not skipped', () => {
    const m = mission({ review: review({ discussions: [discussion({ isFeedback: true, lastOtherNoteId: 101 })] }) })
    expect(reviewTriageSkipReason(m)).toBeUndefined()
  })
})

describe('evaluateReviewTriageDoneWhen', () => {
  test('no pending feedback notes at all: done (mirrors the skip case)', () => {
    expect(evaluateReviewTriageDoneWhen(mission()).done).toBe(true)
  })

  test('full coverage: every pending note id is covered by some report → done', () => {
    const m = mission({
      review: review({ discussions: [discussion({ id: 'd1', lastOtherNoteId: 101 }), discussion({ id: 'd2', lastOtherNoteId: 102 })] }),
      reviewTriage: reviewTriage([report({ notes: [101, 102] })]),
    })
    expect(evaluateReviewTriageDoneWhen(m).done).toBe(true)
  })

  test('partial coverage: one note id covered, the other not → not done', () => {
    const m = mission({
      review: review({ discussions: [discussion({ id: 'd1', lastOtherNoteId: 101 }), discussion({ id: 'd2', lastOtherNoteId: 102 })] }),
      reviewTriage: reviewTriage([report({ notes: [101] })]),
    })
    expect(evaluateReviewTriageDoneWhen(m).done).toBe(false)
  })

  test('coverage is a union across rounds: an earlier round covering one note and a later round covering another together make it done', () => {
    const m = mission({
      review: review({ discussions: [discussion({ id: 'd1', lastOtherNoteId: 101 }), discussion({ id: 'd2', lastOtherNoteId: 102 })] }),
      reviewTriage: reviewTriage([report({ round: 1, notes: [101] }), report({ round: 2, notes: [102] })]),
    })
    expect(evaluateReviewTriageDoneWhen(m).done).toBe(true)
  })

  test('a non-feedback discussion or one with no note id from another person never blocks completion', () => {
    const m = mission({
      review: review({ discussions: [discussion({ id: 'd1', isFeedback: false, lastOtherNoteId: 999 }), discussion({ id: 'd2', isFeedback: true, lastOtherNoteId: undefined })] }),
    })
    expect(evaluateReviewTriageDoneWhen(m).done).toBe(true)
  })

  test('detail always shows the latest report’s counts summary, whether done or not', () => {
    const m = mission({
      review: review({ discussions: [discussion({ id: 'd1', lastOtherNoteId: 101 }), discussion({ id: 'd2', lastOtherNoteId: 102 })] }),
      reviewTriage: reviewTriage([report({ notes: [101], counts: { confirmed: 1, pending: 1, withdrawn: 0, defensive: 0, premise: 0 } })]),
    })
    const result = evaluateReviewTriageDoneWhen(m)
    expect(result.done).toBe(false)
    expect(result.detail).toBe('確認 1／待驗證 1')
  })

  test('no reports found at all (key or evidence dir could not be resolved): not done, no detail, no throw', () => {
    const m = mission({ review: review({ discussions: [discussion({ id: 'd1', lastOtherNoteId: 101 })] }) })
    const result = evaluateReviewTriageDoneWhen(m)
    expect(result.done).toBe(false)
    expect(result.detail).toBeUndefined()
  })
})

describe('reviewTriageKey', () => {
  test('a mission name with #<number> gives the key directly, same as acceptanceKeyFromMissionName', () => {
    expect(reviewTriageKey('1030-#473', undefined)).toBe('473')
  })

  test('no #<number> in the name: falls back to the key segment of the resolved acceptance file path', () => {
    expect(reviewTriageKey('tour-notes', '/repo/.claude/specs/acceptance-tour-notes.md')).toBe('tour-notes')
  })

  test('a #<number> in the name wins over a different resolved path key (the name is authoritative, matching acceptance resolution order)', () => {
    expect(reviewTriageKey('1030-#473', '/repo/.claude/specs/acceptance-other.md')).toBe('473')
  })

  test('neither source available: undefined, not a guess', () => {
    expect(reviewTriageKey('tour-notes', undefined)).toBeUndefined()
  })

  test('a resolved path that does not match the acceptance-<key>.md shape: undefined', () => {
    expect(reviewTriageKey('tour-notes', '/repo/.claude/specs/spec-tour-notes.md')).toBeUndefined()
  })
})

describe('looksLikeReviewTriageReportWrite', () => {
  test('matches a review-triage report under .claude/verify-evidence/<key>/, any round', () => {
    expect(looksLikeReviewTriageReportWrite('/repo/.claude/verify-evidence/473/review-triage-r1.md')).toBe(true)
    expect(looksLikeReviewTriageReportWrite('/repo/.claude/verify-evidence/tour-notes/review-triage-r12.md')).toBe(true)
  })

  test('does not match the finding file, a different evidence file, or a file outside verify-evidence', () => {
    expect(looksLikeReviewTriageReportWrite('/repo/.claude/verify-evidence/473/review-findings-r1.md')).toBe(false)
    expect(looksLikeReviewTriageReportWrite('/repo/.claude/specs/acceptance-473.md')).toBe(false)
    expect(looksLikeReviewTriageReportWrite('/repo/docs/review-triage-r1.md')).toBe(false)
  })
})
