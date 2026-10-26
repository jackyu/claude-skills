---
name: cleanup
description: 刪除這張票的 worktree 與本地分支（MR 已合併、或 commit 已在 target 才刪；否則要使用者輸入 discard 丟棄），把 spec、驗收清單搬進 .claude/specs/archive/，刪除驗收證據目錄。是 /mission-finish 之後收尾的最後一步。worktree 內跑 /cleanup 清掉自己；主 checkout 跑 /cleanup <#issue 或分支名> 清掉指定的 worktree。使用者打 /cleanup 時使用。
disable-model-invocation: true
---

# cleanup：刪除已收尾的 worktree 與分支

接在 `/mission-finish` 之後：MR 合併後把這張票的 worktree、本地分支清掉，spec 與驗收清單歸檔，驗收證據刪除。不跑 retro（收尾階段已經跑過），也不開 MR、不改 MR 狀態。

**用法**：
- `/cleanup`　在功能 worktree 的 session 裡跑，清掉自己（跑完視窗會關閉）
- `/cleanup <#issue 或分支名>`　在主 checkout 跑，清掉指定的 worktree

**執行紀律**：git 指令一律帶 `-C <絕對路徑>`，不要 `cd` 進某個目錄後指望下一次 shell 呼叫還留在那裡——每次呼叫都是獨立的，cwd 不會跨呼叫保留。`glab` 需要在 repo 內才能解析 `:id`，寫成 `cd <main> && glab api ...` 包在同一次呼叫裡，不要分兩步。

## Step 1：定位（刪任何東西之前，先把路徑、分支、key、Orca 歸屬都定下來）

| 值 | 怎麼拿 |
|---|---|
| 主 checkout `<main>` | `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` |
| 分支 `<branch>` | worktree 模式：目前分支（`git -C <wt> branch --show-current`）；主 checkout 模式：見下 |
| worktree 路徑 `<wt>` | `git -C <main> worktree list` 裡 `[<branch>]` 對應的那一列，取絕對路徑 |

**主 checkout 模式解析分支**：參數是 `#<數字>` 或純數字（當作 RD 票號 `<key>`）→ 讀 `<main>/.claude/specs/acceptance-<key>.md` 的 meta JSON 取 `branch`；沒有這份清單就找 `<main>/.claude/specs/spec-<key>-*.md`，抓不到分支名就直接問使用者。其他參數 → 本身當分支名，比對 `git -C <main> worktree list`。

**`<key>` 的來源**（依序嘗試，有一個就停）：參數本身是 issue 號 → 直接用；否則找 `<main>/.claude/specs/acceptance-*.md` 裡 meta `branch` 等於 `<branch>` 的那份，key 取自檔名；都沒有就先留白，等 Step 2 查到 MR 後，從 MR 描述的 `Closes #N`／`Related to #N` 補。到 Step 4 列確認清單時 `<key>` 必須已經定案（定不出來就寫「找不到對應的 issue 編號，略過歸檔與刪證據」，Step 5 對應兩步跳過）。**用在檔案路徑之前**，`<key>` 必須符合 `^[a-z0-9-]+$`（純數字票號也符合這個規則；見 `_shared/acceptance/format.md`「檔案與 key」）——不符合就不要拿去拼路徑，當作沒找到 key。

**Orca 歸屬**（決定 Step 5 要不要用 `orca`，不是動手刪才檢查）：worktree 模式 `orca worktree current`；主 checkout 模式看 `<wt>` 是否出現在 `orca worktree list --json`。查不到 → worktree 模式最後停下請使用者改到主 checkout 跑 `/cleanup <分支>`；主 checkout 模式改用純 `git worktree remove`（Step 5 第 5 步會提到）。查得到就記住，Step 5 用 `orca worktree rm`。

**拒絕範圍**（符合任一就停，不往下做）：
- `<wt>` 的 realpath 不落在 `<main>` 的 realpath 之下的 `.claude/worktrees/`、`.worktrees/`、`worktrees/`——用加了結尾 `/` 的前綴比對，不要用字串包含（`/tmp/worktrees-foo` 不該被 `worktrees` 這個字串誤判通過）：
  ```bash
  case "$(cd "<wt>" && pwd -P)/" in
    "$(cd "<main>" && pwd -P)/.claude/worktrees/"*|"$(cd "<main>" && pwd -P)/.worktrees/"*|"$(cd "<main>" && pwd -P)/worktrees/"*) ok;;
    *) reject;;
  esac
  ```
- `<branch>` 是 `verify-baseline`——這是驗收用的基準 worktree，不屬於任何一張票
- `<branch>` 是預設分支（`git symbolic-ref --short refs/remotes/origin/HEAD` 去掉 `origin/`）或 `rc/*`

## Step 2：檢查（任一卡住就停下說明，不刪任何東西）

