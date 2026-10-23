---
name: verify-acceptance
description: 照驗收清單（.claude/specs/acceptance-<key>.md）逐條驗收：依每條的證據類型起 app 截圖、跑測試或跑指令，把結果和證據路徑寫回清單。用 verify-admin／verify-client 當驅動器。驗收階段使用者打 /verify-acceptance 時使用。
disable-model-invocation: true
---

# verify-acceptance：逐條驗收

清單格式以 `~/.claude/skills/_shared/acceptance/format.md` 為準，先讀它。這個 skill 只寫清單的 `結果`、`整體回歸`、meta 的 `branch`，其他欄位是 `/to-acceptance` 的，不要改。

**用法**：`/verify-acceptance [key] [--all] [--only AC-1,AC-3]`

- 預設只跑結果是 `待驗`、`未過`、`受阻`、`待重驗` 的條目；`--all` 連 `通過` 的也重跑；`--only` 只跑指定的
- 不 commit、不 push。驗收過程發現程式要改，回報給使用者，回實作階段修

## Step 0：準備

以下 `<main>` 是主 checkout、`<wt>` 是功能 worktree 的絕對路徑。**起 app、drive、跑測試、git 指令一律寫成 `cd <wt> && …`**：verify-admin／verify-client 的腳本從自己的位置推回 repo 根，從別的目錄呼叫會起到別的 checkout 的 app。清單和證據目錄在 `<main>`，用絕對路徑讀寫。

1. `<main>`：`dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`
2. **找清單**：給了 key 就讀 `<main>/.claude/specs/acceptance-<key>.md`；沒給就照 format.md「檔案與 key」從目前分支或 mission 名稱找。找不到 → 請使用者先跑 `/to-acceptance`，結束
3. **找 `<wt>`**：
   - meta 有 `branch` → `git worktree list` 找那個分支的目錄
   - 沒有 → 用目前所在的 worktree。但目前分支是預設分支（`git symbolic-ref --short refs/remotes/origin/HEAD` 去掉 `origin/`）或 `rc/*` 時，停下來問使用者功能分支是哪一個，不要把它寫進 meta
   - 確定後把分支名寫進 meta `branch`
4. **規格改過沒有**：meta `spec` 不是 null 時，spec 檔現在的 mtime（取到整秒）比 `specMtime` 新 → 先提醒「規格改過，清單可能沒跟上，要先跑 /to-acceptance 更新嗎？」，使用者說繼續才往下
5. **分支狀態**：
   - `cd <wt> && git fetch origin && git rev-list --count HEAD..origin/main` 大於 0 → 提醒「分支落後 main N 個 commit，前後對照可能混到別人的改動，建議先 rebase」，不擋
   - `<wt>` 沒有 `.claude/skills/verify-admin`（或 `verify-client`）→ 分支切得太早，請使用者 rebase，截圖類先記成 `受阻｜分支沒有驅動腳本，請先 rebase`
   - `git status --porcelain` 有未提交的改動 → 提醒驗收跑的是含未提交改動的版本
6. **證據目錄**：`<main>/.claude/verify-evidence/<key>/`，沒有就建
7. **列出要跑的條目**和各自的證據類型，給使用者看一眼就開始，不用等確認

## Step 1：先分出跑不了 mock 的條目

`前提` 依賴外部環境的條目（例：「後端 #760 已部署到 UAT」「接真的後端」），**不起 mock app 驗它**：verify-admin／verify-client 會把所有 API 請求 mock 掉，拍出來的畫面證明不了後端行為。

- 證據有截圖 → 截圖那項記成受阻：`受阻｜需接 <環境>，mock 驗不到`
- 證據有指令輸出 → 照 Step 3「指令輸出」處理
- 證據有測試 → 照常跑測試（只能證明前端那一半）

## Step 2：起 After 的 app（有截圖類條目才做）

依 meta `app`（`both` 時看每條的 `範圍`）：

