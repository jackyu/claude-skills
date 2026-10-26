import { describe, expect, test } from 'claude-code/testing'

import type { Mission } from '../types'
import {
  ASSETS_CAP,
  addCollectedAssets,
  classifyUrl,
  dedupeKey,
  descriptionFor,
  displayedAssets,
  extractCandidateUrls,
  gitlabIid,
  gitlabProjectPath,
  issueUrlFromRemote,
  isGrillWithDocsPrompt,
  labelFor,
  looksLikeIssueReadCommand,
  missionAssets,
  normalizeAssetUrl,
  ownIssueAsset,
  projectPathFromRemote,
  projectShortName,
  removeAsset,
  setManualAsset,
} from './assets'

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

describe('missionAssets', () => {
  test('treats a missing assets field as empty', () => {
    expect(missionAssets(mission())).toEqual([])
  })

  test('reads the assets array when present', () => {
    const asset = { url: 'https://x/y', label: '#1', description: '', source: 'manual' as const, at: 0 }
    expect(missionAssets(mission({ assets: [asset] }))).toEqual([asset])
  })
})

describe('displayedAssets', () => {
  const issue = { url: 'https://git.example.com/a/b/-/issues/473', label: '#473', description: 'issue', source: 'issue' as const, at: 0 }
  const figma = { url: 'https://www.figma.com/design/k/x', label: '設計稿', description: 'figma', source: 'prompt' as const, at: 0 }
  const checklist = { exists: true, resolvedPath: '/repo/.claude/specs/acceptance-473.md', readAt: 0 }

  test('沒有驗收清單時就是存起來的資產', () => {
    expect(displayedAssets(mission({ assets: [issue, figma] }))).toEqual([issue, figma])
  })

  test('清單存在時排在任務自己的 issue 後面，標籤是檔名、點開是 file 網址', () => {
    const shown = displayedAssets(mission({ assets: [issue, figma], acceptance: checklist }))
    expect(shown.map(a => a.label)).toEqual(['#473', 'acceptance-473.md', '設計稿'])
    expect(shown[1]?.url).toBe('file:///repo/.claude/specs/acceptance-473.md')
  })

  test('沒有任務自己的 issue 時，清單排第一個', () => {
    const shown = displayedAssets(mission({ assets: [figma], acceptance: checklist }))
    expect(shown.map(a => a.label)).toEqual(['acceptance-473.md', '設計稿'])
  })

  test('exists 是 false（清單被刪掉）或沒有路徑時不顯示', () => {
    expect(displayedAssets(mission({ assets: [issue], acceptance: { ...checklist, exists: false } }))).toEqual([issue])
    expect(displayedAssets(mission({ assets: [issue], acceptance: { exists: true, readAt: 0 } }))).toEqual([issue])
  })

  test('路徑裡的空白和中文會編碼成合法的 file 網址', () => {
    const shown = displayedAssets(mission({ acceptance: { ...checklist, resolvedPath: '/my repo/規格/acceptance-1.md' } }))
    expect(shown[0]?.url).toBe('file:///my%20repo/%E8%A6%8F%E6%A0%BC/acceptance-1.md')
  })

  test('descriptionFor 把驗收清單的 file 網址說成「驗收清單」', () => {
    expect(descriptionFor('file:///repo/.claude/specs/acceptance-473.md')).toBe('驗收清單')
  })
})

describe('normalizeAssetUrl', () => {
  test('leaves an already-plain url alone', () => {
    expect(normalizeAssetUrl('https://git.example.com/a/b/-/issues/1')).toBe('https://git.example.com/a/b/-/issues/1')
  })

  test('is a no-op for an unparsable string', () => {
    expect(normalizeAssetUrl('not a url')).toBe('not a url')
  })
})

