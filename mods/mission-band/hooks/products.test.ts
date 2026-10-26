import { describe, expect, test } from 'claude-code/testing'

import type { Mission } from '../types'
import {
  codexCliReviewNamesIn,
  descriptionFilePathFromCommand,
  evaluateDoneWhen,
  expandDescriptionPath,
  isReadStyleCommand,
  looksLikeMrCommand,
  matchesIssueNoteCommand,
  missingMrSections,
  mrIidFromOutput,
  ownProjectMrIid,
  parseBranchCommitsLog,
  pstackReadNames,
  pstackReadsInBashCommand,
  resolveDefaultBranchName,
  sameBranchCommits,
  splitBashSegments,
} from './products'

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

describe('pstackReadNames', () => {
  test('reads one playbook path out of a Read file_path', () => {
    const path = '/Users/x/.claude/pstack/v1/skills/poteto-mode/playbooks/prototype.md'
    expect(pstackReadNames(path)).toEqual(['playbook:prototype'])
  })

  test('reads every pstack path in a command, not only the first', () => {
    const command =
      "cat '/x/.claude/pstack/v1/skills/poteto-mode/playbooks/prototype.md' '/x/.claude/pstack/v1/skills/how/SKILL.md'"
    expect(pstackReadNames(command)).toEqual(['playbook:prototype', 'pstack:how'])
  })

  test('finds nothing when the text has no pstack path', () => {
    expect(pstackReadNames('cat README.md')).toEqual([])
  })
})

describe('isReadStyleCommand', () => {
  test('counts cat, head, tail and less as read-style', () => {
    expect(isReadStyleCommand('cat file.md')).toBe(true)
    expect(isReadStyleCommand('head -n 5 file.md')).toBe(true)
    expect(isReadStyleCommand('tail file.md')).toBe(true)
    expect(isReadStyleCommand('less file.md')).toBe(true)
  })

  test('counts sed -n as read-style, but not sed -i', () => {
    expect(isReadStyleCommand("sed -n '1,5p' file.md")).toBe(true)
    expect(isReadStyleCommand("sed -i 's/a/b/' file.md")).toBe(false)
  })

  test('skips a leading env var assignment before checking the command', () => {
    expect(isReadStyleCommand('FOO=bar cat file.md')).toBe(true)
  })
})

describe('pstackReadsInBashCommand', () => {
  const PATH = "'/x/.claude/pstack/v1/skills/poteto-mode/playbooks/prototype.md'"

  test('counts a cat after the subagent contract’s leading cd', () => {
    expect(pstackReadsInBashCommand(`cd /abs/worktree && cat ${PATH}`)).toEqual(['playbook:prototype'])
  })

  test('does not count a grep after the leading cd', () => {
    expect(pstackReadsInBashCommand(`cd /abs/worktree && grep -n prototype ${PATH}`)).toEqual([])
  })

  test('counts every read-style segment split on ; and |, not just the first', () => {
    const command = `cd /abs && cat ${PATH}; echo done | cat ${PATH}`
    expect(pstackReadsInBashCommand(command)).toEqual(['playbook:prototype', 'playbook:prototype'])
  })

  test('counts a read on its own line after a leading cd line', () => {
    expect(pstackReadsInBashCommand(`cd /abs/worktree\ncat ${PATH}`)).toEqual(['playbook:prototype'])
  })

  test('does not split on a separator sitting inside quotes', () => {
    const command = `echo 'a; b' && cat ${PATH}`
    expect(pstackReadsInBashCommand(command)).toEqual(['playbook:prototype'])
  })
})