| app | 怎麼起 | 預設 port |
|-----|--------|-----------|
| admin | `cd <wt> && .claude/skills/verify-admin/scripts/launch.sh 3201 webpack <這次要驗的頁面路徑>`，再跑 doctor | 3201 |
| client | `cd <wt> && .claude/skills/verify-client/scripts/launch.sh 3202`，再跑 doctor | 3202 |

- 預設 port 被別人占用就換一個（3211、3212…），之後 drive、doctor、cleanup 都帶同一個 port。不碰 3000、3001，那是使用者自己的 dev server
- 會用到 PdfViewer 的 admin 頁面改用 `turbopack`（見 verify-admin SKILL.md）
- 前置條件不滿足（`.env` 不在、`node_modules` 沒裝）：`.env` 只能請使用者自己 `! cp <main>/apps/<app>/.env <wt>/apps/<app>/.env`，主對話不讀不複製。等不到就把所有截圖類條目記成 `受阻｜<app> 起不來：<原因>`，繼續跑測試和指令類
- 用完一定要跑 cleanup（`cd <wt> && .claude/skills/verify-<app>/scripts/cleanup.sh <port>`），失敗的嘗試之後也要

## Step 3：逐條跑

一條一條來，每條跑完立刻寫回清單（見 Step 4），不要全部跑完才寫。

### 截圖：admin

1. 寫臨時 journey 到 `<證據目錄>/journeys/AC-<n>.json`（第 3 期把要進回歸的條目正式寫進 verify-admin 會用到，不要刪）
   - 範本：`<wt>/.claude/skills/verify-admin/journeys/*.json` 裡同區域的那份，照抄後依「前提」改 `mocks` 的資料
   - 必填：`route`、`roles`、`ready`、`mocks`、`steps`。角色以 AC「前提／操作」寫的為準，沒寫才用範本的（吉盈頁面給 `ji_admin`）
   - `steps`：照「操作」寫動作；「預期」寫成 `expectVisible`／`expectCount`／`expectUrl` 等斷言。`capture` 拍兩張：第一個動作之前一張、最後一個斷言之後一張
   - drive 沒有的動作（例：hover）改用等效的鍵盤操作（例：focus 觸發 tooltip），並在結果裡寫明替代方式
   - 定位注意：真瀏覽器的 ARIA role 可能跟 jsdom 測試不同（例：表頭 `<th>` 在 Chromium 是 `cell`）；同一段文字出現在多處（側欄、標題、麵包屑）要加 `nth` 或換定位
2. 跑：`cd <wt> && node .claude/skills/verify-admin/scripts/drive.mjs --port <port> --journey <證據目錄>/journeys/AC-<n>.json`
3. 判定：exit 0、斷言都過才算過。順序、字數這類斷言寫不出來的，讀 capture 的 `.aria.txt` 核對，結果裡寫明「順序由 ARIA snapshot 核對」。有 `aborted-unmocked` 的請求要說明影不影響結果

### 截圖：client

1. 從 `<wt>/.claude/skills/verify-client/scripts/scenarios.mjs` 挑符合「前提」的情境。**沒有合適的情境就記成 `受阻｜缺 mock 情境：<需要什麼資料>`**，不要在功能 worktree 改 scenarios.mjs
2. 寫兩個檔到 `<證據目錄>/journeys/`：`AC-<n>.actions.json`（動作陣列，「預期」寫成 `waitText`／`expectAbsentText`／`expectEnabled` 等）和 `AC-<n>.cmd.txt`（完整的 drive 指令，含 `--feature --route --scenario --wait-text --widths --actions`）
3. 跑 `AC-<n>.cmd.txt` 那行（在 `<wt>`）。預設有沒 mock 到的 `/api/*` 就整體失敗：先看是不是情境不夠；確認不影響這條的判定才加 `--allow-unmocked`，並在結果裡寫明
4. 判定：每個寬度都 `PASS`。順序類的讀 capture 的 `.aria.yml` 核對

### 截圖：收證據

把這次 drive 的整個證據目錄（截圖、ARIA、network log）複製到 `<證據目錄>/runs/AC-<n>-after/`，再把斷言後那張截圖另外複製成 `<證據目錄>/AC-<n>-after-<寬度>.png`；同一個寬度有好幾張要當證據時，加流水號 `AC-<n>-after-<寬度>-<序號>.png`，每張都寫進結果。worktree 刪掉後證據還在。