describe('dedupeKey', () => {
  test('strips the query string', () => {
    expect(dedupeKey('https://git.example.com/a/b/-/issues/1?x=1')).toBe(dedupeKey('https://git.example.com/a/b/-/issues/1'))
  })

  test('strips any hash, not only #note_ (there is no other recognized use on a gitlab issue page)', () => {
    expect(dedupeKey('https://git.example.com/a/b/-/issues/1#note_12345')).toBe(dedupeKey('https://git.example.com/a/b/-/issues/1'))
    expect(dedupeKey('https://git.example.com/a/b/-/issues/1#other')).toBe(dedupeKey('https://git.example.com/a/b/-/issues/1'))
  })

  test('treats issue and work_item on the same project/iid as the same ticket', () => {
    expect(dedupeKey('https://git.example.com/a/b/-/work_items/8')).toBe(dedupeKey('https://git.example.com/a/b/-/issues/8'))
  })

  test('does not conflate an mr with an issue of the same iid', () => {
    expect(dedupeKey('https://git.example.com/a/b/-/merge_requests/8')).not.toBe(dedupeKey('https://git.example.com/a/b/-/issues/8'))
  })

  test('ignores a trailing sub-path (notes, diffs, designs) on the same ticket', () => {
    expect(dedupeKey('https://git.example.com/g/p/-/issues/10/notes')).toBe(dedupeKey('https://git.example.com/g/p/-/issues/10'))
    expect(dedupeKey('https://git.example.com/g/p/-/merge_requests/11/diffs')).toBe(dedupeKey('https://git.example.com/g/p/-/merge_requests/11'))
  })

  test('figma keeps its query (node-id) as part of the key — different frames are different assets', () => {
    expect(dedupeKey('https://www.figma.com/design/AbC/x?node-id=1-2')).not.toBe(
      dedupeKey('https://www.figma.com/design/AbC/x?node-id=3-4'),
    )
  })

  test('figma ignores every query param except node-id — "複製連結" changes t= each time, same frame must stay one asset', () => {
    expect(dedupeKey('https://www.figma.com/design/AbC/x?node-id=1-2&t=aaaa')).toBe(
      dedupeKey('https://www.figma.com/design/AbC/x?node-id=1-2&t=bbbb'),
    )
  })

  test('http vs https of the same gitlab ticket collapse to one key', () => {
    expect(dedupeKey('http://git.example.com/a/b/-/issues/1')).toBe(dedupeKey('https://git.example.com/a/b/-/issues/1'))
  })

  test('http vs https of the same figma frame collapse to one key', () => {
    expect(dedupeKey('http://www.figma.com/design/AbC/x?node-id=1-2')).toBe(
      dedupeKey('https://www.figma.com/design/AbC/x?node-id=1-2'),
    )
  })
})

describe('classifyUrl', () => {
  test('recognizes a gitlab issue, work_item and merge_request path', () => {
    expect(classifyUrl('https://git.example.com/a/b/-/issues/1')).toBe('gitlab-issue')
    expect(classifyUrl('https://git.example.com/a/b/-/work_items/1')).toBe('gitlab-work-item')
    expect(classifyUrl('https://git.example.com/a/b/-/merge_requests/1')).toBe('gitlab-mr')
  })

  test('recognizes figma.com regardless of path', () => {
    expect(classifyUrl('https://www.figma.com/design/abc/My-File')).toBe('figma')
  })

  test('returns undefined for anything else', () => {
    expect(classifyUrl('https://example.com/whatever')).toBeUndefined()
    expect(classifyUrl('not a url')).toBeUndefined()
  })
})

describe('gitlabProjectPath and gitlabIid', () => {
  test('reads the project path and issue number out of the path', () => {
    const url = 'https://git.fugle.tw/fugle/brokerage-service-development/r-securities/rsc-pm/-/issues/187'
    expect(gitlabProjectPath(url)).toBe('fugle/brokerage-service-development/r-securities/rsc-pm')
    expect(gitlabIid(url)).toBe('187')
  })

  test('also reads a merge request iid', () => {
    const url = 'https://git.fugle.tw/a/b/-/merge_requests/493'
    expect(gitlabIid(url)).toBe('493')
  })
})

describe('projectShortName', () => {
  test('takes the last path segment', () => {
    expect(projectShortName('fugle/brokerage-service-development/r-securities/rsc-pm')).toBe('rsc-pm')
  })
})

