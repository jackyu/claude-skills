# The comment overlay — full UX spec

This is what the user actually experiences when `comment-overlay.js` is loaded on a preview page. Read it before touching anything overlay-related (layout, export format, diff toggle) so you don't regress behavior that isn't visible from the code alone.

The overlay behaves like margin annotations the reviewer already knows
from Google Docs / Medium / Substack: a comment leaves a **visible mark**
on the text and a card sits in the right gutter next to the text it
annotates — revisitable, editable, deletable, not a fire-and-forget
toast.

- They highlight any text on the page → a `+ comment` button appears
- They tap/click it → a modal asks for their note
- They submit → the highlighted text gets a persistent yellow **marker**
  (`<mark class="cmt-mark">`) and a card appears in the margin
  **immediately, with no reload**. The marker *is* the confirmation —
  there is no transient "comment added" toast. The comment is saved in
  `localStorage` (survives reload during the review session) and is
  re-anchored to the same text on every reload by its surrounding context,
  so it survives Alpine re-renders and the diff/clean toggle.
- **Desktop (≥1024px):** comments render as **margin notes** in a
  transparent right gutter — each card floats near the text it annotates,
  not collected in a separate panel. There is no panel chrome (no border,
  no `Comments` title, no scrolling list, no footer bar). Cards stack
  top→bottom in marker order; when two markers are close the lower card is
  pushed down so cards never overlap (cascading). The reading column only
  reserves the gutter once at least one comment exists — a zero-comment
  first draft renders **full-width**. Each card shows, top to bottom: the
  quoted snippet, a **relative timestamp** (`now` / `5m ago` / `3h ago` /
  dated for older), the comment body, and `Edit` / `Delete`. No name, no
  avatar. Clicking a marker scrolls the page to it and flashes its card;
  clicking a card scrolls the page to its marker and flashes it. Plain
  scrolling moves the cards with the text (no recompute). The `export`
  button and the `Clean` / `Show edits` toggle live in a floating
  bottom-right cluster.
- **Mobile (<1024px):** comment **creation now works** — selecting text
  arms a fixed `+ comment` button parked at bottom-center (above the
  cluster, not next to the selection, so it doesn't fight the OS selection
  callout). Tapping it opens the same modal. Viewing is unchanged: tapping
  a marker opens a bottom sheet with that one comment (edit / delete), and
  a floating `comments (N)` button opens a full-list bottom sheet.
- If a comment's anchor text can no longer be found on the page (it was
  edited away, or it's older data with no anchor), the comment is **not
  lost** — it still shows as a card marked *detached*, stacked after the
  anchored cards at the bottom of the gutter; it just can't scroll to a
  marker.
- A floating `export comments (N)` button shows the count. Clicking it
  opens an export modal with the full markdown in an editable textarea,
  plus three buttons: Copy / Close / Clear. Nothing auto-clears — the user
  can reopen, recopy, or edit-before-copy as needed. The exported markdown
  format: `## comments on: <title>`, the URL, `exported: <iso>`, then
  `### comment N` / `> quote` / blank / comment / blank blocks. The
  `> quote` includes the surrounding context (~32 chars on each side)
  captured at selection time, with the actually-selected span wrapped in
  bold (`**`) and outer `…` marking that the context was truncated by
  the window — this lets you locate which occurrence the reader meant
  when the selected text repeats on the page. Older v1 comments (no
  captured anchor) fall back to the bare quote.
- On a revised page (one that contains `<del>` / `<ins>` diff markup) a
  `Clean` / `Show edits` toggle appears. It toggles between the GitHub-diff
  view (removed text struck through, added text highlighted) and a clean
  rendered view. **The page defaults to the diff view** so the reader
  immediately sees how their feedback was applied. The choice persists in
  `localStorage` for the review session. Markers coexist with diff markup —
  the toggle still works on a page that has both. On a first-draft page (no
  diff markup yet) this toggle is hidden.

Their workflow is: open URL, skim, highlight problem spots while reading
(each becomes a visible marker + panel card they can revisit and edit),
click export, edit if needed, click Copy, paste back. On a revision they
land on the diff, see exactly what changed, and can flip to `Clean` to
read the clean result. Yours is to act on each `> quote` + comment pair.
