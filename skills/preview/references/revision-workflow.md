# Revision workflow — diff-style, never silent replace

Full procedure behind SKILL.md step 5 ("Wait for feedback"). Read this before revising a page from pasted comment markdown — skipping a step here produces a page where the reader can't tell what changed.

When the user comes back with pasted comment markdown (it looks like
`## comments on: …` followed by `### comment 1` blocks with `> quoted text`
and the user's note), revise the HTML **as a visible diff**, not a silent
rewrite. The reader should see exactly how their feedback was applied — like
a GitHub PR. Do this every revision round:

1. **Flatten the previous round first (per-round reset).** Before applying
   this round's edits, remove the prior round's diff markup so the page
   represents the last-reviewed accepted state with no diff:
   - Delete every existing `<del>…</del>` node entirely (that text was
     rejected last round — it's gone now).
   - Unwrap every `<ins>…</ins>` (keep the inner text, drop the tags — that
     text was accepted last round, it's now just normal content).
   The diff always means "changes since your last review", never a
   cumulative pile-up across rounds.
2. **Apply this round's changes as diff.** For each change driven by a
   comment: wrap the removed text in `<del>…</del>` (leave it in place,
   struck through — do not delete it) and the new/changed text in
   `<ins>…</ins>`. Reordering counts: `<del>` the old position, `<ins>` the
   new one.
3. **Refresh the revision changelog at the top.** Maintain a single
   `<div class="callout revision-log">…</div>` near the top of `<main>`
   (just after the lead paragraph). Each round, rewrite it with a heading
   like `revision N — changes from review` and a short list of what changed
   this round and which comment each item addresses. Replace it wholesale
   each round (it describes only the current round, matching the per-round
   diff).
4. **Never silently replace content on a revision.** Every post-feedback
   content change goes through the `<del>` / `<ins>` mechanism. Do not edit
   text in place without wrapping it — the reader must be able to see
   exactly what moved.
5. **The reader can toggle to a clean view.** The comment overlay shows a
   `Clean` / `Show edits` button (added by `comment-overlay.js`); the page
   **defaults to showing the diff** on load. You don't need to do anything
   for this — just produce correct `<del>` / `<ins>` markup and the toggle
   + CSS gate handle the rest.

Then redeploy. Each redeploy is a new URL — share the new one. The
`revision-log` callout (not a free-floating note) is where you summarize
what changed.