describe('projectPathFromRemote', () => {
  test('parses an ssh remote', () => {
    expect(projectPathFromRemote('git@git.fugle.tw:fugle/brokerage-service-development/r-securities/rsc-frontend.git')).toEqual({
      host: 'git.fugle.tw',
      path: 'fugle/brokerage-service-development/r-securities/rsc-frontend',
    })
  })

  test('parses an https remote, with or without .git', () => {
    expect(projectPathFromRemote('https://git.fugle.tw/a/b/c.git')).toEqual({ host: 'git.fugle.tw', path: 'a/b/c' })
    expect(projectPathFromRemote('https://git.fugle.tw/a/b/c')).toEqual({ host: 'git.fugle.tw', path: 'a/b/c' })
  })

  test('parses an ssh:// remote with an explicit port, dropping the port', () => {
    expect(projectPathFromRemote('ssh://git@git.fugle.tw:2222/g/p.git')).toEqual({ host: 'git.fugle.tw', path: 'g/p' })
  })

  test('strips userinfo (basic auth / token) off an https remote — it must never surface', () => {
    const result = projectPathFromRemote('https://oauth2:SECRET-TOKEN@git.fugle.tw/g/p.git')
    expect(result).toEqual({ host: 'git.fugle.tw', path: 'g/p' })
    expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN')
  })

  test('a trailing slash on an https remote does not leak into the path', () => {
    expect(projectPathFromRemote('https://git.fugle.tw/g/p/')).toEqual({ host: 'git.fugle.tw', path: 'g/p' })
  })

  test('is undefined for null, undefined or an unrecognized remote', () => {
    expect(projectPathFromRemote(null)).toBeUndefined()
    expect(projectPathFromRemote(undefined)).toBeUndefined()
    expect(projectPathFromRemote('whatever')).toBeUndefined()
  })
})

describe('issueUrlFromRemote', () => {
  test('builds an issue url from an ssh remote', () => {
    expect(issueUrlFromRemote('git@git.fugle.tw:a/b/c.git', '473')).toBe('https://git.fugle.tw/a/b/c/-/issues/473')
  })

  test('builds an issue url from an https remote', () => {
    expect(issueUrlFromRemote('https://git.fugle.tw/a/b/c.git', '473')).toBe('https://git.fugle.tw/a/b/c/-/issues/473')
  })

  test('is undefined when there is no usable remote', () => {
    expect(issueUrlFromRemote(null, '473')).toBeUndefined()
    expect(issueUrlFromRemote(undefined, '473')).toBeUndefined()
  })

  test('never leaks a token from the remote, and a trailing slash never doubles the slash before -/issues', () => {
    expect(issueUrlFromRemote('https://oauth2:SECRET-TOKEN@git.fugle.tw/g/p.git', '1')).toBe('https://git.fugle.tw/g/p/-/issues/1')
    expect(issueUrlFromRemote('https://git.fugle.tw/g/p/', '1')).toBe('https://git.fugle.tw/g/p/-/issues/1')
  })
})

