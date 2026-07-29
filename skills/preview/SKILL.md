---
name: preview
description: Create an interactive HTML preview of any proposal, plan, idea, or spec, deploy it to Vercel for a shareable URL, and embed a comment overlay so the user can highlight text, annotate, and export feedback markdown back to the agent. Use WHENEVER the user wants something visualized, made into a webpage, or shared for human review. Triggers include "make a preview", "turn this into a webpage", "visualize this", "share for review", "make me a chart".
---

# preview

Turn any proposal / plan / idea into an interactive HTML page, deploy it to Vercel, and hand the user a URL. The page comes with a built-in comment overlay so the user can highlight text, leave notes, and export the feedback as markdown for the next iteration.

## Outcome the user is looking for

A link they can open in their browser, read or play with, and respond to with concrete in-context comments. Not a wall of markdown. Not a static screenshot. Something they can **try**.

## Triggers

ALWAYS use this skill when the user says any of: make a preview / give me a preview / turn this into a webpage / visualize this / make it interactive / do a review / share for review / make a calculator page / make me a chart / make a diagram / render this as HTML / turn this idea into a webpage / make this reviewable / build a quick page / interactive proposal.

This is the preferred way to share any work-in-progress thinking with a human, because it is faster for them to grok and respond to than a markdown wall of text.

## Workflow

### 1. Preflight FIRST, before writing anything

**Always run `bash scripts/preflight.sh` before drafting the HTML.** No exceptions — doing it early saves you from writing a great proposal and then discovering you can't ship it. Preflight verifies the Vercel CLI is installed, logged in, and the token still works.

**If preflight passes:** say one short line (`vercel CLI ready, proceeding…`) and move to step 2.

**If preflight fails:** Do NOT silently surface the script's error and stop — the user wants a path forward, not a punt. Read the preflight stderr (it names exactly what's missing and the fix command), then **use AskUserQuestion**: "Vercel CLI isn't installed (or not logged in / token expired) — set it up now?" with options `Set up now` / `Just view HTML locally, deploy later` / `Cancel`. On "Set up now", print the exact commands (`npm i -g vercel` and/or `vercel login`), wait for confirmation, re-run preflight, loop until it passes. On "Just view locally", resolve the proposal path exactly as in step 2 (config-backed, same probe + persistence), write the HTML there, `open` it locally — they can deploy later. On "Cancel", stop cleanly without writing files they didn't ask for.

`deploy.sh` also runs preflight on every invocation as a safety net.

### 2. Decide where the proposal lives, then create the dir

The proposal shouldn't live somewhere arbitrary — it should sit alongside the work the user is already doing. The resolved parent path is **persisted per repo** in the solopreneur config so subsequent runs in the same repo skip the probe and the question entirely.

Source the config helpers before this step's bash work — they compute the repo key and do the layered read/write against `solopreneur.json` (`solopreneur_repo_key`, `read_solopreneur_config`, `write_solopreneur_config`, `write_solopreneur_repo_config`):

```bash
source scripts/config-helpers.sh
```

See `scripts/config-helpers.sh` for the full cascade logic if you need to debug it.

**Read `references/path-resolution.md` before writing this step's logic.** tl;dr: compute the repo key → check `solopreneur.json` for a stored path (new per-repo shape, falling back to a legacy shape) and skip straight to the proposal dir if found → otherwise probe the repo's `AGENTS.md`/`CLAUDE.md`/directory layout for a *suggested* path (with a fork-safety check that avoids dropping proposals into someone else's upstream history) → confirm the suggestion with `AskUserQuestion` → persist the chosen path unless the user opts to be asked every time. The final path is `<parent>/<YYYY-MM-DD>-<short-slug>/`. If it lands inside a repo, commit the HTML normally and add `**/comment-overlay.js` to `.gitignore` (told to the user in one line) since that file is copied fresh into every proposal dir.

### 2.5 Define what goes in

Before writing the HTML, know exactly which deliverable the preview is
**for**. A preview of the wrong artifact wastes the whole round.

**Self-assess ambiguity first — don't ask reflexively.** Ask the user
**only if** any of these hold:

- the session discussed **≥2 separable topics / deliverables** and the
  preview request didn't name which one;
- the request is a bare "make a preview" arriving after a
  **wide-ranging discussion** with no single clear target;
- **multiple candidate artifacts** plausibly exist (e.g. a plan *and* a
  pricing model *and* a roadmap).

**If it's clear** (the common case — the user just asked to preview the
thing you were both just working on): state in **one line** what you're
about to preview ("Previewing the Q3 pricing proposal — the 3-tier table +
the calculator.") and proceed. No question.

**If it's ambiguous:** use `AskUserQuestion` with **multiSelect**, listing
the session's candidate pieces as options (one option per separable
artifact, plus the natural combinations if they belong together). The
selected set becomes the **content contract** for Step 3 — build exactly
that, nothing the user didn't pick. Don't editorialize the list; surface
what was actually discussed.

Zero friction on the normal path; only interrupts when the target genuinely isn't determinable.

### 3. Write `index.html`

Start from `assets/template.html` (copy it in, replace the `{{TITLE}}` / `{{DATE}}` / `{{LEAD_PARAGRAPH}}` / `{{AUTHOR_OR_CONTEXT}}` placeholders, then build the body).

**Also copy `assets/comment-overlay.js` into the same directory** — the template references it as `./comment-overlay.js`. Without this file the page works but has no comment functionality, defeating the point.

