---
name: verify-acceptance
description: 照驗收清單（.claude/specs/acceptance-<key>.md）逐條驗收：依每條的證據類型起 app 截圖、跑測試或跑指令；會改變的行為另在分支的分岔點（baseline worktree）拍 Before、驗測試紅轉綠；把結果寫回清單，再把要進回歸的條目寫進 verify-admin／verify-client，最後跑整體回歸。驗收階段使用者打 /verify-acceptance 時使用。
disable-model-invocation: true
---

# verify-acceptance：逐條驗收

清單格式以 `~/.claude/skills/_shared/acceptance/format.md` 為準，先讀它。這個 skill 只寫清單的 `結果`、`回歸入庫`、`整體回歸`、meta 的 `branch`，其他欄位是 `/to-acceptance` 的，不要改。

**用法**：`/verify-acceptance [key] [--all] [--only AC-1,AC-3] [--no-regression]`

- 預設只跑結果是 `待驗`、`未過`、`受阻`、`待重驗` 的條目；`--all` 連 `通過` 的也重跑；`--only` 只跑指定的
- 逐條跑完後接著做回歸入庫（Step 5）和整體回歸（Step 6）；`--no-regression` 跳過這兩步
- 不 commit、不 push。驗收過程發現程式要改，回報給使用者，回實作階段修
- **通常要跑兩輪**：第一輪逐條驗收、把回歸寫進 worktree；使用者 commit 之後再跑一次，這次條目都過了會直接進整體回歸，記下的 SHA 才是最後要進 MR 的那一個

## Step 0：準備

`<main>` 是主 checkout、`<wt>` 是功能 worktree、`<base>` 是 baseline worktree，都用絕對路徑。**起 app、drive、跑測試、git 指令一律寫成 `cd <目錄> && …`**：verify-admin／verify-client 的腳本從自己的位置推回 repo 根，從別的目錄呼叫會起到別的 checkout 的 app。清單和證據目錄在 `<main>`，用絕對路徑讀寫。

1. `<main>`：`dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`
2. **找清單**：給了 key 就讀 `<main>/.claude/specs/acceptance-<key>.md`；沒給就照 format.md「檔案與 key」從目前分支或 mission 名稱找。找不到 → 請使用者先跑 `/to-acceptance`，結束
3. **找 `<wt>`**：
   - meta 有 `branch` → `git worktree list` 找那個分支的目錄
   - 沒有 → 用目前所在的 worktree。但目前分支是預設分支（`git symbolic-ref --short refs/remotes/origin/HEAD` 去掉 `origin/`）或 `rc/*` 時，停下來問使用者功能分支是哪一個
   - 確定後把分支名寫進 meta `branch`
4. **決定比較基準 `<baseRef>`**（改動前＝這個分支切出來的地方）：
   - meta `branchType` 是 `fix`（hotfix，目標是 `rc/*`）→ `<baseRef>`＝`origin/<MR 的目標分支>`；不知道目標就問使用者
   - 其他 → `origin/<預設分支>`
   - `cd <wt> && git fetch origin`，算出分岔點 `<baseSha>`＝`git merge-base HEAD <baseRef>`。之後所有 diff 都用 `<baseSha>...HEAD`，Before 也跑在 `<baseSha>`
   - `git rev-list --count HEAD..<baseRef>` 大於 0 → 提醒「分支落後 N 個 commit，建議先 rebase」，不擋（Before 用分岔點，不會混到別人的改動）
5. **規格改過沒有**：meta `spec` 不是 null 時，spec 檔現在的 mtime（取到整秒）比 `specMtime` 新 → 先提醒「規格改過，清單可能沒跟上，要先跑 /to-acceptance 更新嗎？」，使用者說繼續才往下
6. **分支狀態**：
   - `<wt>` 沒有 `.claude/skills/verify-admin`（或 `verify-client`）→ 分支切得太早，請使用者 rebase，截圖類先記成 `受阻｜分支沒有驅動腳本，請先 rebase`
   - 未提交改動：`git status --porcelain --untracked-files=no` 有東西，或 `git status --porcelain -- apps packages` 有未追蹤檔 → 提醒驗收跑的是含未提交改動的版本
7. **證據目錄**：`<main>/.claude/verify-evidence/<key>/`，沒有就建
8. **列出要跑的條目**和各自的證據類型，給使用者看一眼就開始，不用等確認

## Step 1：先分出跑不了 mock 的條目

`前提` 依賴外部環境的條目（例：「後端 #760 已部署到 UAT」「接真的後端」），**不起 mock app 驗它**：verify-admin／verify-client 會把所有 API 請求 mock 掉，拍出來的畫面證明不了後端行為。

