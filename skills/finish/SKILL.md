---
name: finish
description: 開發分支收尾流程——確認狀態後提供選項（開 MR／保留／丟棄／清理已合併分支），執行對應動作並清理 worktree。使用時機：(1) 用戶說功能做完了、分支開發完成, (2) 用戶要清理 worktree 或已合併的分支, (3) MR 已合併要收尾, (4) 用戶說要丟棄這個分支的工作, (5) /start 建立的 worktree 開發告一段落。即使用戶只是說「這個分支搞定了」「幫我收一下」也應觸發此 skill。
---

# 開發分支收尾

核心原則：確認狀態 → 判斷是否已合併 → 呈現選項 → 執行選擇 → 驗證結果。整合方式由使用者決定。

**不要把路徑存進 shell 變數留到後面的步驟用。** 流程中間隔著使用者回答菜單，harness 不保留 shell state，變數到下一步會是空字串，`git worktree remove ""` 就炸了。每次用到就當場重算。

## Workflow

### Step 1: 前置檢查與環境偵測

```bash
git branch --show-current
git status --porcelain
```

**依序**檢查，先分支後工作區；任一成立就停下來問，不擅自處理：

1. 分支為 `main`／`master`／`rc/*` → 中止，本流程只收尾功能分支。兩項同時成立時報這一項就好。
2. 有未 commit 變更 → 列出檔案，問要 commit、stash 還是取消。

判斷身處 worktree 或一般 repo。兩邊都要 `pwd -P` 絕對化——一般 repo 的 `--git-common-dir` 會回相對路徑 `.git`，不絕對化就比錯：

```bash
test "$(cd "$(git rev-parse --git-dir)" && pwd -P)" \
   = "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" \
  && echo "一般 repo" || echo "worktree"
```

### Step 2: 確認基底分支與合併狀態

基底判定優先序：

1. 分支 upstream，**但僅當它指向別的分支**。分支自己推上去後 upstream 會變成 `origin/<branch>`，拿它當基底等於自己比自己、必然誤判成已合併。用 `git config --get branch.<branch>.merge` 檢查，值等於 `refs/heads/<branch>` 就跳過這條。
2. 對話或 MR 指定的 target。
3. `git symbolic-ref refs/remotes/origin/HEAD`。

推不出來就問「此分支是從 `<推測>` 分出來的——對嗎？」，**不假設 main**。

```bash
git fetch --prune origin   # 必須 --prune；失敗就停下回報，不要當沒事往下走
git log --oneline "origin/<base>..HEAD"
git branch --merged "origin/<base>" --list "<branch>"
```

依序判定：

1. `origin/<base>..HEAD` 為空，或 `--merged` 有輸出 → **情境 B（已合併）**。
2. 否則先確認**此分支曾否 push**：`git config --get branch.<branch>.merge` 等於 `refs/heads/<branch>` 才算推過。**不可拿「有無 upstream」當判準**——`git worktree add -b <branch> origin/main` 會自動把 upstream 設成 `origin/main`，沒推過也有 upstream。沒推過 → 直接 **情境 A**，不查遠端。
3. 推過才跑 `git ls-remote --exit-code origin "<branch>"`，依 exit code 分流：
   - **2**（查無 ref）→ 遠端來源分支已於合併時被移除（MR 常設 `remove_source_branch`）→ **疑似 squash merge**，問使用者確認，不逕自判為未合併。
   - **0** → **情境 A（未合併）**。
   - **其他非零**（如 128，傳輸或認證失敗）→ 這不是判定結果，回報連線問題並停下，不要當成情境 A。

### Step 3: 呈現選項

菜單逐字呈現、不增不減，等使用者回答。

情境 A（未合併）：

```
1. 推送並建立 MR（worktree 保留供 review 迭代）
2. 保留現狀（稍後自行處理）
3. 丟棄此分支（需明確輸入 discard 確認）
```

情境 B（已合併）：

```
1. 清理：移除 worktree、刪除本地分支、git worktree prune
2. 保留現狀
```

### Step 4: 執行選擇

- **A1 開 MR**：委派 `/push`。品質閘（lint／type-check／test）由 `/push` 負責，**不在此重跑**；任一步失敗即停並如實回報，不繞過。留在原地，worktree 保留。
- **A2／B2 保留**：回報分支名與 worktree 路徑，不動任何東西。
- **A3 丟棄**：先列出將永久刪除的內容——分支名、commit 清單、worktree 路徑——要求使用者輸入 `discard`。收到後才走下面的清理。
- **B1 清理**：直接走下面的清理。

