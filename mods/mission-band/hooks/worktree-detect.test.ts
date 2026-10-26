import { describe, expect, test } from 'claude-code/testing'

import {
  cdWorktreeCandidatePath,
  gitWorktreeAddPathFromCommand,
  looksLikeOrcaWorktreeCreateCommand,
  orcaWorktreeCreateNameFromCommand,
  orcaWorktreeCreatePathFromStdout,
  worktreePathForBranchFromPorcelain,
} from './worktree-detect'

describe('looksLikeOrcaWorktreeCreateCommand', () => {
  test('matches orca worktree create', () => {
    expect(looksLikeOrcaWorktreeCreateCommand('orca worktree create feat_x -b feat_x')).toBe(true)
  })

  test('does not match an unrelated orca or worktree command', () => {
    expect(looksLikeOrcaWorktreeCreateCommand('orca worktree list')).toBe(false)
    expect(looksLikeOrcaWorktreeCreateCommand('git worktree add /tmp/x')).toBe(false)
  })
})

describe('orcaWorktreeCreatePathFromStdout', () => {
  // 真實輸出（2026-10-23 在一個 orca worktree 裡跑 `orca worktree current --json` 驗過）：
  // 信封是 { id, ok, result: { worktree: {...} } }，worktree 物件本身就有 path，
  // 也有格式 `<repoId>::<絕對路徑>` 的 id。
  const REAL_ENVELOPE = {
    id: 'f8e01b87-c5a1-4361-bb59-958c0bfe2c8a',
    ok: true,
    result: {
      worktree: {
        id: '6d6a6fcf-f69c-42a4-b067-525ba9dbff05::/repo/.claude/worktrees/rsc-frontend/feat_x',
        path: '/repo/.claude/worktrees/rsc-frontend/feat_x',
        branch: 'refs/heads/feat_x',
      },
    },
  }

  test('reads result.worktree.path out of the real envelope shape', () => {
    expect(orcaWorktreeCreatePathFromStdout(JSON.stringify(REAL_ENVELOPE))).toBe('/repo/.claude/worktrees/rsc-frontend/feat_x')
  })

  test('derives the path from result.worktree.id (format <repoId>::<path>) when path itself is missing', () => {
    const envelope = {
      ...REAL_ENVELOPE,
      result: { worktree: { id: '6d6a6fcf-f69c-42a4-b067-525ba9dbff05::/repo/.claude/worktrees/feat_y' } },
    }
    expect(orcaWorktreeCreatePathFromStdout(JSON.stringify(envelope))).toBe('/repo/.claude/worktrees/feat_y')
  })

  test('falls back to a top-level worktree.path when there is no result wrapper', () => {
    const stdout = JSON.stringify({ worktree: { path: '/repo/.claude/worktrees/feat_z' } })
    expect(orcaWorktreeCreatePathFromStdout(stdout)).toBe('/repo/.claude/worktrees/feat_z')
  })

  test('falls back to deriving from a top-level worktree.id when neither has result nor a path field', () => {
    const stdout = JSON.stringify({ worktree: { id: 'repo-id::/repo/.claude/worktrees/feat_w' } })
    expect(orcaWorktreeCreatePathFromStdout(stdout)).toBe('/repo/.claude/worktrees/feat_w')
  })

  test('undefined when stdout is not JSON (does not guess) — e.g. running without --json', () => {
    expect(orcaWorktreeCreatePathFromStdout('worktree created at /repo/.claude/worktrees/feat_x')).toBeUndefined()
  })

  test('finds the envelope on its own line when other output comes before it (e.g. echo "exit=$?"; jq -c . file)', () => {
    expect(orcaWorktreeCreatePathFromStdout(`exit=0\n${JSON.stringify(REAL_ENVELOPE)}\n`)).toBe('/repo/.claude/worktrees/rsc-frontend/feat_x')
  })

  test('a summary line with a top-level path but no worktree object is not trusted', () => {
    expect(orcaWorktreeCreatePathFromStdout('exit=0\n{"ok":true,"path":"/repo/x","branch":"x"}')).toBeUndefined()
  })

  test('undefined when the JSON has no worktree object anywhere', () => {
    expect(orcaWorktreeCreatePathFromStdout(JSON.stringify({ ok: true, result: { status: 'done' } }))).toBeUndefined()
  })
})