1. **決定查 MR 用的分支名**：`git -C <wt> rev-parse --abbrev-ref @{u}` 成功就取它、去掉 `origin/` 前綴，當查詢名；失敗（沒有 upstream）就用 `<branch>` 本身。
2. **MR 狀態**（唯讀）：
   ```bash
   cd <main> && glab api "projects/:id/merge_requests?source_branch=<查詢名>&state=all"
   ```
   - 任一筆是 `opened`（不論是否同時有 `merged`） → 停下：這個分支還有開著的 MR，等合併或先關閉
   - 沒有 `opened`、有一筆 `merged` → 正常路徑，記下該筆的 target 與 `sha`
   - 沒有 merged（只有 `closed`，或查無任何 MR）→ 先看 commit 是不是已經用別的方式進了 target（例：直接 push、別的分支帶進去）。target 取 closed MR 的 target，查無 MR 就用預設分支：
     ```bash
     git -C <wt> fetch origin
     git -C <wt> merge-base --is-ancestor HEAD "origin/<target>"
     ```
     成立 → 已整合路徑：不會丟掉任何 commit，跟正常路徑一樣往下做，不用輸入 `discard`
   - 不成立、有 `closed` → 丟棄路徑（Step 3）
   - 不成立、查無任何 MR：upstream 存在且去掉 `origin/` 後的短名 **不等於** `<branch>` → 停下，說明分支名跟遠端追蹤的名字不一樣、查詢可能查錯了，不進丟棄路徑；其餘情況 → 丟棄路徑
3. **正常路徑才做：證明分支上的東西沒有漏掉**——只比對 upstream 不夠，MR 合併之後還可能繼續 push：
   ```bash
   git -C <wt> fetch origin
   git -C <wt> merge-base --is-ancestor HEAD "origin/<target>"
   ```
   不成立就停下，說明分支上有 MR 合併之後才加的 commit，還沒進 `<target>`，請使用者確認這些 commit 要保留（另開 MR）還是要丟棄
4. **沒有未提交／未追蹤的變更**（每條路徑都查——worktree 整個目錄接下來會被刪掉）：
   ```bash
   git -C <wt> status --porcelain
   ```
   有輸出（ignore 的檔案不算）就停下，列出檔案，請使用者自己 commit 或清掉再重跑

## Step 3：丟棄路徑

只在 Step 2 判定「丟棄路徑」時才走。列出會永久消失的 commit，要求使用者輸入 `discard` 才繼續：

```bash
git -C <wt> log --oneline "<target 或 origin/<預設分支>>..HEAD"
```

查不到 MR、沒有明確 target 時改用 `origin/<預設分支>`。使用者沒有輸入 `discard` 就停在這裡，不做任何清理。

## Step 4：確認清單

一次列給使用者看，等明確答覆才往下做：worktree 路徑、分支名、`<key>`；MR 的 iid／狀態／target（已整合路徑寫「無 MR，commit 已在 origin/<target>」或「已關閉，commit 已在 origin/<target>」；丟棄路徑寫「無」或「已關閉未合併」）；要歸檔的檔案（`spec-<key>-*.md`、`acceptance-<key>.md`，`<key>` 沒定案就寫「略過歸檔」）；要刪除的證據目錄 `<main>/.claude/verify-evidence/<key>/`；分支的 tip SHA（`git -C <main> rev-parse <branch>`）和救回指令 `git -C <main> branch <branch> <sha>`；「刪完要確認，在主 checkout 打 `orca worktree list`」。worktree 模式額外加一句**確認之後會一路做到刪除，這個視窗會關閉，之後不會再有回報**——worktree 模式下這份清單就是最後的回報，rm 之後視窗馬上關掉，再發訊息也看不到。

## Step 5：執行

路徑每次當場重算，不要存進 shell 變數留到下一次呼叫才用。

1. **歸檔**：`mkdir -p "<main>/.claude/specs/archive"`，逐個搬 `spec-<key>-*.md`、`acceptance-<key>.md`；目的地已有同名檔就加日期後綴，不覆蓋。`<key>` 沒定案就跳過。
2. **刪證據**：`<main>/.claude/verify-evidence/<key>/`。先確認路徑恰好落在這個目錄下、`<key>` 非空且符合 `^[a-z0-9-]+$`，再 `rm -rf`。`<key>` 沒定案就跳過。
3. **記 SHA、刪分支**：`sha=$(git -C <main> rev-parse <branch>)`——**在刪分支之前**記下來，失敗救援用得到。
   - worktree 模式：`git -C <wt> switch --detach`（讓分支不再被任何 worktree 佔用），再 `git -C <main> branch -D "<branch>"`
   - 主 checkout 模式：這裡先不刪——`<wt>` 還占用著分支，刪不掉；留到第 5 步 `rm` 之後再查
4. **回報**：主 checkout 模式等第 5 步驗證完再回報做了什麼。worktree 模式不另外回報（Step 4 的清單已經寫了），只在呼叫 rm 前用一句話帶過「開始刪除 worktree」。
5. **刪 worktree**：Step 1 查到不是 Orca 管的 → 主 checkout 模式改用 `git -C <main> worktree remove "<wt>"`（不加 `--force`）；Orca 管的 → 兩種模式都用同一個指令、不依賴 cwd：
   ```bash
   orca worktree rm --worktree "path:<wt>" --json
   ```
   不加 `--force`。這是整個流程的最後一條指令，之後不再呼叫任何工具。
   - 主 checkout 模式是非同步的：輪詢 `orca worktree list --json` 到這個路徑消失（最多約 30 秒），再用 `git -C <main> worktree list`、`git -C <main> branch --list "<branch>"` 驗證；分支如果還在，補一次 `git -C <main> branch -D "<branch>"`
   - `rm` 失敗（session 沒被關掉）：回報實際錯誤，附救援指令 `git -C <main> branch <branch> <sha>`（分支在 worktree 模式已經被刪了，用記下的 SHA 救回來）；不重試、不加 `--force`

## 不做的事

- 不跑 retro（收尾階段已經跑過）
- 不開 MR、不改 MR 狀態
- 不批次清理既有的舊 spec、舊 worktree；只處理這張票指到的那一個