- 證據有截圖 → 截圖那項記成受阻：`受阻｜需接 <環境>，mock 驗不到`
- 證據有指令輸出 → 照 Step 3「指令輸出」處理
- 證據有測試 → 照常跑測試（只能證明前端那一半）

## Step 2：起 app

### After（有截圖類條目，或這一輪要跑 Step 6 整體回歸才做）

依 meta `app`（`both` 時看每條的 `範圍`）：

| app | 怎麼起 | 預設 port |
|-----|--------|-----------|
| admin | `cd <wt> && .claude/skills/verify-admin/scripts/launch.sh <port> webpack <這次要驗的頁面路徑>`，再跑 doctor | 3201 |
| client | `cd <wt> && .claude/skills/verify-client/scripts/launch.sh <port>`，再跑 doctor | 3202 |

- 預設 port 被別人占用就換一個（3211、3212…）。之後 drive、doctor、cleanup，以及寫進 `.cmd.txt` 的指令，一律明寫 `--port`。不碰 3000、3001，那是使用者自己的 dev server
- 會用到 PdfViewer 的 admin 頁面改用 `turbopack`（見 verify-admin SKILL.md）
- 前置條件不滿足（`.env` 不在、`node_modules` 沒裝）：`.env` 只能請使用者自己 `! cp <main>/apps/<app>/.env <wt>/apps/<app>/.env`，主對話不讀不複製。等不到就把所有截圖類條目記成 `受阻｜<app> 起不來：<原因>`，繼續跑測試和指令類
- After 的 app 開到 Step 6 整體回歸跑完才關

### Before（有 `needsBefore` 的條目才做）

`needsBefore`＝`改動前` 不是 `無（新功能）`、也不是 `同預期` 開頭。整份清單沒有這種條目就整段跳過。

Before 跑在 baseline worktree `<base>`＝`<main>/.claude/worktrees/verify-baseline`，切到 `<baseSha>`：

1. **鎖**：鎖檔放在 `<base>` 外面，`<main>/.claude/worktrees/verify-baseline.lock`（放在 `<base>` 裡會被當成未追蹤檔）。存在、內容的 key 不是這次的、而且修改時間在 2 小時內 → 有別的驗收正在用，停下來告訴使用者。否則寫入 `<key> <ISO 時間>`，Step 7 收尾時刪掉
2. **第一次**（`<base>` 不存在）：
   ```bash
   git -C <main> worktree add --detach <base> <baseSha>
   cd <base> && pnpm install --frozen-lockfile
   ```
   `.env` 請使用者自己 `! cp <main>/apps/<app>/.env <base>/apps/<app>/.env`，只要一次
3. **之後每次**：
   - 確認 Before 的 port 上沒有還在跑的 dev server（有就先 cleanup）
   - `cd <base> && git status --porcelain`；有上次沒清掉的測試檔就 `git clean -fd -- 'apps/*/test'`（不帶 `-x`，`.env`、`node_modules` 不會被刪）
   - `git checkout --detach -f <baseSha>`
   - `git diff --name-only <切換前的 HEAD> <baseSha> -- pnpm-lock.yaml` 有東西，或 launch／測試回報缺 `node_modules` → `pnpm install --frozen-lockfile`
4. install 之後看 `git -C <base> status --short`，lockfile 被改寫就 `git checkout -- pnpm-lock.yaml`，保持 `<base>` 乾淨
5. 確認 `<base>` 有 `.env`（`git check-ignore -q apps/<app>/.env && test -f apps/<app>/.env`）。沒有就把 Before 截圖記成 `受阻｜baseline 沒有 .env`；Before journey 照樣寫好（補了 `.env` 重跑就能直接用），After 和測試紅轉綠照跑（測試不需要 `.env`）
6. 有 `.env` 才起 app（沒有的話 launch 一定失敗，不用試）：admin `cd <base> && .claude/skills/verify-admin/scripts/launch.sh <port> …`（預設 3203），client 預設 3204，再跑 doctor 並記下 `<base>` 的 HEAD；PdfViewer 頁面一樣用 turbopack
7. `<base>` 只拿來跑，不 commit、不改追蹤的檔案；暫時放進去的檔案用完就刪

## Step 3：逐條跑

一條一條來，每條跑完立刻寫回清單（見 Step 4），不要全部跑完才寫。

### 截圖：admin