describe('orcaWorktreeCreateNameFromCommand', () => {
  test('reads --name <value> from the command', () => {
    expect(orcaWorktreeCreateNameFromCommand('orca worktree create --name bug_x --base-branch origin/main --json')).toBe('bug_x')
  })

  test('reads --name=<value> and strips quotes', () => {
    expect(orcaWorktreeCreateNameFromCommand('orca worktree create --name=bug_x --json')).toBe('bug_x')
    expect(orcaWorktreeCreateNameFromCommand(`orca worktree create --name 'bug_x' --json`)).toBe('bug_x')
  })

  test('finds the name when stdout is redirected and other segments surround it (#412 real command)', () => {
    const command =
      'git fetch origin -q && orca worktree create --name bug_sales_users_cache_invalidation --repo path:/repo --base-branch origin/main --gitlab-issue 412 --no-parent --json > /tmp/orca-create.json 2>&1; echo "exit=$?"; jq -c . /tmp/orca-create.json'
    expect(orcaWorktreeCreateNameFromCommand(command)).toBe('bug_sales_users_cache_invalidation')
  })

  test('ignores --name inside another flag\'s quoted value', () => {
    expect(orcaWorktreeCreateNameFromCommand(`orca worktree create --prompt 'rerun with --name foo' --name bug_x --json > f`)).toBe('bug_x')
  })

  test('stops at a subshell paren or a redirect glued to the value', () => {
    expect(orcaWorktreeCreateNameFromCommand('(orca worktree create --name bug_x)')).toBe('bug_x')
    expect(orcaWorktreeCreateNameFromCommand('orca worktree create --name bug_x>/tmp/o')).toBe('bug_x')
  })

  test('undefined without --name, or when --name belongs to another command', () => {
    expect(orcaWorktreeCreateNameFromCommand('orca worktree create --json')).toBeUndefined()
    expect(orcaWorktreeCreateNameFromCommand('orca worktree list --name x')).toBeUndefined()
  })
})

describe('worktreePathForBranchFromPorcelain', () => {
  const PORCELAIN = [
    'worktree /repo',
    'HEAD aaa',
    'branch refs/heads/rc/1.112.0',
    '',
    'worktree /repo/.claude/worktrees/rsc-frontend/bug_x',
    'HEAD bbb',
    'branch refs/heads/bug_x',
    '',
    'worktree /repo/.claude/worktrees/verify-baseline',
    'HEAD ccc',
    'detached',
    '',
  ].join('\n')

  test('returns the worktree path whose branch matches', () => {
    expect(worktreePathForBranchFromPorcelain(PORCELAIN, 'bug_x')).toBe('/repo/.claude/worktrees/rsc-frontend/bug_x')
  })

  test('undefined when no worktree has that branch (prefix match does not count)', () => {
    expect(worktreePathForBranchFromPorcelain(PORCELAIN, 'bug')).toBeUndefined()
    expect(worktreePathForBranchFromPorcelain(PORCELAIN, 'feat_y')).toBeUndefined()
  })
})

