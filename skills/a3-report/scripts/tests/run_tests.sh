#!/usr/bin/env bash
# run_tests.sh — Tests for gitlab-activity.sh
#
# 借用 ~/.claude/scripts/gitlab/tests/setup.sh 的 mock curl／assertion harness，
# 但被測腳本不在該目錄下，所以自己包一個 run_activity() 用絕對路徑呼叫。
#
# 已知限制：mock curl 對同一次測試只回傳單一份 JSON body，三段查詢
# （merged MR／closed issue／opened issue）共用同一份 fixture，所以 fixture
# 內每筆資料要同時帶 merged_at／closed_at／author／assignees／description
# 等欄位，才能讓三段的篩選條件都命中。

set -euo pipefail

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTIVITY_SCRIPT="$(cd "$TEST_DIR/../.." && pwd)/scripts/gitlab-activity.sh"

# shellcheck disable=SC1091
source "$HOME/.claude/scripts/gitlab/tests/setup.sh"

# gitlab-activity.sh 用 "$HOME/.claude/scripts/gitlab/_config.sh" 這條慣例路徑
# source _config.sh；測試會把 HOME 換成 FAKE_HOME，所以在 FAKE_HOME 底下補一個
# 指回真實 _config.sh 的 symlink，讓 source 找得到檔案，同時仍讀 FAKE_HOME 下的
# 假 .claude.json 當憑證。不會動到真正 ~/.claude 底下任何檔案。
# 注意：這裡故意不用 setup.sh 的 $SCRIPT_DIR——setup.sh 用 "$0" 推算自己的路徑，
# 但它是被 source 進來的，"$0" 這時候指的是本檔（run_tests.sh），不是 setup.sh
# 所在目錄，算出來的 $SCRIPT_DIR 會是本檔所在的 a3-report/scripts，不是
# ~/.claude/scripts/gitlab。改用真實（尚未被覆寫的）$HOME 直接組真正路徑。
REAL_GITLAB_SCRIPTS="$HOME/.claude/scripts/gitlab"
mkdir -p "$FAKE_HOME/.claude/scripts/gitlab"
ln -sf "$REAL_GITLAB_SCRIPTS/_config.sh" "$FAKE_HOME/.claude/scripts/gitlab/_config.sh"

# 完全沒 token 的獨立 HOME：另建一個目錄、同樣接好 _config.sh 的 symlink，
# 假 .claude.json 只給 GITLAB_API_URL、不給 token，驗證 _config.sh 會擋下來。
NO_TOKEN_HOME="$TEST_TMP/no-token-home"
mkdir -p "$NO_TOKEN_HOME/.claude/scripts/gitlab"
ln -sf "$REAL_GITLAB_SCRIPTS/_config.sh" "$NO_TOKEN_HOME/.claude/scripts/gitlab/_config.sh"
echo '{"mcpServers":{"gitLab":{"env":{"GITLAB_API_URL":"https://example.com/api/v4"}}}}' > "$NO_TOKEN_HOME/.claude.json"

# --- Helper: run gitlab-activity.sh with mocked environment ---
run_activity() {
  clear_curl_log
  HOME="$FAKE_HOME" PATH="$mock_curl_bin:$PATH" \
    bash "$ACTIVITY_SCRIPT" "$@" 2>"$TEST_TMP/stderr"
}

# 一份同時滿足三段查詢篩選條件的 fixture：
# - iid 10：merged_at／closed_at／updated_at 都落在區間內，author=alice，assignees=[alice]
# - iid 11：日期落在區間外（用來驗證日期篩選有作用）
# - iid 12：日期在區間內，但 author/assignee 是 bob（用來驗證 --author 篩選）
FIXTURE='[
  {
    "iid": 10,
    "title": "fix login | bug",
    "author": {"username": "alice"},
    "assignees": [{"username": "alice"}],
    "labels": ["bug", "frontend"],
    "merged_at": "2026-08-15T03:00:00Z",
    "closed_at": "2026-08-15T03:00:00Z",
    "updated_at": "2026-08-15T03:00:00Z",
    "web_url": "https://gitlab.example.com/group/project/-/merge_requests/10",
    "description": "fixes #101 and also #101, see #202"
  },
  {
    "iid": 11,
    "title": "out of range item",
    "author": {"username": "alice"},
    "assignees": [{"username": "alice"}],
    "labels": [],
    "merged_at": "2026-07-01T03:00:00Z",
    "closed_at": "2026-07-01T03:00:00Z",
    "updated_at": "2026-07-01T03:00:00Z",
    "web_url": "https://gitlab.example.com/group/project/-/merge_requests/11",
    "description": "no refs here"
  },
  {
    "iid": 12,
    "title": "bob item in range",
    "author": {"username": "bob"},
    "assignees": [{"username": "bob"}],
    "labels": ["chore"],
    "merged_at": "2026-08-20T03:00:00Z",
    "closed_at": "2026-08-20T03:00:00Z",
    "updated_at": "2026-08-20T03:00:00Z",
    "web_url": "https://gitlab.example.com/group/project/-/merge_requests/12",
    "description": "relates to #303"
  }
]'