1. 寫臨時 journey 到 `<證據目錄>/journeys/AC-<n>.json`（Step 5 回歸入庫會用到，不要刪）。已經存在、而且 mock 跟「前提」對得上就沿用；條目內容改過（`待重驗`）就重寫
   - 範本：`<wt>/.claude/skills/verify-admin/journeys/*.json` 裡同區域的那份，照抄後依「前提」改 `mocks` 的資料
   - 必填：`route`、`roles`、`ready`、`mocks`、`steps`。角色以 AC「前提／操作」寫的為準，沒寫才用範本的（吉盈頁面給 `ji_admin`）
   - `steps`：照「操作」寫動作；「預期」寫成 `expectVisible`／`expectCount`／`expectUrl` 等斷言。`capture` 拍兩張：第一個動作之前一張、最後一個斷言之後一張
   - drive 沒有的動作（例：hover）改用等效的鍵盤操作（例：focus 觸發 tooltip），並在結果裡寫明替代方式
   - 定位注意：真瀏覽器的 ARIA role 可能跟 jsdom 測試不同（例：表頭 `<th>` 在 Chromium 是 `cell`）；同一段文字出現在多處（側欄、標題、麵包屑）要加 `nth` 或換定位
2. 跑：`cd <wt> && node .claude/skills/verify-admin/scripts/drive.mjs --port <After port> --journey <證據目錄>/journeys/AC-<n>.json`
3. 判定：exit 0、斷言都過才算過。順序、字數這類斷言寫不出來的，讀 capture 的 `.aria.txt` 核對，結果裡寫明「順序由 ARIA snapshot 核對」。有 `aborted-unmocked` 的請求要說明影不影響結果

### 截圖：client

1. 從 `<wt>/.claude/skills/verify-client/scripts/scenarios.mjs` 挑符合「前提」的情境。**沒有合適的就在 `<wt>` 的 scenarios.mjs 新增一個**（欄位名照真實後端：proxy 逐字轉發不轉 case，回應形狀以 `apps/client/src` 對應 api 模組的型別為準），這個檔要跟功能一起進 MR，記進 Step 5 的回歸入庫清單
2. 寫兩個檔到 `<證據目錄>/journeys/`：`AC-<n>.actions.json`（動作陣列，「預期」寫成 `waitText`／`expectAbsentText`／`expectEnabled` 等）和 `AC-<n>.cmd.txt`（完整的 drive 指令，含 `--port --feature --route --scenario --wait-text --widths --actions`）
3. 跑 `AC-<n>.cmd.txt` 那行（在 `<wt>`）。預設有沒 mock 到的 `/api/*` 就整體失敗：先看是不是情境不夠；確認不影響這條的判定才加 `--allow-unmocked`，並在結果裡寫明
4. 判定：每個寬度都 `PASS`。順序類的讀 capture 的 `.aria.yml` 核對

### 截圖：收證據

把這次 drive 的整個證據目錄（截圖、ARIA、network log）複製到 `<證據目錄>/runs/AC-<n>-after/`（已有舊的就先刪掉再複製，不要新舊混在一起），再把斷言後那張截圖另外複製成 `<證據目錄>/AC-<n>-after-<寬度>.png`；同一個寬度有好幾張要當證據時，加流水號 `AC-<n>-after-<寬度>-<序號>.png`，每張都寫進結果。worktree 刪掉後證據還在。

### 測試

1. 找對應的測試：
   - 先看 `cd <wt> && git diff --name-only <baseSha>...HEAD` 裡的測試檔，讀測試名稱，挑出驗這條行為的那幾個
   - diff 裡沒有（常見於「同預期」條目）→ 到 `<wt>/apps/<app>/test/` 鏡像目錄搜被測元件或頁面的名稱，找既有的測試
   - 測試檔有，但沒有任何一個斷言驗到這條「預期」的核心 → 當成找不到
   - 都找不到 → `受阻｜找不到對應的測試`，回報建議補哪個斷言（屬於實作階段的事，這裡不改程式）
   - 測試只驗到「預期」的一部分、其餘由截圖驗到 → 可以算過，結果裡寫明測試涵蓋哪部分
2. 跑測試檔（路徑相對於 `apps/<app>`）：`cd <wt> && pnpm --filter <app> exec jest --runTestsByPath '<路徑>'`
   - 用 `--runTestsByPath`，路徑裡的 `(…)`、`[…]` 才不會被當成 regex；用 `exec jest`，因為 `pnpm test -- …` 會把 `--` 原樣傳給 jest，後面的參數全被當成 pattern
   - Vitest 專案改用 `exec vitest run '<路徑>'`；先看 `apps/<app>/package.json` 用哪個
   - 輸出存到 `<證據目錄>/<測試檔名去掉 .test.tsx 之類的副檔名>-test-after.txt`（例：`ManualFilingTable-test-after.txt`）。好幾條 AC 共用同一個測試檔時只跑一次，結果都指向同一份輸出
