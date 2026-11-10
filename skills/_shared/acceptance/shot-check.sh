#!/usr/bin/env bash
# shot-check.sh — 截圖拍在舊 SHA 時，判斷能不能沿用到現在的 HEAD
#
# 用法（在功能分支的 worktree 跑）：
#   shot-check.sh <拍攝於的 SHA> <現在的 base，例 origin/main 或 MR 的 diff_refs.base_sha> [head，預設 HEAD]
#
# 分兩問印出來：
#   1. 分支自己改的檔：拍攝時與現在，分支自己的 +/- 行是否相同（same／CHANGED）
#      只比 +/- 行，rebase 帶進來的周圍 context 行不算差異
#   2. 截圖後才變、但分支沒改的檔：base 推進帶進來的，要人判斷在不在截圖頁的渲染路徑上
# exit：0＝第 1 問全 same；1＝有 CHANGED，要重拍；2＝參數或 git 錯誤
set -uo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "用法：shot-check.sh <拍攝於的 SHA> <現在的 base> [head]" >&2
  exit 2
fi
shot="$1"
nb="$2"
head=$(git rev-parse --verify -q "${3:-HEAD}^{commit}") || { echo "找不到 head：${3:-HEAD}" >&2; exit 2; }
git rev-parse --verify -q "$shot^{commit}" >/dev/null || { echo "找不到 commit：$shot" >&2; exit 2; }
git rev-parse --verify -q "$nb^{commit}" >/dev/null || { echo "找不到 base：$nb" >&2; exit 2; }
ob=$(git merge-base "$shot" "$nb") || { echo "算不出 $shot 跟 $nb 的分岔點" >&2; exit 2; }

own_lines() { git diff "$1" "$2" -- "$3" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '; }

echo "拍攝於 $(git rev-parse --short "$shot")｜HEAD $(git rev-parse --short "$head")｜拍攝時 base $(git rev-parse --short "$ob")｜現在 base $(git rev-parse --short "$nb")"
branch_files=$( { git diff --name-only "$ob" "$shot"; git diff --name-only "$nb...$head"; } | sort -u)

changed=0
echo "--- 1. 分支自己改的檔"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if diff -q <(own_lines "$ob" "$shot" "$f") <(own_lines "$nb" "$head" "$f") >/dev/null; then
    echo "same    $f"
  else
    echo "CHANGED $f"
    changed=1
  fi
done <<< "$branch_files"

echo "--- 2. 截圖後才變、但分支沒改的檔"
drift=$(comm -23 <(git diff --name-only "$shot" "$head" | sort) <(printf '%s\n' "$branch_files"))
if [ -n "$drift" ]; then printf '%s\n' "$drift"; else echo "（沒有）"; fi

exit "$changed"