HUNDRED_FIXTURE=$(jq -n '[range(100) | {
  iid: (.+1),
  title: "item",
  author: {"username": "alice"},
  assignees: [{"username": "alice"}],
  labels: [],
  merged_at: "2026-08-10T00:00:00Z",
  closed_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
  web_url: "https://gitlab.example.com/x",
  description: ""
}]')

echo "=== gitlab-activity.sh: missing token ==="
{
  set +e
  HOME="$NO_TOKEN_HOME" bash "$ACTIVITY_SCRIPT" "group/project" --since 2026-08-01 --until 2026-08-31 >/dev/null 2>"$TEST_TMP/stderr"
  code=$?
  set -e
  stderr=$(cat "$TEST_TMP/stderr")
  assert_contains "error on missing token" "GITLAB_PERSONAL_ACCESS_TOKEN not found" "$stderr"
  assert_exit_code "missing token exits non-zero" "1" "$code"
}

echo ""
echo "=== gitlab-activity.sh: argument validation ==="
{
  run_activity "group/project" --until 2026-08-31 >/dev/null 2>"$TEST_TMP/stderr" || true
  stderr=$(cat "$TEST_TMP/stderr")
  assert_contains "missing --since prints Usage" "Usage:" "$stderr"

  set +e
  run_activity "group/project" --until 2026-08-31 >/dev/null 2>"$TEST_TMP/stderr"
  code=$?
  set -e
  assert_exit_code "missing --since exits 1" "1" "$code"

  set +e
  run_activity "group/project" --since "2026/08/01" --until 2026-08-31 >/dev/null 2>"$TEST_TMP/stderr"
  code=$?
  set -e
  assert_exit_code "malformed --since date exits 1" "1" "$code"
  stderr=$(cat "$TEST_TMP/stderr")
  assert_contains "malformed date prints Usage" "Usage:" "$stderr"
}

echo ""
echo "=== gitlab-activity.sh: queries hit correct endpoints ==="
{
  set_curl_response "$FIXTURE" 200
  output=$(run_activity "group/project" --since 2026-08-01 --until 2026-08-31)
  calls=$(get_last_curl_call)
  assert_contains "queries merged state" "state=merged" "$calls"
  assert_contains "queries closed state" "state=closed" "$calls"
  assert_contains "queries opened state" "state=opened" "$calls"
  assert_contains "uses updated_after" "updated_after=" "$calls"
  assert_contains "uses per_page=100" "per_page=100" "$calls"
}

echo ""
echo "=== gitlab-activity.sh: date range filtering ==="
{
  # 注意：mock curl 不會真的依 query string（updated_after）篩選，一律回傳整份
  # fixture；所以只有 merged／closed 這兩段有 jq 端的日期範圍二次篩選可驗證。
  # open issues 那段依契約只靠 server 端 updated_after，不在 jq 端做日期篩選，
  # 所以在這個 mock 下三筆都會出現在「進行中的 issue」，屬預期行為，不在此驗證。
  set_curl_response "$FIXTURE" 200
  output=$(run_activity "group/project" --since 2026-08-01 --until 2026-08-31)
  merged_section=$(echo "$output" | awk '/^## 本期合併的 MR/{flag=1} /^## 本期關閉的 issue/{flag=0} flag')
  assert_contains "in-range merged MR iid 10 included" "!10" "$merged_section"
  assert_not_contains "out-of-range iid 11 excluded from merged section" "out of range item" "$merged_section"
}