A3 與 B1 的清理順序，**順序承重、不可顛倒**，且**同一情境的各步必須在同一次 shell 呼叫內連續完成**。開頭「不跨步驟傳路徑變數」講的是不要跨使用者互動保存路徑，不是要把清理拆成好幾次呼叫——拆開跑正是半完成狀態的來源。

**worktree 情境**（四步）：

1. 現算主 repo 根目錄並 cd 過去（worktree 必須從它外面移除）：

```bash
cd "$(git -C "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)/.." rev-parse --show-toplevel)"
```

2. 依 Step 5 移除 worktree。
3. 刪本地分支：A3 用 `git branch -D "<branch>"`，B1 用 `git branch -d "<branch>"`。
4. `git worktree prune`。

**一般 repo 情境**（兩步；上面第 1、2、4 步不適用，沒有 worktree 可移除）：人正站在要刪的分支上，`branch -d`／`-D` 必定失敗，得先離開。

1. `git switch <base>`。
2. 刪本地分支：A3 用 `git branch -D "<branch>"`，B1 用 `git branch -d "<branch>"`。

`-d` 被拒時**不要說「沒真的合併」**：`-d` 比對的是分支 upstream，沒有就拿當前 HEAD（主 repo 本地基底）比，而本地基底常態落後 `origin`。貼出 git 原訊息與 Step 2 的證據，說明多半是基底過期，再問要不要改 `-D`——不自行升級。

### Step 5: worktree 清理邊界

只清理**相對 repo 根**位於 `.claude/worktrees/`、`.worktrees/`、`worktrees/` 之下的 worktree（`/start` 建在第一個）。比對路徑前綴，不是字串包含——`/tmp/worktrees/x` 不算。

移除時現算路徑，不要沿用先前步驟的變數。從 `git worktree list` 輸出中取 `[<branch>]` 標記與目標分支相符的那一列，用該列的絕對路徑：

```bash
git worktree list                  # 找 [<branch>] 相符的那列，取其絕對路徑
git worktree remove "<該列的絕對路徑>"
```

- **必須站在該 worktree 之外執行**（Step 4 第 1 步已 cd 到主 repo 根）。順序錯會落在「worktree 已刪、分支還在、後續指令全 fatal」的半完成狀態。
- 其他路徑 → 屬使用者手動管理，保留原位並告知，不代刪。
- 一般 repo → 無 worktree 可清，只處理分支（見 Step 4 的 `git switch`）。
- `remove` 失敗（多半有未追蹤檔案）→ 回報實際錯誤，**不加 `--force` 硬刪**。

### Step 6: 驗證與回報

```bash
git worktree list
git branch --list "<branch>"
```

兩者都不再出現該路徑與分支才算完成。**貼上實際輸出再宣告**，不憑沒報錯就斷言成功。

## Quick Reference

| 選項 | 推遠端 | 保留 worktree | 刪本地分支 |
|---|---|---|---|
| A1 開 MR | 是 | 是 | 否 |
| A2／B2 保留 | 否 | 是 | 否 |
| A3 丟棄（需 discard） | 否 | 否 | `-D` |
| B1 清理已合併 | 否 | 否 | `-d` |

## 紅線

| 藉口 | 實際 |
|---|---|
| 「看起來做完了，主動建議丟棄吧」 | 菜單照列即可，不加碼推薦；沒明確要求就不往丟棄引導 |
| 「『刪掉吧』『不要了』也算確認」 | 只有使用者親自輸入 `discard` 才授權刪除 |
| 「MR 已開，worktree 是雜物」 | review feedback 在那棵樹上修，合併後才清 |
| 「push 被拒，force-push 就好」 | 被拒代表遠端動過；先調查並問使用者，絕不 force-push |
| 「基底顯然是 main」 | 確認分歧點或直接問；收錯基底代價高 |
| 「這個 worktree 看起來也沒用，順手清掉」 | 只清上述三個路徑下的，其餘屬使用者手動管理 |
| 「有 upstream 就是推過了」 | `worktree add -b … origin/main` 也會設 upstream；看 `branch.<branch>.merge` |
| 「`ls-remote` 非 0 就當沒這分支」 | 只有 exit 2 是「查無 ref」；其餘非零是連線問題，停下回報 |
