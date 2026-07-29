# Path resolution for proposals

Full detail behind SKILL.md step 2 ("Decide where the proposal lives"). Read this before implementing the resolution logic — the summary in SKILL.md is not enough to get the persistence/probe/fork-safety behavior right.

**Config schema** — layered `preview` config in `solopreneur.json`:

```jsonc
// new layered schema
{ "repos": { "<repo-key>": { "preview": { "path": "<path>" } } } }
```

- `<repo-key>` is computed by the shared `solopreneur_repo_key` helper from
  `scripts/config-helpers.sh` (`host/owner/repo` from the origin URL, or git
  toplevel path, or `$PWD`).
- `<path>`: stored **relative to the repo root** when the chosen path is
  inside a git repo; absolute otherwise.
- Legacy reads: configs written by older versions of this skill kept the
  per-repo paths at `preview.paths.<repo-key>` (a single shared `preview`
  subtree). `read_solopreneur_config preview` will still return that older
  subtree via the legacy fallback layer — handle both shapes when reading
  (see the resolution flow below).

**Resolution flow:**

1. **Compute the repo key**: `REPO_KEY=$(solopreneur_repo_key)`.
2. **Read the stored path**: try the new shape first (per-repo, single
   `path`), then fall back to the legacy shape (single `preview` subtree
   with a `paths` map):
   ```bash
   STORED=$(read_solopreneur_config preview)
   # New shape: when stored under repos[<rk>].preview, the cascade returned
   # `{ "path": "..." }` directly. Legacy shape returns `{ "paths": {...} }`.
   if [ -n "$STORED" ]; then
     PATH_VAL=$(printf '%s' "$STORED" | jq -r '.path // empty')
     if [ -z "$PATH_VAL" ]; then
       PATH_VAL=$(printf '%s' "$STORED" | jq -r --arg k "$REPO_KEY" '.paths[$k] // empty')
     fi
   fi
   ```
   If `PATH_VAL` is non-empty, resolve it (relative → joined onto the git
   toplevel; absolute → used as-is) and use that path. **Skip the probe and
   the question entirely** — go straight to the per-proposal dir.
3. **If absent, probe for a *suggested* path** (this is only a suggestion;
   the user confirms in step 4):
   - `git_root = $(git rev-parse --show-toplevel 2>/dev/null)`
   - If inside a repo:
     - A. Read that repo's `AGENTS.md` / `CLAUDE.md` / `README`. If they
       explicitly say where proposals / RFCs / design docs / specs live
       (e.g. "RFCs go in `docs/rfc/`", "specs in `specs/`", "todos in
       `todos/{triage,…}`"), use that. Match the spirit, not the keyword —
       a repo that organises thinking docs under `notes/` wants this skill
       to use `notes/`.
     - B. Otherwise look at the actual directory layout. If
       `docs/proposals/`, `docs/rfcs/`, `proposals/`, `design-docs/`, or
       similar already exists, sit inside it.
     - C. Otherwise default to `<git_root>/docs/preview/`.
     - **Fork-safety check**: if the repo has an `upstream` remote
       (`git remote -v | grep -i upstream`), this is probably a fork of an
       open-source project. Don't suggest dropping personal proposals into
       someone else's repo history — suggest the no-git fallback below
       instead and tell the user why.
   - If **not** in a git repo: if the cwd is inside a recognizable agent
     workspace (a directory tree with an `AGENTS.md` / `CLAUDE.md` at or
     above the cwd), suggest a workspace-relative `docs/preview/`. Final
     fallback: `~/.claude/previews/`.
4. **Confirm with `AskUserQuestion`** — present the suggested path:
   - *Question*: "Put the preview in `<suggested-path>`?"
   - Options: `Confirm and remember` / `Use a different path` / `Ask every time (don't remember)`
5. On **`Confirm and remember`** (or **`Use a different path`** after the user supplies a path):
   persist the chosen path under this repo's entry. The per-repo write
   helper handles the `repos[<repo-key>].preview` nesting; sibling repos
   are preserved automatically:

   ```bash
   write_solopreneur_repo_config preview "$(jq -n --arg p "$CHOSEN_PATH" '{path: $p}')"
   ```
   `$CHOSEN_PATH` is relative to repo root if inside a git repo, absolute
   otherwise.
6. On **`Ask every time (don't remember)`**: do **not** persist; use the suggested path
   for this run only.

The final proposal path is `<parent>/<YYYY-MM-DD>-<short-slug>/`. Each proposal lives in its own dir so its URL stays immutable. Don't reuse a dir across unrelated proposals; redeploying the same dir to iterate on the same proposal is fine (gives you a new URL each time, old ones remain).

**If the path lands inside a repo:**

1. The proposal HTML enters git history alongside the user's work — useful for review trail and cross-machine access. Good. Just commit it as a normal repo doc, no special handling.
2. `comment-overlay.js` is copied from this skill into every proposal dir. It would be wasteful to commit identical copies of it into every proposal and let stale versions linger. Append this line to the repo's `.gitignore` if not already there:
   ```
   **/comment-overlay.js
   ```
   Tell the user you did this (one short line) so they don't see a phantom diff.
