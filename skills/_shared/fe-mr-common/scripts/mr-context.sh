#!/usr/bin/env bash
# mr-context.sh — Aggregate MR context (meta + unresolved discussions + changed files + diff)
#                 into a single compact markdown blob for LLM consumption.
#
# Usage:
#   mr-context.sh <project_path_or_id> <mr_iid> [--minimal] [--threshold N] [--all-discussions]
#
# Output: Markdown (stdout). Errors to stderr.
#
# Modes:
#   default  — Auto: full diff if <= threshold lines, else stat-only preview.
#   --minimal — Force stat-only (use mr-load-file.sh for per-file diff).
#   --all-discussions — Also list resolved discussions (for digest / learning extraction).
#
# Threshold default: 500 lines (added + removed).

set -euo pipefail

source "$HOME/.claude/scripts/gitlab/_config.sh"

# ─── Args ────────────────────────────────────────────────────────────────────

if [[ $# -lt 2 ]]; then
  cat >&2 <<EOF
Usage: $0 <project_path_or_id> <mr_iid> [--minimal] [--threshold N] [--all-discussions]

Examples:
  $0 group/project 277
  $0 group/project 277 --minimal
  $0 group/project 277 --threshold 1000
  $0 group/project 277 --all-discussions

Outputs markdown context with: MR meta, unresolved discussions, changed files,
and either full diff (<= threshold) or git diff --stat preview (> threshold).
EOF
  exit 1
fi

PROJECT_RAW="$1"
MR_IID="$2"
shift 2

MINIMAL=false
THRESHOLD=500
ALL_DISCUSSIONS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --minimal)   MINIMAL=true; shift ;;
    --threshold) THRESHOLD="${2:-500}"; shift 2 ;;
    --all-discussions) ALL_DISCUSSIONS=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PROJECT=$(encode_project "$PROJECT_RAW")

# ─── Fetch MR meta ───────────────────────────────────────────────────────────

mr_json=$(gitlab_api GET "/projects/$PROJECT/merge_requests/$MR_IID")

mr_title=$(jq -r '.title' <<< "$mr_json")
mr_state=$(jq -r '.state' <<< "$mr_json")
mr_source=$(jq -r '.source_branch' <<< "$mr_json")
mr_target=$(jq -r '.target_branch' <<< "$mr_json")
mr_author=$(jq -r '.author.username // .author.name // "unknown"' <<< "$mr_json")
mr_url=$(jq -r '.web_url' <<< "$mr_json")
mr_labels=$(jq -r '.labels | join(", ")' <<< "$mr_json")
mr_desc=$(jq -r '.description // ""' <<< "$mr_json")
mr_draft=$(jq -r '.draft // .work_in_progress // false' <<< "$mr_json")

# ─── Fetch discussions, filter to unresolved ─────────────────────────────────

discussions_json=$(gitlab_api GET "/projects/$PROJECT/merge_requests/$MR_IID/discussions?per_page=100")

unresolved_count=$(jq '[.[] | select(.notes[]?.resolvable == true and .notes[]?.resolved == false)] | length' <<< "$discussions_json")
total_discussions=$(jq 'length' <<< "$discussions_json")