describe('extractCandidateUrls', () => {
  test('finds a gitlab issue url and strips trailing punctuation', () => {
    const text = '請看 (https://git.example.com/a/b/-/issues/1)，謝謝。'
    expect(extractCandidateUrls(text)).toEqual(['https://git.example.com/a/b/-/issues/1'])
  })

  test('finds a figma url', () => {
    const text = '設計稿：https://www.figma.com/design/abc/My-File?node-id=1-2'
    expect(extractCandidateUrls(text)).toEqual(['https://www.figma.com/design/abc/My-File?node-id=1-2'])
  })

  test('drops an upload link, an image, and an avatar', () => {
    const text = [
      'https://git.example.com/a/b/uploads/1/x.png',
      'https://git.example.com/a/b/-/issues/1/x.png',
      'https://git.example.com/uploads/-/system/user/avatar/1/avatar.png',
    ].join(' ')
    expect(extractCandidateUrls(text)).toEqual([])
  })

  test('drops a plain, non-gitlab non-figma url', () => {
    expect(extractCandidateUrls('see https://example.com/whatever')).toEqual([])
  })

  test('dedupes two links to the same issue that differ only by note anchor', () => {
    const text = 'https://git.example.com/a/b/-/issues/1#note_1 and https://git.example.com/a/b/-/issues/1#note_2'
    expect(extractCandidateUrls(text)).toEqual(['https://git.example.com/a/b/-/issues/1#note_1'])
  })

  test('finds every distinct match, not only the first', () => {
    const text = 'https://git.example.com/a/b/-/issues/1 https://git.example.com/a/b/-/merge_requests/2'
    expect(extractCandidateUrls(text)).toEqual([
      'https://git.example.com/a/b/-/issues/1',
      'https://git.example.com/a/b/-/merge_requests/2',
    ])
  })

  test('unescapes JSON\'s \\/ so a url printed by `glab api` is not cut into pieces', () => {
    const text = '"https:\\/\\/git.fugle.tw\\/g\\/p\\/-\\/issues\\/5"'
    expect(extractCandidateUrls(text)).toEqual(['https://git.fugle.tw/g/p/-/issues/5'])
  })

  test('unescapes a JSON \\u0026 so a figma query string keeps its full &-separated params', () => {
    const text = '"https://www.figma.com/design/AbC/x?node-id=1-2\\u0026t=zz"'
    expect(extractCandidateUrls(text)).toEqual(['https://www.figma.com/design/AbC/x?node-id=1-2&t=zz'])
  })

  test('a literal \\n (two chars: backslash, n) inside unparsed JSON stdout terminates the url instead of swallowing the rest of the line', () => {
    const text = '{"description":"見 https://git.fugle.tw/g/rsc-pm/-/issues/187\\n- next https://git.fugle.tw/g/rsc-pm/-/issues/188\\r\\nend"}'
    expect(extractCandidateUrls(text)).toEqual([
      'https://git.fugle.tw/g/rsc-pm/-/issues/187',
      'https://git.fugle.tw/g/rsc-pm/-/issues/188',
    ])
  })

  test('markdown wrapping (backtick, angle brackets, [text](url), **bold**) does not leak into the url', () => {
    expect(extractCandidateUrls('`https://git.fugle.tw/g/p/-/issues/12`')).toEqual(['https://git.fugle.tw/g/p/-/issues/12'])
    expect(extractCandidateUrls('<https://git.fugle.tw/g/p/-/issues/13>')).toEqual(['https://git.fugle.tw/g/p/-/issues/13'])
    expect(extractCandidateUrls('[票](https://git.fugle.tw/g/p/-/issues/5)。')).toEqual(['https://git.fugle.tw/g/p/-/issues/5'])
    expect(extractCandidateUrls('**https://git.fugle.tw/g/p/-/issues/14**')).toEqual(['https://git.fugle.tw/g/p/-/issues/14'])
  })

  test('a full-width paren right against the url is still excluded', () => {
    expect(extractCandidateUrls('（https://git.fugle.tw/g/p/-/merge_requests/7）')).toEqual([
      'https://git.fugle.tw/g/p/-/merge_requests/7',
    ])
  })

  test('drops an issues board/filter link and a "new issue" link — neither names one ticket', () => {
    const text = 'https://git.fugle.tw/g/p/-/issues?label=x https://git.fugle.tw/g/p/-/issues/new'
    expect(extractCandidateUrls(text)).toEqual([])
  })

  test('drops an image nested under an issue path, but keeps a non-image sub-path on another issue', () => {
    const text = 'https://git.fugle.tw/g/p/-/issues/9/designs/x.png https://git.fugle.tw/g/p/-/issues/10/notes'
    expect(extractCandidateUrls(text)).toEqual(['https://git.fugle.tw/g/p/-/issues/10/notes'])
  })
})

describe('isGrillWithDocsPrompt', () => {
  test('matches the bare command', () => {
    expect(isGrillWithDocsPrompt('/grill-with-docs https://x')).toBe(true)
  })

  test('matches the plugin-prefixed command', () => {
    expect(isGrillWithDocsPrompt('/mattpocock-skills:grill-with-docs https://x')).toBe(true)
  })

  test('does not match an unrelated prompt that happens to contain a url', () => {
    expect(isGrillWithDocsPrompt('看一下 https://git.example.com/a/b/-/issues/1')).toBe(false)
  })

  test('does not match a different command that merely shares the prefix (grill-with-docs-v2)', () => {
    expect(isGrillWithDocsPrompt('/grill-with-docs-v2 x')).toBe(false)
  })

  test('does not match when the command is not at the very start of the prompt', () => {
    expect(isGrillWithDocsPrompt('please /grill-with-docs')).toBe(false)
  })
})

describe('looksLikeIssueReadCommand', () => {
  test('matches glab api with an issues path', () => {
    expect(looksLikeIssueReadCommand('glab api "projects/524/issues/187"')).toBe(true)
  })

  test('matches a call to issue-get.sh', () => {
    expect(looksLikeIssueReadCommand('issue-get.sh fugle/x/y/rsc-frontend 460')).toBe(true)
  })

  test('does not match glab api on an unrelated path', () => {
    expect(looksLikeIssueReadCommand('glab api "projects/524/merge_requests/1/notes"')).toBe(false)
  })

  test('does not match an unrelated command', () => {
    expect(looksLikeIssueReadCommand('cat README.md')).toBe(false)
  })
})