### 測試

1. 找對應的測試：
   - 先看 `cd <wt> && git diff --name-only origin/main...HEAD` 裡的測試檔，讀測試名稱，挑出驗這條行為的那幾個
   - diff 裡沒有（常見於「同預期」條目）→ 到 `<wt>/apps/<app>/test/` 鏡像目錄搜被測元件或頁面的名稱，找既有的測試
   - 測試檔有，但沒有任何一個斷言驗到這條「預期」的核心 → 當成找不到
   - 都找不到 → `受阻｜找不到對應的測試`，回報建議補哪個斷言（屬於實作階段的事，這裡不改程式）
   - 測試只驗到「預期」的一部分、其餘由截圖驗到 → 可以算過，結果裡寫明測試涵蓋哪部分
2. 跑測試檔（路徑相對於 `apps/<app>`，用 `--runTestsByPath` 免得路徑裡的 `(…)`、`[…]` 被當成 regex；用 `exec jest`，因為 `pnpm test -- …` 會把 `--` 原樣傳給 jest，後面的參數全被當成 pattern）：`cd <wt> && pnpm --filter <app> exec jest --runTestsByPath '<路徑>'`（Vitest 專案改用 `exec vitest run '<路徑>'`；先看 `apps/<app>/package.json` 用哪個），輸出存到 `<證據目錄>/<測試檔名>-test-after.txt`
   - 好幾條 AC 共用同一個測試檔時只跑一次，結果都指向同一份輸出
3. 指定的測試通過才算這項過

### 指令輸出

1. 照「操作」跑。需要外部環境（UAT 的 API）、帳密或 `.env` 的，主對話不讀密鑰、不自己打：把使用者要照抄的指令寫進 `<證據目錄>/AC-<n>-cmd.txt`（指令裡常有 `|`，不能寫進結果欄，會被當成分隔符），這條記 `受阻｜等使用者執行 <證據目錄相對路徑>/AC-<n>-cmd.txt`，回報時把指令貼出來；使用者跑完後重跑 `/verify-acceptance --only AC-<n>` 判讀
2. 輸出存到 `<證據目錄>/AC-<n>-output.<副檔名>`；同一條有好幾份輸出就用 `AC-<n>-output-<標籤>.<副檔名>`（例：`-page1`、`-page2`），依「預期」判斷

### 改動前（Before）

這一版還不支援 Before。條目的 `改動前` 是會改變的行為（不是 `無（新功能）`、不是 `同預期` 開頭）時，After 和測試照跑；測試證據暫時寫 `（通過）`；結果寫 `受阻｜Before 尚未支援（baseline 未設定）｜<已拿到的證據>`。

## Step 4：寫回清單

- 判定順序：任一項不符合預期 → `未過｜<哪裡不符>｜<證據>`（優先於受阻）。不符的原因如果是這個分支沒動到的既有行為，原因開頭寫 `既有問題：`，回報時提醒使用者依專案慣例收進追蹤票，不要自己開票或改程式；否則有一項拿不到 → `受阻｜<缺什麼>｜<證據>`；全部拿到而且都過 → `通過｜<證據>…`
- 證據路徑一律相對於 `<main>`
- 任何一條的結果變了，`整體回歸` 改回 `未跑`
- 用 Edit 改 `- 結果：` 那一行。每條的結果行常常長得一樣，old_string 要連同上一行 `- 來源：…` 一起帶上才唯一。改完 Read 回來確認

## Step 5：收尾回報

- 跑 cleanup 關掉自己起的 app，確認 port 釋放
- 回報表格：AC、結果、證據路徑；最後一行統計（通過 N／未過 N／受阻 N／待驗 N，待驗含待重驗）
- 未過的條目附原因和截圖路徑，建議回實作階段修
- 受阻的條目列出缺什麼、誰能解（例：「請你執行 `! cp …`」）