unresolved_md=$(jq -r '
  [.[]
    | select(.notes[]?.resolvable == true and .notes[]?.resolved == false)
    | . as $d
    | $d.notes[0] as $first
    | {
        id: $d.id,
        author: ($first.author.username // $first.author.name // "?"),
        file: ($first.position.new_path // $first.position.old_path // null),
        line: ($first.position.new_line // $first.position.old_line // null),
        note_count: ($d.notes | length),
        body: $first.body
      }]
  | .[]
  | "- **\(.author)**" + (if .file then " on `\(.file)" + (if .line then ":\(.line)" else "" end) + "`" else "" end) + " (\(.note_count) note\(if .note_count > 1 then "s" else "" end), id=`\(.id)`)\n  > " + (.body | gsub("\n"; "\n  > ") | .[0:400])
' <<< "$discussions_json")

resolved_count=0
resolved_md=""
if $ALL_DISCUSSIONS; then
  resolved_count=$(jq '[.[] | select((.notes | map(select(.resolvable == true)) | length > 0) and (.notes | map(select(.resolvable == true and .resolved == false)) | length == 0))] | length' <<< "$discussions_json")
  resolved_md=$(jq -r '
    [.[]
      | select((.notes | map(select(.resolvable == true)) | length > 0) and (.notes | map(select(.resolvable == true and .resolved == false)) | length == 0))
      | . as $d
      | $d.notes[0] as $first
      | {
          id: $d.id,
          author: ($first.author.username // $first.author.name // "?"),
          resolver: ([$d.notes[] | select(.resolved_by != null)][0].resolved_by.username // "?"),
          file: ($first.position.new_path // $first.position.old_path // null),
          line: ($first.position.new_line // $first.position.old_line // null),
          note_count: ($d.notes | length),
          body: $first.body
        }]
    | .[]
    | "- **\(.author)**" + (if .file then " on `\(.file)" + (if .line then ":\(.line)" else "" end) + "`" else "" end) + " (\(.note_count) note\(if .note_count > 1 then "s" else "" end), resolved by \(.resolver), id=`\(.id)`)\n  > " + (.body | gsub("\n"; "\n  > ") | .[0:400])
  ' <<< "$discussions_json")
fi

# ─── Diff ────────────────────────────────────────────────────────────────────

# Always fetch the latest target & source so the merge-base — and therefore the
# three-dot diff scope — reflects the MR's real changes, not a stale local base.
# A stale local origin/<target> makes `target...source` include unrelated commits,
# inflating the stat to dozens of bogus files (observed: 45 files/982 lines for a
# 2-file MR). Falls back silently to existing refs when offline.
in_git=false
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  in_git=true
  git fetch --quiet origin "$mr_target" "$mr_source" 2>/dev/null || true
fi

diff_stat=""
diff_full=""
diff_lines=0
diff_files_count=0

if $in_git && git rev-parse --verify "origin/$mr_target" >/dev/null 2>&1 && git rev-parse --verify "origin/$mr_source" >/dev/null 2>&1; then
  diff_stat=$(git diff --stat "origin/$mr_target...origin/$mr_source" 2>/dev/null || echo "")
  diff_lines=$(git diff --numstat "origin/$mr_target...origin/$mr_source" 2>/dev/null | awk '{a+=$1; b+=$2} END {print (a+b)+0}')
  diff_files_count=$(git diff --name-only "origin/$mr_target...origin/$mr_source" 2>/dev/null | wc -l | tr -d ' ')
  if ! $MINIMAL && [[ "$diff_lines" -le "$THRESHOLD" ]]; then
    diff_full=$(git diff "origin/$mr_target...origin/$mr_source" 2>/dev/null || echo "")
  fi
else
  diff_stat="(unable to compute local diff — not in git repo or branches not fetchable)"
fi

# ─── Render ──────────────────────────────────────────────────────────────────

echo "# MR Context: !$MR_IID — $mr_title"
echo ""
echo "| Field | Value |"
echo "|-------|-------|"
echo "| URL | $mr_url |"
echo "| State | $mr_state$(if [[ "$mr_draft" == "true" ]]; then echo " (draft)"; fi) |"
echo "| Author | $mr_author |"
echo "| Branch | \`$mr_source\` → \`$mr_target\` |"
echo "| Labels | ${mr_labels:-—} |"
echo "| Changes | $diff_files_count files, $diff_lines lines |"
echo "| Discussions | $unresolved_count unresolved / $total_discussions total |"
echo ""

if [[ -n "$mr_desc" ]]; then
  echo "## Description"
  echo ""
  echo "$mr_desc" | head -40
  desc_lines=$(echo "$mr_desc" | wc -l | tr -d ' ')
  if [[ "$desc_lines" -gt 40 ]]; then
    echo ""
    echo "_(description truncated; $((desc_lines - 40)) more lines)_"
  fi
  echo ""
fi

if [[ "$unresolved_count" -gt 0 ]]; then
  echo "## Unresolved Discussions ($unresolved_count)"
  echo ""
  echo "$unresolved_md"
  echo ""
  echo "_Use \`mr-load-discussion.sh $PROJECT_RAW $MR_IID <id>\` to load full discussion thread._"
  echo ""
fi

if $ALL_DISCUSSIONS && [[ "$resolved_count" -gt 0 ]]; then
  echo "## Resolved Discussions ($resolved_count)"
  echo ""
  echo "$resolved_md"
  echo ""
  echo "_Use \`mr-load-discussion.sh $PROJECT_RAW $MR_IID <id>\` to load full discussion thread._"
  echo ""
fi

echo "## Changed Files"
echo ""
if [[ -n "$diff_stat" ]]; then
  echo '```'
  echo "$diff_stat"
  echo '```'
else
  echo "_(no diff stat available)_"
fi
echo ""

if [[ -n "$diff_full" ]]; then
  echo "## Diff (full, $diff_lines lines)"
  echo ""
  echo '```diff'
  echo "$diff_full"
  echo '```'
else
  if $MINIMAL; then
    echo "## Diff"
    echo ""
    echo "_(minimal mode — use \`mr-load-file.sh $PROJECT_RAW $MR_IID <path>\` to load specific files)_"
  elif [[ "$diff_lines" -gt "$THRESHOLD" ]]; then
    echo "## Diff"
    echo ""
    echo "_(diff exceeds threshold of $THRESHOLD lines — stat preview shown above. Use \`mr-load-file.sh $PROJECT_RAW $MR_IID <path>\` to load specific files.)_"
  fi
fi
