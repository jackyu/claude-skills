---
name: to-acceptance
description: 把 spec 和 RD 票轉成一份給人看的驗收清單（AC-1、AC-2…，每條有前提、操作、預期、改動前、證據類型、要不要進回歸），寫到主 checkout 的 .claude/specs/acceptance-<key>.md；規格改過時重跑會更新清單、保留編號。排在 to-spec 之後、to-tickets 之前。使用者打 /to-acceptance 時使用。
disable-model-invocation: true
---

# to-acceptance：產生驗收清單

清單是這個功能的人工驗收條件，也是驗收階段 `/verify-acceptance` 逐條跑的依據、MR Evidence 的對照表。格式以 `~/.claude/skills/_shared/acceptance/format.md` 為準，先讀它。

**用法**：`/to-acceptance [issue 號或 spec 檔名]`。沒給就從對話、目前分支名或 mission 名稱推；推不出來就問。

## Step 1：找輸入

| 輸入 | 怎麼拿 | 用途 |
|------|--------|------|
| 主 checkout | `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` | 清單和 spec 都在 `<主 checkout>/.claude/specs/` |
| spec 檔 | `<主 checkout>/.claude/specs/spec-<iid>-*.md`；找不到就問使用者，沒有 spec 也可以只用 RD 票 | 主要來源：User Stories、Solution、Implementation Decisions |
| RD 票 | `glab api "projects/:id/issues/<iid>" \| jq -r '.title, .description'`（唯讀） | 對照用：票上有「驗收條件」就逐條對照；沒有就拿「實作範圍」和其他具體要求（例：上版順序）對照 |
| 對話 | 這個 session 前面 grill、to-spec 的討論（沒有就略過） | 補規格沒寫、但討論定案的邊界情況 |
| 回歸地圖 | `git -C <主 checkout> ls-tree --name-only origin/main .claude/skills/verify-admin/features/`（client 換成 `verify-client`），內容用 `git show origin/main:<路徑>` 讀 | 判斷回歸要「更新」既有 feature 還是「新增」 |
| 程式碼 | 先 `git -C <主 checkout> fetch origin`，一律讀 origin/main 的版本：`git -C <主 checkout> show origin/main:<路徑>`。功能合併進 main 之前，實作前或實作後跑都一樣 | 寫「改動前」 |

**key**：照 format.md「檔案與 key」決定。有本 repo 的 RD 票就用票號，不要用 PM 票號。

清單檔已經存在 → 走 Step 5「更新」，不要從頭產。

## Step 2：決定 meta

- `key`：同上
- `mission`：對話或 band 上看得到 mission-band 的任務名（例 `1022-#473`）就填，看不到就省略。沒有 issue 的任務一定要填，mission-band 靠它找到這份清單
- `branch`：spec 或對話已經定了分支名就填，還沒定就省略
- `app`：spec／票改到 `apps/admin` 就是 `admin`，`apps/client` 就是 `client`，兩個都有就是 `both`（每條 AC 要加 `範圍` 欄）
- `branchType`：分支名（或 spec 寫的分支）開頭 `feat_`、`bug_`、`fix_`；看不出來就照需求性質判斷（新功能 `feat`、修 bug `bug`）
- `spec`、`specMtime`：spec 檔名和它現在的修改時間，用下面這行取（macOS、Linux 都能跑，輸出 UTC ISO 8601）：

  ```bash
  python3 -c 'import os,sys,datetime;print(datetime.datetime.fromtimestamp(os.path.getmtime(sys.argv[1]),datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))' <spec 檔>
  ```

## Step 3：拆條目

一條只驗一件使用者看得到（或測試看得到）的事：

- 從 User Stories 和 Solution 取行為；「A 而且 B」拆成兩條
- 不收實作細節（「移除某個 state」「留一行註解」）：那是 code review 的事，不是驗收
- 「其他功能不受影響」這類保證：這次改動的元件裡，有具體可能被波及的畫面才寫成一條（例：同一張表上的側欄按鈕照常能開），每個畫面一條；只是籠統的「其他都不變」就交給驗收階段的整體回歸，不硬寫
- **行為由別的系統負責**（例：排序規則由後端決定、只能在 UAT 驗）：前端這邊只驗「前端沒有干擾」（寫成一般 AC）；後端行為另寫一條，前提寫明依賴（例：「後端 #760 已部署到 UAT」），證據**只用** `指令輸出`（存 API 回應，不截圖），操作和預期也寫成打 API 的說法（端點、參數照後端票的契約，例：「依序打 `GET /manual-filing?page=1`、`page=2`」「兩頁接起來未完成全部在前」），改動前寫 `無（新功能）`，回歸標「否」——mock 驗不到真的後端行為
- 通常 3–10 條；超過 10 條先想想是不是混進了實作細節

每條填欄位（規則見 format.md）：

- **前提／操作／預期**：各一句，具體到可以照著做。預期寫畫面上看得到的字或順序，不寫「正常顯示」
- **改動前**（三選一）：
  - 行為會改變 → 寫既有行為（從 origin/main 程式碼讀；不確定就加 `推測：`）。驗收時拍 Before
  - 確認既有行為不受影響的條目 → `同預期（既有行為不變）`。不拍 Before，只拍 After
  - 全新的行為 → `無（新功能）`。不拍 Before
  - `branchType` 是 `feat` 時，「全新的行為」是預設；但在既有畫面上改東西（例：既有列表加欄位、拿掉按鈕）仍屬於「行為會改變」
- **證據**：畫面看得到 → `截圖（寬度）`（上面「別的系統負責」的條目除外）（admin `1280`，client `375／768／1280`）；畫面看不到的邏輯 → `測試`；兩者都有就都寫
- **回歸**：符合任一就標「是」——改動影響 UI 體驗、牽涉商業規則、是新功能；但 mock 驗不到的（真正的行為在後端）一律標「否」。已有同區域的 feature 檔寫「更新 <skill>/<feature>」，沒有寫「新增 <skill>/<feature 檔名，kebab-case>」，再接一句理由。標「是」的條目加 `- 回歸入庫：待寫`
- **來源**：對應 spec 的 User Story 編號或 RD 票的哪一點，多個用頓號串接
- **結果**：一律 `待驗`

## Step 4：檢查覆蓋，給使用者確認

1. 列出 RD 票的每一條驗收條件／實作範圍、spec 的每個 User Story，標出對應到哪幾個 AC。對不到的分兩種：屬於實作細節或 Out of Scope 的，寫一句為什麼不收；其他的補成 AC
2. 把整份清單草稿和覆蓋表一次給使用者看，請他逐條改、刪或補。不要一題一題問
3. 使用者確認後才寫檔，寫完 Read 回來確認內容

## Step 5：更新既有清單（規格改過後重跑）

1. 讀現有清單和新的 spec，逐條比對
2. 內容沒變的條目原封不動，包括結果
3. 內容要改的：保留編號改內容，結果、回歸入庫、整體回歸照 format.md「條目改了之後」處理
4. 不要的：標題改成 `### AC-n（已刪除）<原標題>`，只留來源和 `結果：已刪除｜<今天日期> <原因>`
5. 新的：接在最大編號後面
6. meta 的 `specMtime` 更新成 spec 現在的修改時間
7. 把變動摘要（改了哪幾條、刪了哪幾條、新增哪幾條）給使用者確認後才寫檔

## 完成後

告訴使用者：清單路徑、共幾條、幾條要拍 Before、幾條要進回歸。還沒拆票的話，接著可以跑 to-tickets，票的驗收條件用 AC 編號引用（例：「AC-1、AC-3」）；已經實作完就直接進驗收。