3. 這條指定的那幾個測試通過才算這項過

### 指令輸出

1. 照「操作」跑。需要外部環境（UAT 的 API）、帳密或 `.env` 的，主對話不讀密鑰、不自己打：把使用者要照抄的指令寫進 `<證據目錄>/AC-<n>-cmd.txt`（指令裡常有 `|`，不能寫進結果欄，會被當成分隔符），這條記 `受阻｜等使用者執行 <證據目錄相對路徑>/AC-<n>-cmd.txt`，回報時把指令貼出來；使用者跑完後重跑 `/verify-acceptance --only AC-<n>` 判讀
2. 輸出存到 `<證據目錄>/AC-<n>-output.<副檔名>`；同一條有好幾份輸出就用 `AC-<n>-output-<標籤>.<副檔名>`（例：`-page1`、`-page2`），依「預期」判斷

### 改動前（Before）

只有 `needsBefore` 的條目做。

**截圖**

1. 另寫一份 `<證據目錄>/journeys/AC-<n>.before.json`（client 是 `AC-<n>.before.actions.json` 加 `AC-<n>.before.cmd.txt`），從 After 那份改：
   - `ready`（client 的 `--wait-text`）改成改動前也有的東西
   - 步驟只留改動前存在的部分（點不到改動後才有的元素）；「預期」的斷言拿掉，換成「改動前」寫得出來的斷言，寫不出來就只靠 capture
   - mock：改動前的程式可能打不同的端點。先跑一次看 `network.jsonl`（client 是 `network.json`）有哪些 `aborted-unmocked`，補上它實際打的端點再跑
   - 真的走不到要拍的畫面：拿 `failure.png` 當 Before 證據，結果裡寫明
2. 跑：**用 `<wt>` 的 drive**（跟 After 同一份腳本，不用 `<base>` 那份舊的），只把 port 換成 Before 的。admin：`cd <wt> && node .claude/skills/verify-admin/scripts/drive.mjs --port <Before port> --journey <證據目錄>/journeys/AC-<n>.before.json`；client：`AC-<n>.before.cmd.txt` 一樣在 `<wt>` 跑、`--port` 寫 Before 的
3. 收證據：整個 run 目錄複製到 `<證據目錄>/runs/AC-<n>-before/`，截圖複製成 `<證據目錄>/AC-<n>-before-<寬度>.png`
4. Before 畫面跟「改動前」描述對不上 → 不影響這條的判定，但回報時列出來，請使用者回頭修清單

**測試紅轉綠**

`needsBefore` 的條目只接受「紅→綠」：行為改了，測試卻在前後都綠，代表它沒驗到這個改變。

1. 對應的測試檔要是這個分支新增或改過的。對應到的是沒改過的既有測試 → 當成「找不到對應的測試」
2. 把要帶進 `<base>` 的檔案找齊：這個測試檔，加上 `git diff --name-only <baseSha>...HEAD -- apps/<app>/test/` 裡被它 import 的輔助檔（helpers、fixtures）。原本 `<base>` 有的先備份
3. 在 `<base>` 只跑指定的測試（好幾條 AC 共用同一個測試檔時，用 `-t '<名稱 A>|<名稱 B>'` 一次跑完，共用一份輸出）：`cd <base> && pnpm --filter <app> exec jest --runTestsByPath '<路徑>' -t '<測試名稱>'`，輸出存到 `<證據目錄>/<測試檔名去掉副檔名>-test-before.txt`
   - `-t` 比對的是 describe 加 it 的完整名稱，是 regex：名稱裡的 `( ) [ ] . * + ?` 要先跳脫
   - 判定前確認輸出裡指定的測試**真的有跑**（passed 加 failed 至少 1）。全部 skipped 代表 `-t` 沒比對到，修好重跑，不能當成綠
4. 跑完還原 `<base>`：改過的 `git -C <base> checkout -- <路徑>`，新增的刪掉，最後 `git -C <base> status --porcelain` 要是空的
5. 判定（只看指定的測試名稱）：
   - 改動前紅、改動後綠 → 測試證據寫 `（紅→綠）`
   - 改動前也綠 → `未過｜測試在改動前也會過，證明不了改動：<測試名稱>`
   - 整檔載入失敗：缺的模組在 `src/` 底下（正式程式碼新增的）→ 算紅，結果裡寫明「改動前整檔載入失敗」；缺的是 `test/` 底下的輔助檔或 `jest.mock` 的路徑 → 是帶錯檔案，補齊再跑，不能算紅

## Step 4：寫回清單

