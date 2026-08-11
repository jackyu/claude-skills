#!/usr/bin/env bash
# PreToolUse hook (matcher Bash) — commit 前擋兩件事：
#   1. 作者身份不對（避免用公司帳號簽到公開 repo）
#   2. 待提交內容或 commit message 出現敏感詞
#
# 這支腳本進版控，但它讀的兩項設定都留在本地、不進版控：
#   - 敏感詞清單：.claude/commit-denylist.txt（範本見 commit-denylist.example.txt）
#   - 允許的作者信箱：git config commitguard.email <你的信箱>
#
# 沒設定就不會擋，所以 clone 下來不會卡住任何人；要啟用照 .claude/README.md 做兩步設定。
#
# 設計取捨：
#   - 非 git commit 指令一律放行（fast path，不進 python）
#   - denylist 檔案「不存在」→ 放行，但每次都印警告：clone 後還沒設定是正常狀態，
#     不該卡死；印警告是為了讓「以為有防護但其實沒有」這件事無所遁形
#   - denylist 檔案「存在但讀不到」→ 保守擋下（fail-closed）：設定壞掉不等於沒設定
#   - commitguard.email 沒設 → 跳過身份檢查（同上，沒設定就不管）
#   - 其他非預期錯誤 → 放行（fail-open）：不讓 hook 本身的 bug 癱瘓整個 session
#   - 只掃「這次要提交的東西」（staged diff + message），不掃整個工作區，避免無關檔案誤報
set -euo pipefail

input="$(cat)"

# Fast path：完全沒提到 git commit 就不用往下走
if ! printf '%s' "$input" | grep -qE 'git[^|;&]*commit'; then
  exit 0
fi

printf '%s' "$input" | python3 -c '
import sys, json, re, subprocess, os

DENYLIST_PATH = os.path.join(os.getcwd(), ".claude", "commit-denylist.txt")
EXAMPLE_PATH = os.path.join(os.getcwd(), ".claude", "commit-denylist.example.txt")

def allow():
    sys.exit(0)

def deny(reason):
    out = {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                  "permissionDecision": "deny",
                                  "permissionDecisionReason": reason}}
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)

def warn(msg):
    print(msg, file=sys.stderr)

def run(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return ""

def main():
    data = json.load(sys.stdin)
    cmd = data.get("tool_input", {}).get("command", "")
    if not re.search(r"git[^|;&]*\bcommit\b", cmd):
        allow()

    # --- 1. 身份檢查（沒設 commitguard.email 就跳過）---
    required = run(["git", "config", "commitguard.email"]).strip()
    if required:
        m = re.search(r"-c\s+user\.email=([^\s\"\047]+)", cmd)
        email = m.group(1) if m else run(["git", "config", "user.email"]).strip()
        if email != required:
            deny("commit 被擋：作者信箱是 \"{}\"，本 repo 規定必須是 {}。\n"
                 "修正：git config user.email {}\n"
                 "（這條規則來自 git config commitguard.email，改它就能換規定）"
                 .format(email or "(未設定)", required, required))

    # --- 2. 敏感詞檢查 ---
    if not os.path.exists(DENYLIST_PATH):
        hint = ""
        if os.path.exists(EXAMPLE_PATH):
            hint = ("\n  啟用方式：cp .claude/commit-denylist.example.txt "
                    ".claude/commit-denylist.txt 後填入要擋的詞")
        warn("[commit-guard] 找不到 .claude/commit-denylist.txt，"
             "敏感詞檢查未啟用（身份檢查不受影響）。" + hint)
        allow()

    try:
        with open(DENYLIST_PATH, encoding="utf-8") as f:
            terms = [ln.strip() for ln in f
                     if ln.strip() and not ln.lstrip().startswith("#")]
    except Exception as e:
        deny("commit 被擋：敏感詞清單存在卻讀不到（{}），保守拒絕。\n"
             "檔案：{}\n修好權限或編碼後再試。".format(e.__class__.__name__, DENYLIST_PATH))

    if not terms:
        warn("[commit-guard] .claude/commit-denylist.txt 沒有任何有效詞，敏感詞檢查形同關閉。")
        allow()

    # 掃描範圍：staged diff（含新增檔案內容）+ 指令本身（commit message 就在裡面）
    haystacks = [("commit 指令 / message", cmd),
                 ("staged 變更", run(["git", "diff", "--cached"]))]
    if "-a" in cmd.split() or "--all" in cmd:
        haystacks.append(("未 staged 但會被 -a 帶入的變更", run(["git", "diff"])))

    hits = []
    for label, text in haystacks:
        low = text.lower()
        for t in terms:
            if t.lower() in low:
                hits.append((t, label))

    if hits:
        seen, lines = set(), []
        for term, label in hits:
            key = (term, label)
            if key in seen:
                continue
            seen.add(key)
            lines.append("  - \"{}\" 出現在{}".format(term, label))
        deny("commit 被擋：待提交內容含敏感詞（本 repo 會公開到 GitHub）。\n"
             + "\n".join(lines)
             + "\n\n處理方式：把這些詞改寫成泛用描述後再 commit。"
               "\n若某個詞其實不敏感，從 .claude/commit-denylist.txt 移除。")

    allow()

try:
    main()
except SystemExit:
    raise
except Exception:
    sys.exit(0)  # 非預期錯誤放行，不讓 hook 癱瘓 session
'
exit 0
