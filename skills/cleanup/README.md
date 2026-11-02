# cleanup

> MR 合併後，刪掉這張票的 worktree 與本地分支，spec 和驗收清單歸檔

## Purpose

`/mission-finish` 之後的最後一步。確認分支上的東西都已經進了 target，才刪 worktree 與本地分支；把 spec、驗收清單、to-tickets 的票目錄搬進 `.claude/specs/archive/`，刪掉驗收證據目錄。

刪之前會先擋下這些情況：MR 還開著、合併後又 push 了沒進 target 的 commit、worktree 有未提交的變更、路徑不在專案的 worktrees 目錄底下、分支是預設分支、`rc/*` 或 `verify-baseline`。MR 只關閉沒合併、commit 也不在 target 時，會列出會消失的 commit，要使用者輸入 `discard` 才丟棄。

刪分支前會記下 tip SHA，並附上救回指令。Orca 管理的 worktree 用 `orca worktree rm`，而且一定是最後一個指令。

## When to Use

- 在功能 worktree 的 session 裡打 `/cleanup`，清掉自己（跑完視窗會關閉）
- 在主 checkout 打 `/cleanup <#issue 或分支名>`，清掉指定的 worktree

設成 `disable-model-invocation: true`，只能手打。不跑 retro、不開或改 MR，也不批次清理舊的 worktree。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | 流程：定位、檢查、丟棄路徑、確認清單、執行 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