echo ""
echo "=== gitlab-activity.sh: --author filtering ==="
{
  set_curl_response "$FIXTURE" 200
  output=$(run_activity "group/project" --since 2026-08-01 --until 2026-08-31 --author alice)
  assert_contains "alice's item kept" "fix login" "$output"
  assert_not_contains "bob's item filtered out" "bob item in range" "$output"
}

echo ""
echo "=== gitlab-activity.sh: --author me resolves via /user ==="
{
  # mock curl 對整個 process 只有一份回應，/user 拿到的物件之後也會被當成
  # merged/closed/open 三段的原始回應去跑 jq——物件不是陣列，.[] 疊代到純
  # 字串欄位時 jq 會噴型別錯誤、腳本提早結束，這裡只驗證 /user 端點真的被打，
  # 不驗證後續三段的輸出，所以用 set +e 吞掉那個提早結束的非 0 結束碼。
  set_curl_response '{"username":"alice"}' 200
  set +e
  run_activity "group/project" --since 2026-08-01 --until 2026-08-31 --author me >/dev/null
  set -e
  calls=$(get_last_curl_call)
  assert_contains "GET /user called to resolve 'me'" "/user" "$calls"
}

echo ""
echo "=== gitlab-activity.sh: referenced issues extraction ==="
{
  set_curl_response "$FIXTURE" 200
  output=$(run_activity "group/project" --since 2026-08-01 --until 2026-08-31)
  assert_contains "extracts #101" "#101" "$output"
  assert_contains "extracts #202" "#202" "$output"
}

echo ""
echo "=== gitlab-activity.sh: markdown output structure ==="
{
  set_curl_response "$FIXTURE" 200
  output=$(run_activity "group/project" --since 2026-08-01 --until 2026-08-31)
  assert_contains "has merged MR heading" "## 本期合併的 MR" "$output"
  assert_contains "has closed issue heading" "## 本期關閉的 issue" "$output"
  assert_contains "has open issue heading" "## 進行中的 issue" "$output"
  assert_contains "has project/period summary line" "期間：2026-08-01 ～ 2026-08-31" "$output"
  assert_contains "MR row uses ! prefix" "!10" "$output"
  assert_contains "issue row uses # prefix" "#10" "$output"
  assert_contains "title pipe is escaped" "fix login \\| bug" "$output"
}

echo ""
echo "=== gitlab-activity.sh: empty section renders （無） ==="
{
  set_curl_response "$FIXTURE" 200
  output=$(run_activity "group/project" --since 2026-01-01 --until 2026-01-31)
  assert_contains "empty range shows （無）" "（無）" "$output"
}

echo ""
echo "=== gitlab-activity.sh: --json output ==="
{
  set_curl_response "$FIXTURE" 200
  output=$(run_activity "group/project" --since 2026-08-01 --until 2026-08-31 --json)
  assert_equals "valid JSON" "valid" "$(echo "$output" | jq empty >/dev/null 2>&1 && echo valid || echo invalid)"
  assert_contains "json has merged_mrs key" "merged_mrs" "$output"
  assert_contains "json has closed_issues key" "closed_issues" "$output"
  assert_contains "json has open_issues key" "open_issues" "$output"
  count=$(echo "$output" | jq '.merged_mrs | length')
  assert_equals "merged_mrs has 2 in-range entries" "2" "$count"
}

echo ""
echo "=== gitlab-activity.sh: 100-count warning ==="
{
  set_curl_response "$HUNDRED_FIXTURE" 200
  run_activity "group/project" --since 2026-08-01 --until 2026-08-31 >/dev/null
  stderr=$(get_stderr)
  assert_contains "warns when a section returns exactly 100" "可能超過 100 筆，未翻頁" "$stderr"
}

echo ""
echo "=== gitlab-activity.sh: API failure propagates ==="
{
  set_curl_response '{"message":"401 Unauthorized"}' 401
  set +e
  run_activity "group/project" --since 2026-08-01 --until 2026-08-31 >/dev/null
  code=$?
  set -e
  assert_exit_code "API failure exits 1" "1" "$code"
  stderr=$(get_stderr)
  assert_contains "stderr keeps gitlab_api error message" "ERROR (HTTP 401)" "$stderr"
}

print_summary