describe('splitBashSegments', () => {
  test('splits on &&, ||, ;, | and newlines outside quotes', () => {
    expect(splitBashSegments('a && b || c; d | e\nf').map(s => s.trim())).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  test('splits on a single & (background job separator), but not &&', () => {
    expect(splitBashSegments('echo x & codex review').map(s => s.trim())).toEqual(['echo x', 'codex review'])
  })

  test('does not split &&, 2>&1, or &> — only a standalone & is a separator', () => {
    expect(splitBashSegments('a && b').map(s => s.trim())).toEqual(['a', 'b'])
    expect(splitBashSegments('codex review 2>&1 | tee log').map(s => s.trim())).toEqual(['codex review 2>&1', 'tee log'])
    expect(splitBashSegments('codex review &> log.txt').map(s => s.trim())).toEqual(['codex review &> log.txt'])
  })
})

describe('parseBranchCommitsLog', () => {
  test('parses hash<TAB>seconds lines, converting seconds to milliseconds', () => {
    const stdout = 'abc123\t1700000000\ndef456\t1700000060\n'
    expect(parseBranchCommitsLog(stdout)).toEqual([
      { hash: 'abc123', at: 1700000000000 },
      { hash: 'def456', at: 1700000060000 },
    ])
  })

  test('ignores blank lines and a line with no timestamp', () => {
    expect(parseBranchCommitsLog('\nabc123\n\n')).toEqual([])
  })

  test('returns an empty list for empty stdout', () => {
    expect(parseBranchCommitsLog('')).toEqual([])
  })
})

describe('resolveDefaultBranchName', () => {
  test('uses the symbolic-ref output when it succeeds', () => {
    expect(resolveDefaultBranchName('origin/develop\n', 0)).toBe('origin/develop')
  })

  test('falls back to origin/main on a non-zero exit', () => {
    expect(resolveDefaultBranchName('', 128)).toBe('origin/main')
  })

  test('falls back to origin/main when the output is blank even with exit 0', () => {
    expect(resolveDefaultBranchName('   \n', 0)).toBe('origin/main')
  })
})

describe('sameBranchCommits', () => {
  test('true for two empty lists', () => {
    expect(sameBranchCommits([], [])).toBe(true)
  })

  test('true when hash and at match in the same order', () => {
    expect(sameBranchCommits([{ hash: 'a', at: 1 }], [{ hash: 'a', at: 1 }])).toBe(true)
  })

  test('false when a hash, a timestamp, or the length differs', () => {
    expect(sameBranchCommits([{ hash: 'a', at: 1 }], [{ hash: 'b', at: 1 }])).toBe(false)
    expect(sameBranchCommits([{ hash: 'a', at: 1 }], [{ hash: 'a', at: 2 }])).toBe(false)
    expect(sameBranchCommits([{ hash: 'a', at: 1 }], [])).toBe(false)
  })
})

describe('evaluateDoneWhen', () => {
  test('commit: not done with no branchCommits', () => {
    expect(evaluateDoneWhen('commit', mission(), 0)).toEqual({ done: false, detail: undefined })
  })

  test('commit: done, with a commit count, once any commit is at or after enteredAt', () => {
    const m = mission({ branchCommits: [{ hash: 'a', at: 5 }, { hash: 'b', at: 9 }] })
    expect(evaluateDoneWhen('commit', m, 5)).toEqual({ done: true, detail: '2 commits' })
  })

  test('mr: not done with no mr product event', () => {
    expect(evaluateDoneWhen('mr', mission(), 0)).toEqual({ done: false, detail: undefined })
  })

  test('mr: done once a product event lands; detail only when sections are missing', () => {
    const clean = mission({ events: [{ at: 1, kind: 'product', name: 'mr', missingSections: [] }] })
    expect(evaluateDoneWhen('mr', clean, 0)).toEqual({ done: true, detail: undefined })

    const missing = mission({ events: [{ at: 1, kind: 'product', name: 'mr', missingSections: ['Evidence'] }] })
    expect(evaluateDoneWhen('mr', missing, 0)).toEqual({ done: true, detail: '缺 Evidence' })
  })

  test('issue-note: done only once a matching product event lands', () => {
    expect(evaluateDoneWhen('issue-note', mission(), 0)).toEqual({ done: false, detail: undefined })
    const m = mission({ events: [{ at: 1, kind: 'product', name: 'issue-note' }] })
    expect(evaluateDoneWhen('issue-note', m, 0)).toEqual({ done: true, detail: undefined })
  })

  test('worktree: not done with no worktreePath; done with it set, detail is the path', () => {
    expect(evaluateDoneWhen('worktree', mission(), 0)).toEqual({ done: false, detail: undefined })
    const m = mission({ worktreePath: '/repo/.claude/worktrees/feat_x' })
    expect(evaluateDoneWhen('worktree', m, 0)).toEqual({ done: true, detail: '/repo/.claude/worktrees/feat_x' })
  })
})

describe('codexCliReviewNamesIn', () => {
  test('matches a bare "codex review" or "codex exec" command', () => {
    expect(codexCliReviewNamesIn('codex review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('codex exec')).toEqual(['codex exec'])
  })

  test('matches with flags, and inside a cd && chain or a piped command', () => {
    expect(codexCliReviewNamesIn('codex review --base main')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('cd /repo && codex review --base main')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('cd /repo && codex review --base main 2>&1 | tee log')).toEqual(['codex review'])
  })

  test('already-working forms stay locked: FOO=1 codex review, cd x; codex review, a pipe', () => {
    expect(codexCliReviewNamesIn('FOO=1 codex review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('cd x; codex review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('codex review | tee log')).toEqual(['codex review'])
  })

  test('matches run through npx', () => {
    expect(codexCliReviewNamesIn('npx codex review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('npx codex exec')).toEqual(['codex exec'])
  })

  test('matches with a runner flag after npx/env (-y, -i), and with sudo/command as runner prefixes', () => {
    expect(codexCliReviewNamesIn('npx -y codex review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('env -i codex review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('sudo codex review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('command codex review')).toEqual(['codex review'])
  })

  test('matches an absolute path to the codex binary, compared by basename', () => {
    expect(codexCliReviewNamesIn('/opt/homebrew/bin/codex review')).toEqual(['codex review'])
  })

  test('matches with an env VAR=val prefix via the explicit env command', () => {
    expect(codexCliReviewNamesIn('env FOO=1 codex review')).toEqual(['codex review'])
  })

  test('matches prefixed with the time builtin', () => {
    expect(codexCliReviewNamesIn('time codex review')).toEqual(['codex review'])
  })

  test('matches inside a parenthesised subshell, stripping the wrapping ( and )', () => {
    expect(codexCliReviewNamesIn('(cd x && codex review)')).toEqual(['codex review'])
  })

  test('matches when a value-taking flag appears before the subcommand (-m/--model etc. consume the next token)', () => {
    expect(codexCliReviewNamesIn('codex -m o3 review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('codex --model o3 review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('codex -c key=val review')).toEqual(['codex review'])
    expect(codexCliReviewNamesIn('codex -p default -s read-only review')).toEqual(['codex review'])
  })

  test('a single & as a background separator still isolates the codex command', () => {
    expect(codexCliReviewNamesIn('echo x & codex review')).toEqual(['codex review'])
  })

  test('does not match the string "codex review" appearing inside another command', () => {
    expect(codexCliReviewNamesIn('echo "codex review"')).toEqual([])
    expect(codexCliReviewNamesIn('grep codex notes.md')).toEqual([])
    expect(codexCliReviewNamesIn('which codex')).toEqual([])
  })

  test('does not match an unrelated codex subcommand', () => {
    expect(codexCliReviewNamesIn('codex rescue')).toEqual([])
  })

  test('does not match codex review --help or -h, nor codex exec --help, nor --help before the subcommand', () => {
    expect(codexCliReviewNamesIn('codex review --help')).toEqual([])
    expect(codexCliReviewNamesIn('codex review -h')).toEqual([])
    expect(codexCliReviewNamesIn('codex exec --help')).toEqual([])
    expect(codexCliReviewNamesIn('codex --help review')).toEqual([])
  })

  test('a -h appearing inside a positional argument after the subcommand (e.g. a quoted prompt) is not help — scanning stops at the first positional', () => {
    expect(codexCliReviewNamesIn('codex exec "explain -h flag"')).toEqual(['codex exec'])
  })
})

describe('looksLikeMrCommand', () => {
  test('matches mr-create.sh and mr-update.sh', () => {
    expect(looksLikeMrCommand('bash ~/.claude/scripts/gitlab/mr-create.sh rsc-frontend')).toBe(true)
    expect(looksLikeMrCommand('mr-update.sh 499 123')).toBe(true)
  })

  test('does not match an unrelated command (e.g. cat of a spec, or a glab api read of an MR’s notes)', () => {
    expect(looksLikeMrCommand('git push origin feat_x')).toBe(false)
    expect(looksLikeMrCommand('cat docs/spec.md')).toBe(false)
    expect(looksLikeMrCommand('glab api projects/:id/merge_requests/493/notes')).toBe(false)
  })

  test('a --dry-run run is not treated as a real MR action', () => {
    expect(looksLikeMrCommand('mr-create.sh rsc-frontend --title x --dry-run')).toBe(false)
  })
})

describe('ownProjectMrIid', () => {
  const STDOUT = JSON.stringify({ web_url: 'https://gitlab.example.com/own/project/-/merge_requests/42' })

  test('finds the iid when the MR url is in this project', () => {
    expect(ownProjectMrIid(STDOUT, 'own/project')).toBe('42')
  })

  test('another project’s MR url does not count', () => {
    const otherProject = JSON.stringify({ web_url: 'https://gitlab.example.com/other/project/-/merge_requests/7' })
    expect(ownProjectMrIid(otherProject, 'own/project')).toBeUndefined()
  })

  test('undefined when stdout has no MR url at all', () => {
    expect(ownProjectMrIid('{"status":"ok"}', 'own/project')).toBeUndefined()
  })
})

describe('mrIidFromOutput', () => {
  test('prefers the JSON response’s web_url over a different MR url mentioned inside its own description field', () => {
    const stdout = JSON.stringify({
      description: '關聯 MR：https://gitlab.example.com/own/project/-/merge_requests/999（不是這次建的）',
      web_url: 'https://gitlab.example.com/own/project/-/merge_requests/42',
    })
    expect(mrIidFromOutput(stdout, 'own/project')).toBe('42')
  })

  test('undefined when the JSON response’s web_url is for another project', () => {
    const stdout = JSON.stringify({ web_url: 'https://gitlab.example.com/other/project/-/merge_requests/7' })
    expect(mrIidFromOutput(stdout, 'own/project')).toBeUndefined()
  })

  test('undefined when stdout is JSON but has no web_url (does not fall back to scanning the JSON text)', () => {
    const stdout = JSON.stringify({ description: 'https://gitlab.example.com/own/project/-/merge_requests/999' })
    expect(mrIidFromOutput(stdout, 'own/project')).toBeUndefined()
  })

  test('falls back to scanning the text when stdout is not JSON', () => {
    expect(mrIidFromOutput('已開：https://gitlab.example.com/own/project/-/merge_requests/9', 'own/project')).toBe('9')
  })
})

describe('expandDescriptionPath', () => {
  test('expands a leading ~/ using HOME', () => {
    expect(expandDescriptionPath('~/scratchpad/desc.md', '/home/x', '/repo')).toBe('/home/x/scratchpad/desc.md')
  })

  test('leaves ~/ alone when HOME is unavailable (does not guess)', () => {
    expect(expandDescriptionPath('~/scratchpad/desc.md', undefined, '/repo')).toBe('~/scratchpad/desc.md')
  })

  test('leaves an absolute path alone', () => {
    expect(expandDescriptionPath('/tmp/desc.md', '/home/x', '/repo')).toBe('/tmp/desc.md')
  })

  test('resolves a relative path against the session root', () => {
    expect(expandDescriptionPath('scratchpad/desc.md', '/home/x', '/repo')).toBe('/repo/scratchpad/desc.md')
  })
})

describe('descriptionFilePathFromCommand', () => {
  test('reads the path out of --description "$(cat <path>)"', () => {
    const command = 'mr-create.sh rsc-frontend "feat" --description "$(cat /tmp/x/desc.md)"'
    expect(descriptionFilePathFromCommand(command)).toBe('/tmp/x/desc.md')
  })

  test('reads the path out of --description="$(cat <path>)" (= form, quoted path)', () => {
    const command = `mr-update.sh 499 123 --description="$(cat '/tmp/x/has space.md')"`
    expect(descriptionFilePathFromCommand(command)).toBe('/tmp/x/has space.md')
  })

  test('undefined when the command does not use this pattern', () => {
    expect(descriptionFilePathFromCommand('mr-update.sh 499 123 --title "x"')).toBeUndefined()
  })
})

describe('missingMrSections', () => {
  const KEYWORDS = ['關聯', '為什麼要這樣做', 'Summary', 'Merge Danger', 'Evidence']

  test('nothing missing when every keyword appears in a heading line', () => {
    const description = ['# 關聯', '## 為什麼要這樣做', '## Summary', '### Merge Danger', '#### Evidence'].join('\n')
    expect(missingMrSections(description, KEYWORDS)).toEqual([])
  })

  test('lists the keywords whose heading is missing', () => {
    const description = ['## 關聯', '## Summary'].join('\n')
    expect(missingMrSections(description, KEYWORDS)).toEqual(['為什麼要這樣做', 'Merge Danger', 'Evidence'])
  })

  test('a keyword appearing only in body text, not a heading line, still counts as missing', () => {
    const description = ['## Summary', 'Merge Danger 的風險很低'].join('\n')
    expect(missingMrSections(description, ['Merge Danger'])).toEqual(['Merge Danger'])
  })

  test('an emoji sitting inside the keyword itself does not break the match (stripped before comparing)', () => {
    // 關鍵字本身被 emoji 從中間斷開才真的考驗有沒有濾掉 emoji；emoji 只是貼在旁邊的話，
    // .includes() 本來就不管旁邊多了什麼字元，測不出濾掉 emoji 這件事有沒有生效。
    const description = '## Ev🔗idence'
    expect(missingMrSections(description, ['Evidence'])).toEqual([])
  })
})

describe('matchesIssueNoteCommand', () => {
  const OWN = 'org/repo'
  const OWN_ENCODED = encodeURIComponent(OWN)

  test('matches issue-note.sh with this mission’s iid and this project’s short name as arguments', () => {
    expect(matchesIssueNoteCommand('issue-note.sh repo 473 "done"', '473', OWN)).toBe(true)
  })

  test('does not match issue-note.sh --dry-run: the preview prints the payload without posting the note', () => {
    expect(matchesIssueNoteCommand('issue-note.sh repo 473 "$(cat note.md)" --dry-run', '473', OWN)).toBe(false)
  })

  test('does not match issue-note.sh with a different iid', () => {
    expect(matchesIssueNoteCommand('issue-note.sh repo 4730 "done"', '473', OWN)).toBe(false)
  })

  test('does not match issue-note.sh against another project, even with the right iid', () => {
    expect(matchesIssueNoteCommand('issue-note.sh other-project 473 "done"', '473', OWN)).toBe(false)
  })

  test('does not match issue-note.sh when the own project cannot be resolved (no remote)', () => {
    expect(matchesIssueNoteCommand('issue-note.sh repo 473 "done"', '473', undefined)).toBe(false)
  })

  // 實際用法：issue-note.sh 的第一個參數是完整專案路徑（不是短名），短名前面接的是 `/`
  // 不是空白或引號，containsArgToken 的邊界規則抓不到——這是真的會發生的 bug，不是假設情境。
  const FULL_PATH = 'fugle/brokerage-service-development/r-securities/rsc-frontend'

  test('matches issue-note.sh called with the full project path as its first argument (real usage)', () => {
    const command = '~/.claude/scripts/gitlab/issue-note.sh fugle/brokerage-service-development/r-securities/rsc-frontend 473 --body "$(cat x)"'
    expect(matchesIssueNoteCommand(command, '473', FULL_PATH)).toBe(true)
  })

  test('does not match when the full path in the command names a different project', () => {
    const command = '~/.claude/scripts/gitlab/issue-note.sh fugle/brokerage-service-development/r-securities/rsc-pm 473 --body "$(cat x)"'
    expect(matchesIssueNoteCommand(command, '473', FULL_PATH)).toBe(false)
  })

  test('matches glab api issues/<iid>/notes with -X POST and the project path URL-encoded', () => {
    expect(matchesIssueNoteCommand(`glab api -X POST "projects/${OWN_ENCODED}/issues/473/notes" -f body=x`, '473', OWN)).toBe(true)
  })

  test('matches glab api issues/<iid>/notes with --method POST and no projects/ segment (glab infers the current repo)', () => {
    expect(matchesIssueNoteCommand('glab api --method POST issues/473/notes', '473', OWN)).toBe(true)
  })

  test('matches glab api with projects/:id (always the current repo), even without a resolvable own project', () => {
    expect(matchesIssueNoteCommand('glab api -X POST "projects/:id/issues/473/notes"', '473', undefined)).toBe(true)
  })

  test('matches glab api issues/<iid>/notes with -f field params and no explicit method (defaults to POST-style write)', () => {
    expect(matchesIssueNoteCommand('glab api issues/473/notes -f body=x', '473', OWN)).toBe(true)
  })

  test('does not match a POST on another project’s issue notes, even with the same iid', () => {
    expect(matchesIssueNoteCommand(`glab api -X POST "projects/other%2Fproject/issues/473/notes"`, '473', OWN)).toBe(false)
  })

  test('does not match a POST on a different issue’s notes (iid must match exactly, not just be a substring)', () => {
    expect(matchesIssueNoteCommand('glab api -X POST issues/999/notes', '473', OWN)).toBe(false)
    expect(matchesIssueNoteCommand('glab api -X POST issues/4730/notes', '473', OWN)).toBe(false)
  })

  test('does not match a plain read with no POST-style flag', () => {
    expect(matchesIssueNoteCommand(`glab api "projects/${OWN_ENCODED}/issues/473/notes?per_page=100"`, '473', OWN)).toBe(false)
  })

  test('does not match an unrelated command', () => {
    expect(matchesIssueNoteCommand('git status', '473', OWN)).toBe(false)
  })
})
