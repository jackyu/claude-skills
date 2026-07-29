# mr-context.sh 用法

供 `fe-mr-review`、`fe-mr-digest`、`fe-mr-walkthrough` 共用。

## 指令

```bash
~/.claude/skills/_shared/fe-mr-common/scripts/mr-context.sh <project_path> <mr_iid>
```

一次取得：MR 基本資訊（標題、描述、來源/目標分支、作者、labels）＋未解決討論串＋changed files＋diff。

## 選項

- `--all-discussions`：預設只列「未解決」討論；需要已解決討論（如學習筆記類用途）時加此旗標一併列出。

## 大型 MR 與補抓

- 若 diff 過大，`mr-context.sh` 會自動降級為 stat 預覽（只列檔名與增刪行數，不含實際內容）。
- 需要特定檔案的完整內容 → 用 `mr-load-file.sh` 補抓。
- 需要討論串的完整內容（含 follow-up notes）→ 用 `mr-load-discussion.sh` 補抓。
- description 提到關聯 Issue 時，用 `issue-get.sh <issue_url>` 取得需求背景。

## 若本地分支不存在

需要更完整的 diff context（例如超出 GitLab API per-file diff 範圍的周邊邏輯）時，可改用本地 `git diff` 取得完整變更內容；本地分支不存在需先 `git fetch`。細節依各 skill 需求可能不同，見各 skill 自己的 SKILL.md。
