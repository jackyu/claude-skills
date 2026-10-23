---
name: mr-reading-map
description: 在 GitLab MR 的 diff 上發一串有順序的 inline 導覽註解（[1/M]、接著看 → 下一則），並把閱讀地圖插進 MR 描述；review 修正 push 之後重跑，只補發被標成過時的那幾則。使用者打 /mr-reading-map <MR 號> 時使用。會寫入 GitLab，只在使用者明確要求時跑。
disable-model-invocation: true
---

# MR 閱讀地圖

給 reviewer 一條閱讀動線：從入口點讀進來，再由內而外讀核心。導覽註解落在 diff 對應行，描述裡放一份可點的目錄，和一份重跑時用的 data。

**用法**：`/mr-reading-map <MR 號> [--full]`。建議在 draft 轉 ready 時跑第一次，review 修正 push 之後再視情況重跑。

專案參數一律給字面路徑（例：`fugle/brokerage-service-development/r-securities/rsc-frontend`）；長的 body、description 先寫成 scratchpad 檔，用 `"$(cat 檔)"` 傳。

## Step 0：準備

1. 讀 MR：`glab api "projects/:id/merge_requests/<iid>"`，取 `source_branch`、`web_url`、`description`、`diff_refs`
2. **描述裡沒有 `<!-- mr:fe-mr-generator -->` → 中止**，不發任何註解。沒有這個標記，`mr-update.sh` 寫不回描述，data 存不下來，下次重跑就會整批重發。請使用者先用 fe-mr-generator 更新描述
3. `git fetch origin`，到 `source_branch` 所在的目錄執行（分支已經在某個 worktree checkout 的話就去那個 worktree，不要另外 checkout），確認 working tree 乾淨、`git rev-parse HEAD` 等於 `git rev-parse origin/<source_branch>`
4. `diff_refs` 是 null，或 `diff_refs.head_sha` 不等於本地 HEAD → 用背景的 until 迴圈每 5 秒重查，上限 2 分鐘（前景 sleep 會被擋）。超過上限就回報後中止
5. 讀全部 discussions（要分頁，系統訊息也算 discussion）：

   ```bash
   glab api --paginate "projects/:id/merge_requests/<iid>/discussions?per_page=100" | jq -s 'add'
   ```

   `--paginate` 會把每一頁各印成一個陣列，一定要接 `jq -s 'add'` 合成一個再用。

6. 決定走哪條路：

| 狀況 | 走哪條 |
|------|-------|
| 帶 `--full` | 第一次執行（先清舊的） |
| 描述有 `<!-- mr:reading-map:data … -->` | 重跑 |
| 沒有 data，但 discussions 裡有還沒 resolve、沒人回覆過的導覽註解 | **停下來**，告訴使用者這是舊版 /push 或上次寫 data 失敗留下的，請改用 `--full` |
| 都沒有 | 第一次執行 |

**導覽註解**＝discussion 第一則 note 的 body 首行是 `🤖💬`、而且含 `<!-- mr:self-annotation -->`。**有人回覆過**＝這個 discussion 除了第一則還有其他非系統 note。

## 第一次執行

### 1. `--full` 先清舊的

對每一則導覽註解：

- 沒人回覆 → `mr-resolve.sh` 收掉
- 有人回覆過 → 不動。記下它講的主題，下一步挑行時同主題的不要重發，免得同一件事出現兩則。它也要寫進新的 data（`note_id`、`discussion_id` 用原本的，`order` 留 null），地圖的「有討論的註解」區才列得出來

### 2. 挑行、排順序

依 `references/picking-lines.md`，從 `git diff <diff_refs.base_sha> <diff_refs.head_sha>` 挑行，產生清單。

清單是空的 → 告訴使用者這個 MR 不需要閱讀地圖。`--full` 時描述裡的舊地圖區塊整塊刪掉（用 `mr-update.sh` 寫回），然後結束。

### 3. 發文、組串、寫描述

依 `references/publishing.md` 的 Phase A → B → C。

### 4. 回報

- 註解：成功 N 則／失敗 M 則（失敗的列 `檔案:行號` 和 GitLab 錯誤訊息）
- 導引補寫：N 則，缺導引的斷點列出來
- 閱讀地圖：已插入｜已更新｜寫入失敗（data 已印給你，見 Phase C）
- 有討論、沒動的註解：列連結，提醒它們的 `[i/M]` 和「接著看」可能已經對不上
- 提醒：導覽註解是可 resolve 的 thread，專案要求全部 resolve 才能合併的話，review 完自己 resolve

## 重跑

只處理被標成過時的導覽註解，其他的不碰。

### 1. 找出過時的註解

把 data 解碼成清單（見 `references/publishing.md`），逐筆用 `note_id` 對 discussions：

| 情況 | 處理 |
|------|------|
| 有人回覆過（不管過不過時） | 不動、不 PUT、不進串，地圖放在「有討論的註解」區。它是主要點的話，底下還在串裡的次要點升成主要點，之後重新連續編號 |
| `position.head_sha` 等於 MR 目前的 `diff_refs.head_sha` | 沒過時，GitLab 已經把它移到新行號。照樣進串，`line` 改成目前的 `position.new_line`（或 `old_line`） |
| `head_sha` 不一樣 | 過時，列入待重發 |
| data 裡 `note_id` 是 null（上次發文失敗），或找不到這個 note | 列入待重發 |

判斷只看 head_sha：API 沒有 outdated 欄位。2026-10-24 在 rsc-frontend 實測過，上方插入幾行時 head_sha 會更新、行號會移；那一行本身改了，head_sha 停在舊的。

**GitLab 更新註解位置可能比 diff_refs 慢。** 第一次查完只要有任何一則判成過時，就用背景迴圈等 30 秒，重讀 discussions 再判一次，用第二次的結果。

待重發是 0 則 → 回報「閱讀地圖不用更新」，結束。

### 2. 重寫待重發的那幾則

過時代表被註解的那一行改了。逐則用 data 的 `code` 和 `file` 回到新的 diff 找那一段：

- 重點還在 → 在新版的對應 `+` 行重寫 body（order、title 照舊，title 不貼切可以改）
- 重點已經不存在 → 從清單拿掉：
  - 拿掉的是主要點：底下的次要點能獨立成立就升成主要點，不能就一起拿掉
  - 拿掉之後，主要點和次要點都重新連續編號

舊 thread（有的話）用 `mr-resolve.sh` 收掉，再照 Phase A 只發這幾則。

### 3. 重組整串、更新描述

note id 換了，前一則的「接著看」會指錯，所以 Phase B 對整條串（不含有人回覆過的）重新組裝、PUT 一次，Phase C 整塊替換地圖和 data。照第一次執行的格式回報。

## Reference

- `references/picking-lines.md` — 挑行原則、順序、密度、行號
- `references/publishing.md` — 發文、組串、地圖格式，以及 data 的欄位和編碼
