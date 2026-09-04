#!/usr/bin/env bash
# gitlab-activity.sh — 列出指定區間內某專案的 GitLab 活動：
#   本期合併的 MR、本期關閉的 issue、進行中（區間內有更新）的 issue。
#
# Usage:
#   gitlab-activity.sh <project_path_or_id> --since YYYY-MM-DD --until YYYY-MM-DD \
#       [--author <username>|me] [--json]
#
# 輸出：
#   預設：Markdown，固定三個 h2 段落（本期合併的 MR／本期關閉的 issue／進行中的
#         issue），每段一個表格，欄位為 iid｜title｜author｜labels｜日期｜web_url｜
#         引用的 issue。空段落印「（無）」。
#   --json：{ project, since, until, author, merged_mrs[], closed_issues[],
#            open_issues[] }，每筆含 iid／title／author／labels／date／web_url／
#            referenced_issues。
#
# 注意：
#   - 日期區間由呼叫端算好傳入，本腳本只驗證格式（YYYY-MM-DD），不做日期運算。
#   - 純打 API，不會 git fetch。
#   - 每段查詢固定 per_page=100、不翻頁；剛好打滿 100 筆會在 stderr 印警告。

set -euo pipefail

# ─── Args ────────────────────────────────────────────────────────────────────
# 先驗參數格式，缺欄位或格式錯直接印 Usage、exit 1；驗完才 source _config.sh，
# 避免憑證缺失的錯誤蓋掉單純打錯參數的情況。

usage() {
  cat >&2 <<EOF
Usage: $0 <project_path_or_id> --since YYYY-MM-DD --until YYYY-MM-DD [--author <username>|me] [--json]

Examples:
  $0 group/project --since 2026-08-01 --until 2026-08-31
  $0 group/project --since 2026-08-01 --until 2026-08-31 --author me
  $0 group/project --since 2026-08-01 --until 2026-08-31 --json
EOF
  exit 1
}

if [[ $# -lt 1 || "$1" == --* ]]; then
  usage
fi

PROJECT_RAW="$1"
shift

SINCE=""
UNTIL=""
AUTHOR=""
JSON_OUTPUT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)
      SINCE="${2:-}"
      shift 2
      ;;
    --until)
      UNTIL="${2:-}"
      shift 2
      ;;
    --author)
      AUTHOR="${2:-}"
      shift 2
      ;;
    --json)
      JSON_OUTPUT=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done

DATE_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

if [[ -z "$SINCE" || -z "$UNTIL" ]]; then
  usage
fi

if [[ ! "$SINCE" =~ $DATE_RE || ! "$UNTIL" =~ $DATE_RE ]]; then
  echo "ERROR: --since/--until must be in YYYY-MM-DD format" >&2
  usage
fi

source "$HOME/.claude/scripts/gitlab/_config.sh"

PROJECT=$(encode_project "$PROJECT_RAW")

if [[ "$AUTHOR" == "me" ]]; then
  AUTHOR=$(gitlab_api GET "/user" | jq -r '.username')
fi

# ─── Fetch ───────────────────────────────────────────────────────────────────
# 三段查詢固定 per_page=100，只用 updated_after 縮小範圍，實際區間篩選交給 jq。

SINCE_TS="${SINCE}T00:00:00Z"

MERGED_RAW=$(gitlab_api GET "/projects/$PROJECT/merge_requests?state=merged&updated_after=$SINCE_TS&per_page=100")
CLOSED_RAW=$(gitlab_api GET "/projects/$PROJECT/issues?state=closed&updated_after=$SINCE_TS&per_page=100")
OPEN_RAW=$(gitlab_api GET "/projects/$PROJECT/issues?state=opened&updated_after=$SINCE_TS&per_page=100")

warn_if_full_page() {
  local label="$1" raw="$2" count
  count=$(jq 'length' <<< "$raw")
  if [[ "$count" -eq 100 ]]; then
    echo "警告：${label} 回應剛好 100 筆，可能超過 100 筆，未翻頁" >&2
  fi
}