describe('gitWorktreeAddPathFromCommand', () => {
  const ROOT = '/session-root'

  test('reads the path out of a plain git worktree add, falling back to sessionRoot for a relative path', () => {
    expect(gitWorktreeAddPathFromCommand('git worktree add wt', ROOT)).toBe('/session-root/wt')
  })

  test('an absolute path is used as-is, ignoring sessionRoot', () => {
    expect(gitWorktreeAddPathFromCommand('git worktree add /repo/.claude/worktrees/feat_x', ROOT)).toBe('/repo/.claude/worktrees/feat_x')
  })

  test('skips -b <branch> before the path', () => {
    expect(gitWorktreeAddPathFromCommand('git worktree add -b feat_x /repo/.claude/worktrees/feat_x origin/main', ROOT)).toBe(
      '/repo/.claude/worktrees/feat_x',
    )
  })

  test('skips --reason <string> (the other value-taking flag per `git worktree add -h`)', () => {
    // 字串層的 tokenizer 只照空白切，不是完整的 shell 解析，所以 reason 本身不能帶空白。
    expect(gitWorktreeAddPathFromCommand('git worktree add --lock --reason need-it /repo/.claude/worktrees/feat_x', ROOT)).toBe(
      '/repo/.claude/worktrees/feat_x',
    )
  })

  test('a relative path resolves against -C <dir> when given', () => {
    expect(gitWorktreeAddPathFromCommand('git -C /other-repo worktree add wt', ROOT)).toBe('/other-repo/wt')
  })

  test('-C <dir> accepts a quoted value with spaces', () => {
    expect(gitWorktreeAddPathFromCommand(`git -C "/has space" worktree add wt`, ROOT)).toBe('/has space/wt')
  })

  test('a relative path resolves against a preceding cd in the same command when there is no -C', () => {
    expect(gitWorktreeAddPathFromCommand('cd /repo/.claude/worktrees/parent && git worktree add wt', ROOT)).toBe(
      '/repo/.claude/worktrees/parent/wt',
    )
  })

  test('-C takes priority over a preceding cd', () => {
    expect(gitWorktreeAddPathFromCommand('cd /from-cd && git -C /from-c worktree add wt', ROOT)).toBe('/from-c/wt')
  })

  test('strips surrounding quotes off the path', () => {
    expect(gitWorktreeAddPathFromCommand(`git worktree add '/repo/.claude/worktrees/feat_x'`, ROOT)).toBe('/repo/.claude/worktrees/feat_x')
  })

  test('matches only when the segment itself starts with git — a Bash command that merely mentions the text does not count', () => {
    expect(gitWorktreeAddPathFromCommand('echo "git worktree add /tmp/x"', ROOT)).toBeUndefined()
    expect(gitWorktreeAddPathFromCommand('grep -r "git worktree add" .', ROOT)).toBeUndefined()
  })

  test('a later segment that genuinely runs git worktree add still matches, after an unrelated earlier segment', () => {
    expect(gitWorktreeAddPathFromCommand('echo hi; git worktree add /tmp/x', ROOT)).toBe('/tmp/x')
  })

  test('undefined when the command does not add a worktree', () => {
    expect(gitWorktreeAddPathFromCommand('git worktree list', ROOT)).toBeUndefined()
    expect(gitWorktreeAddPathFromCommand('git commit -m x', ROOT)).toBeUndefined()
  })
})

describe('cdWorktreeCandidatePath', () => {
  const REPO_ROOT = '/main-checkout'

  test('matches a cd into .claude/worktrees/ under the repo root, including the orca two-level nesting', () => {
    expect(cdWorktreeCandidatePath(`cd ${REPO_ROOT}/.claude/worktrees/rsc-frontend/feat_x`, REPO_ROOT)).toBe(
      `${REPO_ROOT}/.claude/worktrees/rsc-frontend/feat_x`,
    )
  })

  test('matches a cd into .worktrees/ (the fallback directory name) under the repo root', () => {
    expect(cdWorktreeCandidatePath(`cd ${REPO_ROOT}/.worktrees/feat_x`, REPO_ROOT)).toBe(`${REPO_ROOT}/.worktrees/feat_x`)
  })

  test('matches after the subagent contract’s leading cd pattern is not required — it finds the cd itself, any segment', () => {
    const command = `cd ${REPO_ROOT}/.claude/worktrees/feat_x && git status`
    expect(cdWorktreeCandidatePath(command, REPO_ROOT)).toBe(`${REPO_ROOT}/.claude/worktrees/feat_x`)
  })

  test('strips a trailing slash', () => {
    expect(cdWorktreeCandidatePath(`cd ${REPO_ROOT}/.claude/worktrees/feat_x/`, REPO_ROOT)).toBe(`${REPO_ROOT}/.claude/worktrees/feat_x`)
  })

  test('accepts a double- or single-quoted cd target with spaces', () => {
    expect(cdWorktreeCandidatePath(`cd "${REPO_ROOT}/.claude/worktrees/has space"`, REPO_ROOT)).toBe(`${REPO_ROOT}/.claude/worktrees/has space`)
    expect(cdWorktreeCandidatePath(`cd '${REPO_ROOT}/.claude/worktrees/has space'`, REPO_ROOT)).toBe(`${REPO_ROOT}/.claude/worktrees/has space`)
  })

  test('undefined for a cd outside the worktree dirs, even under the same repo root', () => {
    expect(cdWorktreeCandidatePath(`cd ${REPO_ROOT}/apps/admin`, REPO_ROOT)).toBeUndefined()
  })

  test('undefined for a cd into another repo’s worktree directory', () => {
    expect(cdWorktreeCandidatePath('cd /other-repo/.claude/worktrees/feat_x', REPO_ROOT)).toBeUndefined()
  })

  test('undefined when there is no cd at all', () => {
    expect(cdWorktreeCandidatePath('git status', REPO_ROOT)).toBeUndefined()
  })
})