describe('labelFor', () => {
  const OWN = 'fugle/brokerage-service-development/r-securities/rsc-frontend'

  test('labels an issue in the mission’s own project with just #<n>', () => {
    const url = `https://git.fugle.tw/${OWN}/-/issues/473`
    expect(labelFor(url, OWN, new Set())).toBe('#473')
  })

  test('labels an issue in another project as <short>#<n>', () => {
    const url = 'https://git.fugle.tw/fugle/brokerage-service-development/r-securities/rsc-pm/-/issues/187'
    expect(labelFor(url, OWN, new Set())).toBe('rsc-pm#187')
  })

  test('labels a merge request with !<n>, prefixed by project when not the own one', () => {
    const ownMr = `https://git.fugle.tw/${OWN}/-/merge_requests/493`
    expect(labelFor(ownMr, OWN, new Set())).toBe('!493')
    const otherMr = 'https://git.fugle.tw/fugle/brokerage-service-development/r-securities/rsc-pm/-/merge_requests/9'
    expect(labelFor(otherMr, OWN, new Set())).toBe('rsc-pm!9')
  })

  test('labels figma links 設計稿, 設計稿-2, 設計稿-3 in order as each is taken (no space, so /mission-link can address them)', () => {
    const url = 'https://www.figma.com/design/abc/My-File'
    const used = new Set<string>()
    const first = labelFor(url, OWN, used)
    used.add(first)
    const second = labelFor(url, OWN, used)
    used.add(second)
    const third = labelFor(url, OWN, used)
    expect([first, second, third]).toEqual(['設計稿', '設計稿-2', '設計稿-3'])
  })

  test('a label collision from a non-figma source also gets a dash suffix', () => {
    const used = new Set(['one#1'])
    const url = 'https://git.fugle.tw/y/one/-/issues/1'
    expect(labelFor(url, OWN, used)).toBe('one#1-2')
  })
})

describe('descriptionFor', () => {
  test('describes a gitlab issue just as "issue", in the own project or a cross-project one alike — the project name lives on the label, not here', () => {
    const own = 'https://git.fugle.tw/a/b/-/issues/1'
    const crossProject = 'https://git.fugle.tw/fugle/brokerage-service-development/r-securities/rsc-pm/-/issues/187'
    expect(descriptionFor(own)).toBe('issue')
    expect(descriptionFor(crossProject)).toBe('issue')
  })

  test('describes a merge request just as "MR", with no project name either', () => {
    const url = 'https://git.fugle.tw/a/b/-/merge_requests/1'
    expect(descriptionFor(url)).toBe('MR')
  })

  test('describes a figma link simply as figma', () => {
    expect(descriptionFor('https://www.figma.com/design/abc/My-File')).toBe('figma')
  })
})

describe('ownIssueAsset', () => {
  test('builds a bare #<n> asset for the mission’s own issue', () => {
    const asset = ownIssueAsset('https://git.fugle.tw/a/b/-/issues/473', '473', 10)
    expect(asset).toEqual({
      url: 'https://git.fugle.tw/a/b/-/issues/473',
      label: '#473',
      description: 'issue',
      source: 'issue',
      at: 10,
    })
  })
})

