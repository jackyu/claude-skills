#!/usr/bin/env bash
# mr-load-discussion.sh — Load the full thread of a single discussion in an MR,
#                         including all notes (not just the first), with author,
#                         body, file position, and resolved state.
#
# Usage:
#   mr-load-discussion.sh <project_path_or_id> <mr_iid> <discussion_id>

set -euo pipefail

source "$HOME/.claude/scripts/gitlab/_config.sh"

if [[ $# -lt 3 ]]; then
  cat >&2 <<EOF
Usage: $0 <project_path_or_id> <mr_iid> <discussion_id>

Example:
  $0 group/project 277 abc123def456...

Outputs the full discussion thread as markdown.
EOF
  exit 1
fi

PROJECT_RAW="$1"
MR_IID="$2"
DISCUSSION_ID="$3"
PROJECT=$(encode_project "$PROJECT_RAW")

discussion_json=$(gitlab_api GET "/projects/$PROJECT/merge_requests/$MR_IID/discussions/$DISCUSSION_ID")

first_note=$(jq -r '.notes[0]' <<< "$discussion_json")
file_path=$(jq -r '.position.new_path // .position.old_path // ""' <<< "$first_note")
line=$(jq -r '.position.new_line // .position.old_line // ""' <<< "$first_note")

echo "# Discussion $DISCUSSION_ID (MR !$MR_IID)"
echo ""
if [[ -n "$file_path" ]]; then
  echo "**Location:** \`$file_path\`$(if [[ -n "$line" ]]; then echo ":$line"; fi)"
  echo ""
fi

jq -r '
  .notes
  | to_entries[]
  | "## Note " + ((.key + 1) | tostring) + " — " + (.value.author.username // .value.author.name // "?")
    + "\n*" + .value.created_at + (if .value.resolved then " · resolved" else "" end) + "*\n\n"
    + .value.body
    + "\n"
' <<< "$discussion_json"
