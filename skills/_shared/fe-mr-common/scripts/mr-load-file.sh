#!/usr/bin/env bash
# mr-load-file.sh — Load the diff of a single file in an MR.
#                    Used after mr-context.sh when MR exceeded the threshold
#                    and the AI needs to inspect specific files.
#
# Usage:
#   mr-load-file.sh <project_path_or_id> <mr_iid> <file_path>

set -euo pipefail

source "$HOME/.claude/scripts/gitlab/_config.sh"

if [[ $# -lt 3 ]]; then
  cat >&2 <<EOF
Usage: $0 <project_path_or_id> <mr_iid> <file_path>

Example:
  $0 group/project 277 src/lib/stream-reader.ts

Outputs the unified diff of the given file in this MR.
EOF
  exit 1
fi

PROJECT_RAW="$1"
MR_IID="$2"
FILE_PATH="$3"
PROJECT=$(encode_project "$PROJECT_RAW")

# Get source/target branches
mr_json=$(gitlab_api GET "/projects/$PROJECT/merge_requests/$MR_IID")
mr_source=$(jq -r '.source_branch' <<< "$mr_json")
mr_target=$(jq -r '.target_branch' <<< "$mr_json")

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: not inside a git repository" >&2
  exit 1
fi

# Auto-fetch branches if missing
for branch in "$mr_target" "$mr_source"; do
  if ! git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
    git fetch --quiet origin "$branch" || true
  fi
done

echo "# File Diff: $FILE_PATH (MR !$MR_IID)"
echo ""
echo "Branch: \`$mr_source\` → \`$mr_target\`"
echo ""
echo '```diff'
git diff "origin/$mr_target...origin/$mr_source" -- "$FILE_PATH" || {
  echo "(no diff — file may not be in this MR, or branches not fetchable)"
}
echo '```'