warn_if_full_page "merged MR" "$MERGED_RAW"
warn_if_full_page "closed issue" "$CLOSED_RAW"
warn_if_full_page "opened issue" "$OPEN_RAW"

# ─── Filter + normalize ─────────────────────────────────────────────────────
# 三段各自產出正規化後的陣列：iid／title／author／labels／date／web_url／
# referenced_issues（從 description 抓 #N，去重）。

NORMALIZE_COMMON='
  {
    iid,
    title,
    author: (.author.username // .author.name // "unknown"),
    labels: ((.labels // []) | join(", ")),
    web_url,
    referenced_issues: ((.description // "") | [scan("#[0-9]+")] | unique)
  }
'

MERGED_JQ='
  [ .[] | select((.merged_at // "")[0:10] as $d | $d != "" and $d >= $since and $d <= $until) ]
  | (if $author != "" then map(select(.author.username == $author)) else . end)
  | map('"$NORMALIZE_COMMON"' + { date: (.merged_at[0:10]) })
'

CLOSED_JQ='
  [ .[] | select((.closed_at // "")[0:10] as $d | $d != "" and $d >= $since and $d <= $until) ]
  | (if $author != "" then map(select([(.assignees // [])[]?.username] | index($author) != null)) else . end)
  | map('"$NORMALIZE_COMMON"' + { date: (.closed_at[0:10]) })
'

OPEN_JQ='
  (if $author != "" then map(select([(.assignees // [])[]?.username] | index($author) != null)) else . end)
  | map('"$NORMALIZE_COMMON"' + { date: ((.updated_at // "")[0:10]) })
'

MERGED_NORM=$(jq --arg since "$SINCE" --arg until "$UNTIL" --arg author "$AUTHOR" "$MERGED_JQ" <<< "$MERGED_RAW")
CLOSED_NORM=$(jq --arg since "$SINCE" --arg until "$UNTIL" --arg author "$AUTHOR" "$CLOSED_JQ" <<< "$CLOSED_RAW")
OPEN_NORM=$(jq --arg since "$SINCE" --arg until "$UNTIL" --arg author "$AUTHOR" "$OPEN_JQ" <<< "$OPEN_RAW")

# ─── Output ──────────────────────────────────────────────────────────────────

if [[ "$JSON_OUTPUT" -eq 1 ]]; then
  jq -n \
    --arg project "$PROJECT_RAW" \
    --arg since "$SINCE" \
    --arg until "$UNTIL" \
    --arg author "$AUTHOR" \
    --argjson merged "$MERGED_NORM" \
    --argjson closed "$CLOSED_NORM" \
    --argjson open "$OPEN_NORM" \
    '{
      project: $project,
      since: $since,
      until: $until,
      author: $author,
      merged_mrs: $merged,
      closed_issues: $closed,
      open_issues: $open
    }'
  exit 0
fi

AUTHOR_DISPLAY="${AUTHOR:-全部}"
echo "> 專案：${PROJECT_RAW}｜期間：${SINCE} ～ ${UNTIL}｜篩選：${AUTHOR_DISPLAY}"
echo ""

render_section() {
  local heading="$1" data="$2" prefix="$3" count
  echo "## $heading"
  echo ""
  count=$(jq 'length' <<< "$data")
  if [[ "$count" -eq 0 ]]; then
    echo "（無）"
    echo ""
    return
  fi
  echo "| iid | title | author | labels | 日期 | web_url | 引用的 issue |"
  echo "|---|---|---|---|---|---|---|"
  jq -r --arg prefix "$prefix" '
    .[] | [
      ($prefix + (.iid | tostring)),
      (.title | gsub("\\|"; "\\|")),
      .author,
      .labels,
      .date,
      .web_url,
      (.referenced_issues | join("、"))
    ] | "| " + join(" | ") + " |"
  ' <<< "$data"
  echo ""
}

render_section "本期合併的 MR" "$MERGED_NORM" "!"
render_section "本期關閉的 issue" "$CLOSED_NORM" "#"
render_section "進行中的 issue" "$OPEN_NORM" "#"