The template already loads Tailwind + Alpine.js. To use Chart.js or Mermaid, uncomment the relevant `<script>` tag at the top of `template.html`.

**Read `references/libs.md` before writing interactive components.** It has the working recipes for Alpine state, Chart.js neutral palette, and Mermaid diagrams — not knowing them means you'll fall back to plain HTML and lose the value of this skill. It also covers the full-bleed slide-deck layout (`main.doc` + `cmt-full-bleed`) for viewport-wide decks (e.g. content built with `/slide-design`).

**Form follows content.** Don't impose a fixed template structure (calculator vs. dashboard vs. doc). Read the proposal and let the shape emerge:

- A pricing decision → comparison table + a small calculator the reader can plug numbers into
- A technical plan → sectioned doc + Mermaid flowchart + risk callouts
- A KPI / roadmap proposal → Chart.js bars/lines + Mermaid gantt
- A product idea → narrative paragraphs + a tabbed "what-if" exploration

Use callouts (`<div class="callout">…</div>`) sparingly for things you want the reader's eye to land on. Use tables for comparisons. Use Alpine for anything where the reader benefits from changing an input and seeing what shifts.

### 4. Deploy (or open locally as fallback)

If preflight passed:
```
scripts/deploy.sh <path-to-proposal-dir>
```
The script prints the URL to stdout (progress goes to stderr). Show that URL to the user prominently — that's the deliverable.

The Vercel project name is derived per working context (basename of the proposal dir's enclosing repo + `-preview`, sanitized to a Vercel-legal name), so every preview for the same repo lands in one tidy project. Each deploy produces a unique immutable URL. When you know your workspace / agent identity, you MAY set `PREVIEW_PROJECT=<workspace-or-agent-name>-preview` (e.g. `PREVIEW_PROJECT=mojo-preview`) before invoking `deploy.sh` — it is then used verbatim.

If the user chose "Just view locally" at preflight, skip deploy entirely:
```
open <path-to-proposal-dir>/index.html
```
The comment overlay works the same way over `file://` — they can still highlight + comment + export. Only the share-via-URL part is missing, which is fine if it's just self-review.

### 5. Wait for feedback (revise diff-style, never silently replace)

When the user comes back with pasted comment markdown (it looks like
`## comments on: …` followed by `### comment 1` blocks with `> quoted text`
and the user's note), revise the HTML **as a visible diff**, not a silent
rewrite — like a GitHub PR. **Read `references/revision-workflow.md` before
your first revision round.** tl;dr per round: flatten the previous round's
`<del>`/`<ins>` markup back to plain accepted content, apply this round's
changes wrapped in fresh `<del>`/`<ins>`, rewrite the `revision-log` callout
at the top of `<main>` to describe only this round, and never edit text in
place without the diff markup. Then redeploy — each redeploy is a new URL.

## The comment overlay (what the user sees)

The overlay behaves like margin annotations from Google Docs / Medium /
Substack: highlighting text shows a `+ comment` button → modal → the text
gets a persistent marker and a card appears in the right margin immediately
(no reload, no toast), saved in `localStorage` and re-anchored by
surrounding context. Desktop shows cascading margin notes next to the text
they annotate; mobile uses a bottom-center `+ comment` button and bottom
sheets. A floating `export comments (N)` button produces markdown blocks
with quoted context for pasting back to the agent. Revised pages default to
a GitHub-style diff view with a `Clean` / `Show edits` toggle.

**Read `references/comment-overlay-ux.md` before changing anything
overlay-related** (layout, export format, diff toggle, detached-comment
handling) — it's the full behavioral spec and skipping it risks a silent
regression.

## What not to do

- **Don't deploy without copying `comment-overlay.js`** alongside `index.html` — the page works but the comment feature silently dies.
- **Don't write a multi-file React project** — single `index.html` + the `comment-overlay.js` sidekick is the whole stack. If a proposal genuinely needs React + shadcn level complexity, fall back to a heavier multi-file builder skill if one is available and deploy its built HTML bundle via `deploy.sh`.
- **Don't pre-decide the layout before reading the content.** A "proposal" that's really a numbers-driven recommendation needs charts, not paragraphs; a "doc" that's really a flow needs a diagram, not prose.
- **Don't reuse `index.html` across unrelated proposals** — every preview should have its own immutable URL for the user to revisit.
- **Don't skip the flatten-then-diff cycle on revisions** (see `references/revision-workflow.md`) — accumulated diff markup or silent in-place edits both defeat the point of the revision view.

## Files in this skill

- `scripts/preflight.sh` — verifies Vercel CLI + auth (auto-invoked by deploy.sh; can be run standalone)
- `scripts/deploy.sh` — deploy a directory, print URL (runs preflight first)
- `scripts/config-helpers.sh` — solopreneur.json repo-key + layered read/write helpers (source before step 2's bash work)
- `assets/template.html` — base template with typography + CDN libs
- `assets/comment-overlay.js` — comment functionality + the diff/clean revision toggle (must be copied alongside `index.html`)
- `references/libs.md` — Alpine / Chart.js / Mermaid recipes — **read before writing interactive UI**
- `references/path-resolution.md` — full config schema + resolution flow behind step 2 — **read before writing that step's logic**
- `references/comment-overlay-ux.md` — full overlay UX spec — **read before changing overlay-related behavior**
- `references/revision-workflow.md` — full diff/flatten procedure behind step 5 — **read before your first revision round**