- 判定順序：任一項不符合預期 → `未過｜<哪裡不符>｜<證據>`（優先於受阻）。不符的原因如果是這個分支沒動到的既有行為，原因開頭寫 `既有問題：`，回報時提醒使用者依專案慣例收進追蹤票，不要自己開票或改程式；否則有一項拿不到 → `受阻｜<缺什麼>｜<證據>`；全部拿到而且都過 → `通過｜<證據>…`
- 證據路徑一律相對於 `<main>`
- 任何一條的結果變了，`整體回歸` 改回 `未跑`
- 用 Edit 改 `- 結果：` 那一行。每條的結果行常常長得一樣，old_string 要連同上一行 `- 來源：…` 一起帶上才唯一。改完 Read 回來確認
- 新的結果跟原本一字不差就不用改，也不算「結果變了」

## Step 5：回歸入庫

對 `回歸：是`、`回歸入庫：待寫` 的條目，把臨時腳本正式寫進 `<wt>`，跟功能一起進 MR。條件是 After 截圖已經過；結果是 `通過`，或只因為缺 Before 而 `受阻` 都可以（回歸只跑 After）。

- **verify-admin**：一份 journey 只有一個 route、一組角色、一條線性步驟，不要硬併進既有的 journey
  - 新增 `journeys/<feature>-<描述>.json`（例：`manual-filing-list-backend-order.json`），內容就是臨時 journey
  - `更新 <feature>`：在 `features/<feature>.md` 的 Driving 段落加上新 journey 的指令和它驗什麼，順便改掉 Preconditions、Gotchas 裡因為這次改動而過時的描述（既有 journey 的斷言因此失效的，也一起改）
  - `新增 <feature>`：照 `features/README.md` 的「Feature entry contract」寫 `features/<feature>.md`，並加進 README 的 Features 清單
- **verify-client**：actions 放 `scripts/actions/<feature>-<描述>.json`（不要覆蓋既有的檔）；在 `features/<feature>.md` 的 Driving 段落加上可照抄、帶 `--port` 的 drive 指令；Step 3 新增的情境也算進來
- 寫完用新的 journey／指令對 After 再跑一次，要過
- 清單改成 `- 回歸入庫：已寫｜<repo 相對路徑>、<repo 相對路徑>`
- **不 commit**：回報時列出改了哪些檔，請使用者跟功能一起 commit，commit 後再跑一次這個 skill 做整體回歸

## Step 6：整體回歸

**這一輪 Step 5 有寫檔，或 `<wt>` 有未提交改動（照 Step 0 第 6 點的判斷）→ 跳過這步**，清單維持 `整體回歸：未跑`，回報請使用者 commit 後再跑一次。記下的 SHA 必須是實際跑的程式碼。

否則對 After 跑回歸地圖裡的**全部**項目：

- admin：`<wt>/.claude/skills/verify-admin/journeys/*.json` 每一份各跑一次，`--port` 換成 After 的。features 檔裡標成「預期失敗」的變體（例：`--role sales` 驗無權限）照它寫的指令跑，結果符合它寫的預期就算過
- client：`<wt>/.claude/skills/verify-client/features/*.md` 每份 Driving 段落的每條指令各跑一次（`--port` 換成 After 的）
- 全過 → `- 整體回歸：通過｜<ISO 時間>｜<cd <wt> && git rev-parse HEAD>｜<N> 條 journey`
- 有失敗 → `- 整體回歸：未過｜<哪幾條、為什麼>`；是這次改動造成的就回實作階段修，是 journey 本身過時就回報請使用者決定
- 起不來 → `- 整體回歸：受阻｜<原因>`

## Step 7：收尾回報

- 跑 cleanup 關掉自己起的 app（After 和 Before 都要），確認 port 釋放（drive 和 cleanup 會在 `<wt>/.claude/verify-evidence/` 留下 run 目錄和 dev log，那裡已 gitignore，不用清）；刪掉 `<main>/.claude/worktrees/verify-baseline.lock`；確認 `<base>` 的 `git status --porcelain` 是空的
- 回報表格：AC、結果、證據路徑；最後一行統計（通過 N／未過 N／受阻 N／待驗 N，待驗含待重驗）
- 未過的條目附原因和截圖路徑，建議回實作階段修
- 受阻的條目列出缺什麼、誰能解（例：「請你執行 `! cp …`」）
- 回歸入庫改了哪些檔、要不要 commit 後再跑一次；整體回歸的結果
- Step 3 在 `<wt>` 新增、但沒進回歸入庫的檔（例：條目未過時新增的 client 情境），請使用者決定留不留
- Before 跟「改動前」描述對不上的條目
