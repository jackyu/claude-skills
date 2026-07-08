#!/usr/bin/env bash
# issue-get.sh — Fetch a GitLab issue (meta + description) as a compact
#                markdown blob for LLM consumption.
#
# Usage:
#   issue-get.sh <project_path_or_id> <issue_iid>
#   issue-get.sh <issue_url>
#
# Output: Markdown (stdout). Errors to stderr.

set -euo pipefail

source "$HOME/.claude/scripts/gitlab/_config.sh"

# ─── Args ────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
Usage: $0 <project_path_or_id> <issue_iid>
       $0 <issue_url>

Examples:
  $0 group/project 42
  $0 https://git.example.com/group/project/-/issues/42
EOF
  exit 1
}

if [[ $# -eq 1 && "$1" == http*://*/-/issues/* ]]; then
  # Parse project path and iid from issue URL
  path_part="${1#http*://*/}"                 # strip scheme + host
  PROJECT_RAW="${path_part%%/-/issues/*}"
  ISSUE_IID="${path_part##*/-/issues/}"
  ISSUE_IID="${ISSUE_IID%%[?#/]*}"            # strip query/fragment/trailing
elif [[ $# -eq 2 ]]; then
  PROJECT_RAW="$1"
  ISSUE_IID="$2"
else
  usage
fi

if [[ ! "$ISSUE_IID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: invalid issue iid: $ISSUE_IID" >&2
  exit 1
fi

PROJECT=$(encode_project "$PROJECT_RAW")

# ─── Fetch issue ─────────────────────────────────────────────────────────────

issue_json=$(gitlab_api GET "/projects/$PROJECT/issues/$ISSUE_IID")

issue_title=$(jq -r '.title' <<< "$issue_json")
issue_state=$(jq -r '.state' <<< "$issue_json")
issue_author=$(jq -r '.author.username // .author.name // "unknown"' <<< "$issue_json")
issue_url=$(jq -r '.web_url' <<< "$issue_json")
issue_labels=$(jq -r '.labels | join(", ")' <<< "$issue_json")
issue_milestone=$(jq -r '.milestone.title // ""' <<< "$issue_json")
issue_assignees=$(jq -r '[.assignees[]? | .username // .name] | join(", ")' <<< "$issue_json")
issue_desc=$(jq -r '.description // ""' <<< "$issue_json")

# ─── Render ──────────────────────────────────────────────────────────────────

echo "# Issue Context: #$ISSUE_IID — $issue_title"
echo ""
echo "| Field | Value |"
echo "|-------|-------|"
echo "| URL | $issue_url |"
echo "| State | $issue_state |"
echo "| Author | $issue_author |"
echo "| Assignees | ${issue_assignees:-—} |"
echo "| Labels | ${issue_labels:-—} |"
echo "| Milestone | ${issue_milestone:-—} |"
echo ""

if [[ -n "$issue_desc" ]]; then
  echo "## Description"
  echo ""
  echo "$issue_desc"
else
  echo "_(no description)_"
fi