describe('addCollectedAssets', () => {
  test('adds a new collectible url, labelled by project since no own project was given', () => {
    const url = 'https://git.example.com/a/b/-/issues/1'
    const updated = addCollectedAssets(mission(), [url], 'prompt', 5, undefined)
    expect(missionAssets(updated)).toEqual([{ url, label: 'b#1', description: 'issue', source: 'prompt', at: 5 }])
  })

  test('labels bare #<n> when the url is in the own project', () => {
    const url = 'https://git.example.com/a/b/-/issues/1'
    const updated = addCollectedAssets(mission(), [url], 'prompt', 5, 'a/b')
    expect(missionAssets(updated)).toEqual([{ url, label: '#1', description: 'issue', source: 'prompt', at: 5 }])
  })

  test('skips a url already present (by its dedupe key)', () => {
    const existing = { url: 'https://git.example.com/a/b/-/issues/1', label: '#1', description: 'issue', source: 'issue' as const, at: 0 }
    const m = mission({ assets: [existing] })
    const updated = addCollectedAssets(m, ['https://git.example.com/a/b/-/issues/1?x=1'], 'prompt', 5, undefined)
    expect(updated).toBe(m)
  })

  test('returns the same mission reference when nothing changed', () => {
    const m = mission()
    expect(addCollectedAssets(m, [], 'prompt', 5, undefined)).toBe(m)
  })

  test('stops adding once the cap is reached', () => {
    const existing = Array.from({ length: ASSETS_CAP }, (_, i) => ({
      url: `https://git.example.com/a/b/-/issues/${i}`,
      label: `#${i}`,
      description: 'issue',
      source: 'prompt' as const,
      at: 0,
    }))
    const m = mission({ assets: existing })
    const updated = addCollectedAssets(m, ['https://git.example.com/a/b/-/issues/999'], 'prompt', 5, undefined)
    expect(updated).toBe(m)
  })

  test('same project+iid via work_item is a dedupe, a different project with the same iid is not, and a same-short-name collision gets -2', () => {
    const existing = {
      url: 'https://git.fugle.tw/a/rsc-frontend/-/issues/473',
      label: '#473',
      description: '',
      source: 'issue' as const,
      at: 0,
    }
    const m = mission({ assets: [existing] })
    const updated = addCollectedAssets(
      m,
      [
        'https://git.fugle.tw/b/rsc-frontend/-/issues/473', // 不同專案、同 iid：不是同一張票，要新增
        'https://git.fugle.tw/a/rsc-frontend/-/work_items/473', // 同專案同 iid、換成 work_item 路徑：跟既有那筆是同一張票，跳過
        'https://git.fugle.tw/x/one/-/issues/1', // 新票
        'https://git.fugle.tw/y/one/-/issues/1', // 不同專案、同 iid，但 short name 跟上一筆撞名，要加 -2
      ],
      'tool',
      1,
      'a/rsc-frontend',
    )
    const labels = missionAssets(updated).map(a => `${a.label} ${a.url}`)
    expect(labels).toEqual([
      '#473 https://git.fugle.tw/a/rsc-frontend/-/issues/473',
      'rsc-frontend#473 https://git.fugle.tw/b/rsc-frontend/-/issues/473',
      'one#1 https://git.fugle.tw/x/one/-/issues/1',
      'one#1-2 https://git.fugle.tw/y/one/-/issues/1',
    ])

    // 同一張票又來一次（query 不同），即使 iid／專案都對得上也不該再收一次。
    const again = addCollectedAssets(updated, ['https://git.fugle.tw/x/one/-/issues/1?x=1'], 'tool', 2, 'a/rsc-frontend')
    expect(again).toBe(updated)
  })
})

describe('setManualAsset and removeAsset', () => {
  test('adds a manual asset under the given label', () => {
    const updated = setManualAsset(mission(), '設計稿', 'https://www.figma.com/design/abc/x', 1)
    expect(missionAssets(updated)).toEqual([
      { url: 'https://www.figma.com/design/abc/x', label: '設計稿', description: 'figma', source: 'manual', at: 1 },
    ])
  })

  test('overrides the entry already under that label instead of adding a second one', () => {
    const first = setManualAsset(mission(), 'spec', 'https://a', 1)
    const second = setManualAsset(first, 'spec', 'https://b', 2)
    expect(missionAssets(second)).toEqual([{ url: 'https://b', label: 'spec', description: '', source: 'manual', at: 2 }])
  })

  test('refuses a brand-new label once the cap is reached, keeping the mission unchanged', () => {
    const existing = Array.from({ length: ASSETS_CAP }, (_, i) => ({
      url: `https://a/${i}`,
      label: `l${i}`,
      description: '',
      source: 'manual' as const,
      at: 0,
    }))
    const m = mission({ assets: existing })
    expect(setManualAsset(m, 'new-label', 'https://new', 1)).toBe(m)
  })

  test('removeAsset drops the matching label and is a no-op otherwise', () => {
    const m = mission({ assets: [{ url: 'https://a', label: 'spec', description: '', source: 'manual', at: 0 }] })
    const removed = removeAsset(m, 'spec')
    expect(missionAssets(removed)).toEqual([])
    expect(removeAsset(m, 'no-such-label')).toBe(m)
  })
})
