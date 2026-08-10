---
name: fe-code-review
description: 前端程式碼審查 Orchestrator，以 Spec 軸／Standards 軸兩軸為主幹，串接內建 /code-review 與專業 Plugin Agents，並追蹤爆炸半徑（diff 外呼叫點副作用）與無害區對抗挑戰。使用時機：(1) 用戶要求 code review、審查、檢查程式碼品質, (2) 用戶提到 review 或請求 MR/PR 審查, (3) 用戶說「幫我看一下這個 branch」「review 一下」「檢查一下程式碼」等非正式用語, (4) 收到外部 code review 回饋需要評估與回應、處理 reviewer 意見, (5) 用戶跑完內建 /code-review 或 pr-review-toolkit 後想要整合成完整報告。用戶提到「改動會影響到哪」「有沒有漏看的副作用」「規格有沒有實作到」也適用。即使用戶沒有明確說「code review」，只要意圖是檢視程式碼變更的品質，就應該觸發此 skill。
---

# Frontend Code Review

以 Spec 軸與 Standards 軸為主幹的前端程式碼審查，另加爆炸半徑（diff 外呼叫點的副作用）與無害區對抗挑戰兩軸，並保留獨特的 Review 回饋處理準則。

## 工具呼叫方式

本 skill 混用兩種機制：

- **用 `Skill` tool 呼叫的 skill**（在主對話執行，先跑、不與 subagent 平行）：
  - `mattpocock-skills:code-review` — 審查主幹，內部再開 Spec 軸與 Standards 軸兩個平行 sub-agent。
  - 內建 `code-review` — 正確性 bug 偵測。**`skill` 固定為 `code-review`，`args` 固定帶 effort level 字串，預設一律用 `high`**（即 `args: "high"`）。
    - effort level **務必當作 `args` 傳入**，不要寫進 `skill` 名稱（寫成 `code-review high` 會導致 tool call 無法解析）。
    - 若要把問題直接發成 GitHub PR inline comment，`args` 改為 `"high --comment"`。
    - **這個內建 skill 設有 `disable-model-invocation`，透過 `Skill` tool 呼叫必定回錯**（`cannot be used with Skill tool due to disable-model-invocation`）。遇到此錯誤直接跳過 #1，在 Step 5 的總結註明「內建 code-review 無法程式呼叫，保留給使用者手動執行 `/code-review`」，不要重試、不要嘗試繞過。
- **subagents**：用 `Agent` tool 調度，透過 `subagent_type` 參數指定（如 `pr-review-toolkit:silent-failure-hunter`；爆炸半徑軸與無害區軸用 `general-purpose`）。無依賴的 agents 在同一 message 平行呼叫。

## 模式判定

根據用戶意圖判定執行模式：

- **審查模式**：用戶要求做 code review、審查程式碼品質 → 執行 Plugin 審查流程
- **回饋處理模式**：用戶收到 review 回饋要處理、回應 reviewer 的意見 → 執行回饋處理流程

---

## 審查模式

### Step 1: 前置——固定基準點、規模判定、spec 定位

**1a. 固定基準點（fixed point）**

基準點取使用者指定的 commit / branch / tag；未指定則預設 `origin/main`。續行前先確認基準點可解析、且 diff 非空。**任一項不成立就在此停下回報，不進 Step 2**——讓壞掉的 ref 或空 diff 在主對話爆掉，而不是在多個平行 sub-agent 裡各爆一次。

```bash
FIXED_POINT="origin/main"                      # 或使用者指定值
git rev-parse "$FIXED_POINT"                   # 無法解析 → 停下回報
git log "$FIXED_POINT..HEAD" --pretty=format:"- %h %s"
git diff "$FIXED_POINT...HEAD" --stat          # 三點：與 merge-base 比較
git diff "$FIXED_POINT...HEAD" --name-only     # 輸出為空 → 停下回報
```

**1b. 規模判定**（依 `--stat` 的總變更行數）：

- **小型**：< 50 行
- **中型**：50–300 行
- **大型**：> 300 行

規模除了決定 Step 3 派幾個 agent，**大型變更還要在 Step 5 的摘要輸出「這批該不該拆」的判定**。AI 產出的 diff 天生比人寫的大，不主動判一次就會一路長到沒人 review 得動。判準三項：

1. 這批 commit 是否包含多個彼此獨立、可各自上線的目的
2. 是否把重構跟功能混在一起（混了之後 reviewer 分不出哪些行為改變是故意的）
3. 拆開後每一份是否仍能編譯、測試通過

任一項成立就建議拆，並具體指出拆成哪幾份、各含哪些檔案。三項都不成立要**明說「已評估，不建議拆」**——省略這句就分不出是評估過還是根本沒看。

**1c. spec 來源定位**（供 Step 2 的 Spec 軸），依序嘗試，找到即停：

1. 使用者以參數給的 spec 檔路徑。
2. commit message 或分支名中的 issue 參照（`#NNN`、GitLab `!NNN`）→ 用 [`../_shared/fe-mr-common/scripts/issue-get.sh`](../_shared/fe-mr-common/scripts/issue-get.sh) 抓全文。
3. 專案內 `.claude/specs/spec-*.md`（先看 active，再看 `.claude/specs/archive/`），以 issue 編號或分支名比對；多份無法判定就問使用者選。
4. 都找不到 → 問使用者 spec 在哪。

使用者明說沒有 spec 時，Spec 軸降級為「無規格可對照」：**流程照跑不中斷**，Step 2 只跑 Standards 軸，並在 Step 5 的 `## Spec 軸` 一節寫明「無規格可對照，本軸未執行」。

### Step 2: 主幹——Spec 軸與 Standards 軸

用 `Skill` tool 呼叫 `mattpocock-skills:code-review`。呼叫前備妥下列四項，呼叫後依這四項監督其執行。

**(1) 基準點**：Step 1a 的 fixed point，呼叫時明確傳入——該 skill 在 fixed point 未指定時會反問使用者，本 skill 已有預設（`origin/main`），傳入即可避免它中斷流程。

**(2) Standards 軸來源補充**：該 skill 預設只找 repo 內的規範文件，而本環境的規範不在 repo，需明確餵入——

- `~/.claude/rules/*.md`：`typescript.md`、`component-patterns.md`、`coding-style.md`、`data-fetching.md`、`error-handling.md`、`response-transform.md`、`html-semantics.md`、`tailwind.md`、`testing.md`、`security.md`、`seo.md`、`git-workflow.md`、`git-worktree.md`
- `fe-arch` skill 的「Code Review 檢查清單」
- [`fe-guardrails/references/thresholds.md`](../fe-guardrails/references/thresholds.md) 的「給 review skill 引用的檢查項」——靜態品質門檻的數字（函式長度、複雜度、巢狀深度、單檔行數、重複率），Step 5 第 6 節會用到
- 專案 `CLAUDE.md`（若存在）

這些與該 skill 內建的 Fowler smell baseline 並用；明文規範與 baseline 衝突時，以明文規範為準。

**(3) Spec 軸來源**：Step 1c 定位到的路徑或已抓取的 issue 內容。該 skill 的流程會要求先讀 `docs/agents/issue-tracker.md` 來找 spec——**本環境沒有這個檔，直接跳過那一步**，spec 來源一律以 Step 1c 的結果為準。Step 1c 判定無 spec 時，明確告知該 skill 跳過 Spec sub-agent。

**(4) Spec 軸 brief 的不變量擴充**：該 skill 在其「Spawn both sub-agents」步驟組 Spec sub-agent prompt 時，原 brief 只含 (a) 規格要求但缺漏／只做一半、(b) 沒被要求卻做了（scope creep）、(c) 看似實作了但實作方式錯誤。組那段 prompt 時，**在 (a)(b)(c) 之外追加 (d) 不變量（invariant）破壞**，內容如下：

> 先從規格推導出「這個功能運作時必須恆成立的事實」清單，至少涵蓋四類：資料一致性（哪些欄位必須同時更新、同時為空）、狀態機合法轉移（哪些狀態不該出現、哪些轉移不允許）、時序假設（誰必須先於誰、重入時會怎樣）、錯誤路徑（失敗後系統該回到什麼狀態）。逐條拿 diff 檢查是否被破壞，每條標「成立／破壞／無法判定」，並附依據（規格行 + `檔案:行號`）。

**完成判準**：Spec 軸每個 finding 都引用了規格的具體行或段落；不變量清單每一條都有「成立／破壞／無法判定」的結論與依據，沒有任何一條留空。

**兩軸產出各自成節、不合併、不 rerank。** 一個變更可以完全符合規範卻實作了錯的東西，也可以完全照規格做卻違反專案慣例；把兩軸合併排序會讓其中一軸遮蔽另一軸。

### Step 3: 專項工具（依規模調度，能平行就平行）

| 順序 | 工具 | 審查面向 | 適用規模 |
|------|------|---------|---------|
| 1 | 內建 `code-review` skill | 正確性 bug 偵測（`args: "high"`） | 所有 |
| 2 | pr-review-toolkit:silent-failure-hunter | 錯誤處理、silent failure 偵測 | 中型＋大型 |
| 3 | pr-review-toolkit:pr-test-analyzer | 測試覆蓋品質、邊界案例 | 中型＋大型 |
| 4 | pr-review-toolkit:type-design-analyzer | 型別設計、invariants | 大型；diff 含大量 type／interface／`z.object` 定義時提前啟用 |

**調度規則：**

- 小型變更（< 50 行）：跑 #1
- 中型變更（50–300 行）：跑 #1–#3
- 大型變更（> 300 行）：跑 #1–#4
- #1 一律以 `args: "high"` 呼叫（不隨規模變動，避免 tool call 參數歧義），用 `Skill` tool 在主對話執行（先跑）；#2–#4 是 subagent，用 `Agent` tool 呼叫，與 Step 4 的兩軸放在同一 message 平行發出。

**effort level 說明：** 預設統一用 `high`（覆蓋較廣）。僅在用戶明確要求「只看高信心問題」時才降為 `medium` / `low`。若用戶要把問題直接發成 GitHub PR inline comment，`args` 用 `"high --comment"`。

**跳過判斷：** 即使規模符合，若變更不涉及特定面向，應跳過對應 agent：

| Agent | 跳過條件 |
|-------|---------|
| #2 silent-failure-hunter | 變更僅涉及樣式/排版（CSS、className），無 API 呼叫或錯誤處理邏輯 |
| #3 pr-test-analyzer | `--name-only` 中無 `*.test.*` / `*.spec.*` 檔案，且無新增需要測試的邏輯 |
| #4 type-design-analyzer | 無新增或修改 `type` / `interface` / `enum` / `z.object` 定義 |

判斷依據來自 Step 1 的 `git diff --name-only` 和 `git diff --stat`。有疑慮時寧可多跑，不要漏掉。

### Step 4: 爆炸半徑軸與無害區對抗挑戰軸

各派一個 `general-purpose` subagent。**這兩軸不隨規模跳過，所有規模都跑**——小型變更正是最容易漏看副作用的地方。有 Step 3 的 #2–#4 要跑時，與它們放在同一 message 平行發出；#2–#4 全被跳過時（例如小型變更），這兩軸單獨發。

這兩軸補的是前面的盲區：Step 2 與 Step 3 檢查的都是 diff 內部是否正確，而實際被人類 reviewer 抓到的致命問題，多半出在 **diff 之外的呼叫點**，以及 **看起來最不需要 review 的 hunk**。

#### 4a. 爆炸半徑軸（blast radius）——diff 外呼叫點的副作用追蹤

brief：

1. 從 diff 列出**所有被修改的匯出符號**：元件、hook、util 函式、API 函式、query key factory、Zod schema、共用型別、匯出常數。
2. 每個符號 grep 全 repo，找出**位在 diff 之外**的呼叫點與引用點（含測試檔與純型別引用）。
3. 逐一呼叫點回答「它原本的假設現在還成立嗎」，至少檢查：props／參數契約有無改變、回傳形狀與可選性、`null`／`undefined` 行為、拋錯行為、React Query 的 query key 與快取失效範圍、呼叫時序與重入。
4. 每個結論附 `檔案:行號` 與判定：未受影響／需調整／已壞。

**完成判準（可逐項對照）**：**每個被改的匯出符號都要有一份呼叫點清單**——即使結論是「diff 之外沒有任何呼叫者」，也要把該符號與這個結論明列出來，不許略過。清單的符號數必須等於步驟 1 列出的符號數。

#### 4b. 無害區對抗挑戰軸（adversarial）

brief：

1. 從 diff 挑 **3–5 個看起來最不需要 review 的 hunk**：純搬移、預設值調整、小條件改動、順手改的樣式、重新命名、多加一個可選參數。愈無聊愈該入選。
2. 對每個入選 hunk **主動生成具體破壞情境並嘗試破壞**，至少涵蓋：連點兩次／重複送出、視窗切回觸發 refetch 蓋掉編輯中的值、空陣列與 `null`／`undefined`、非同步競態、過期的閉包（stale closure）、時區與跨日邊界、極端輸入長度、權限不足的使用者。
3. 每個破壞嘗試都用**讀碼證據或實跑**驗證，不接受「可能會有問題」這種沒有依據的敘述。
4. **每個 finding 都要先被反駁過**：主動替它找一個「其實不會發生」的理由（上游已有防呆、型別已擋掉、該路徑不可達、已有測試覆蓋）。撐過反駁的才寫進 finding；反駁成功的移入「已挑戰未破」清單。

**完成判準（可逐項對照）**：

- 每個入選 hunk 都有「試了哪些破壞情境、各自結果如何」的紀錄，情境數 ≥ 2。
- 每個進入報告的 finding 都註明「用什麼理由反駁過、為何反駁不成立」。
- 「已挑戰未破」清單逐條列出挑戰過但沒破的 hunk 與情境——這是無害區確實驗過的證據，缺這份清單就無法分辨是驗過沒事、還是根本沒看。

### Step 5: 整合報告

依下列順序組報告，完整版型見 `references/output-format-template.md`：

1. `## Spec 軸`、`## Standards 軸`——Step 2 的兩軸產出，各自完整成節，**內容照原樣呈現、不與其他來源去重、不 rerank**。該 skill 輸出的標題是 `## Standards`／`## Spec`，在本報告改寫為 `## Standards 軸`／`## Spec 軸`，順序依本節（Spec 軸在前），內容不動。Spec 軸降級時在此註明「無規格可對照，本軸未執行」。
2. `## 正確性`——Step 3 各工具的 finding 合併：多個來源報同一問題時合併、保留最詳細的描述；依 Critical → High → Medium → Suggestion 排序；每則標註來源工具／agent。
3. `## 副作用（爆炸半徑）`——Step 4a 的匯出符號呼叫點清單與判定。
4. `## 無害區挑戰`——Step 4b 撐過反駁的 finding，末尾附「已挑戰未破」清單。
5. `## 前端專項`——前述工具不一定懂的前端問題，額外補：React re-render 效能（缺少 memo、key 不穩定、在 render 中建立新物件/函式）、Next.js SSR/CSR/SSG 選擇是否合理、bundle size 影響（大型 library 是否有 tree-shakable 替代方案）、瀏覽器相容性與 hydration mismatch 風險。
6. `## 架構與品質門檻合規`——兩部分：

   **(a) 架構規範**：載入 `fe-arch` skill，對新增／搬移的檔案跑其「Code Review 檢查清單」（元件位置、API 三層結構、共用歸屬、`z.infer`、測試放同層 `__tests__/`、`page.tsx` 無邏輯）。分級：檔案位置錯誤 → Minor（建議搬移）；高風險域 API 回應缺邊界 `parse()` → Critical（阻擋合併）。

   **(b) 靜態品質門檻**：對 diff 內新增／修改的函式與檔案，逐項核對 `fe-guardrails/references/thresholds.md` 的數字——函式長度（`.ts` >50 行、`.tsx` >150 行，不含空行註解）、巢狀深度 >4、單檔 >200 行、連續 ≥5 行實質重複、單一函式分支數 >15。

   **完成判準（可逐項對照）**：每一項都要有數字，**沒超標也要寫掃了什麼、實際數字多少**——「掃過 12 支函式，最長 43 行，未超標」。只寫「無異常」會讓人分不出是驗過沒事、還是根本沒看，這跟爆炸半徑與無害區挑戰是同一條原則。

   專案已經裝了對應的 ESLint 規則時，這節可以改成引用 lint 輸出，不必人工重數——但仍要把數字寫進報告。

去重只在第 2 節內部做、不跨節；第 1 節的兩軸永遠獨立。報告風格與篇幅見下方「輸出規範」。

---

## 回饋處理模式

### 核心原則

**技術驗證優先於表演性附和。** 先驗證，再質疑，最後才實作。

### 回應流程

1. 閱讀：完整讀完所有回饋，不急著反應
2. 理解：用自己的話重述需求（或提問釐清）
3. 驗證：對照程式碼庫的實際狀況
4. 評估：在「這個」程式碼庫中技術上是否合理？
5. 回應：技術性確認或有理據的反駁
6. 實作：一次一項，每項都測試

### 處理不明確的回饋

任何項目不明確時，停下來、先提問，**不要先實作已理解的部分**。原因：項目之間可能有關聯，部分理解 = 錯誤實作。

### 外部 Reviewer 的回饋處理

實作之前先檢查：
1. 在「這個」程式碼庫中技術上是否正確？
2. 是否會破壞現有功能？
3. 目前實作方式的原因是什麼？
4. 是否在所有平台/版本上都能運作？
5. reviewer 是否理解完整脈絡？

若建議似乎有誤，用技術理由反駁。若無法輕易驗證，直說：「我無法在沒有 [X] 的情況下驗證這點。要 [調查/詢問/繼續] 嗎？」

### YAGNI 檢查

reviewer 建議「正確地實作」某功能時，先搜尋實際用途。沒被使用就提議移除（「這個端點沒有被呼叫。移除它（YAGNI）？」），有被使用就正確實作。

### 何時該反駁

下列情況應該反駁：建議會破壞現有功能、reviewer 缺乏完整脈絡、違反 YAGNI、在這個技術棧中技術上不正確、存在向下相容的原因、與架構決策衝突。

反駁方式：用技術理由（非防禦心態）、提具體問題、引用正常運作的測試/程式碼。

### 回應語氣（重要）

行動勝於言語，直接修正就是最好的回應。

- ✅ 「已修正。[簡述變更內容]」
- ✅ 「確實有問題——[具體問題]。已在 [位置] 修正。」
- ✅ 重述技術需求後直接行動；有疑問就提問、有問題就反駁
- ❌ 「你說得完全對！」「很好的觀點！」「感謝指出！」等表演性附和
- ❌ 未驗證就說「我來實作」

### 實作順序

多項回饋時：
1. 先釐清所有不明確的項目
2. 依序實作：阻斷性問題（崩潰、安全性）→ 簡單修正（錯字、import）→ 複雜修正（重構、邏輯）
3. 逐項測試每個修正
4. 驗證無回歸問題

---

## 輸出規範

### 篇幅控制
- 整體控制在 150–300 行
- 無重大問題時可更簡潔（150 行內）
- 折疊區塊內容不計入主要篇幅

### 內容優先級
1. 問題說明和改進建議
2. 技術實現關鍵要點
3. 基本功能確認

### 寫作原則
- 單一觀點只說明一次
- 程式碼範例精簡到最小必要範圍
- 評估直接給分數和簡要理由
- 用客觀技術描述，避免「優秀」「完美」等吹捧用詞
- 正面評價簡化為「功能正常」「測試通過」等基本確認
- 改進建議要具體可執行

### 報告撰寫風格（核心）

**讀者預設是不熟悉本專案架構的工程師（含新手）。** 報告要讓人在不了解既有架構的前提下，也能判斷「這到底是不是問題」、並從中學到東西。共用原則（白話先行、術語走名詞補充、不過度吹捧、商業邏輯比喻限導讀、中文文案排版）見 [`_shared/fe-mr-common/writing-principles.md`](../_shared/fe-mr-common/writing-principles.md)「審查語氣」一節，本 skill 額外遵守：

1. **先講脈絡，再講問題**：不要劈頭就用專案內部的模組名 / 抽象層 / 設計模式描述問題。先用一兩句白話說明「這段程式在做什麼、涉及什麼背景」，再指出哪裡不對、會造成什麼後果。
2. **平鋪直述、客觀直白**：用具體後果描述問題（「使用者連點兩次會送出兩筆訂單」），而不是只丟術語結論（「缺少 idempotency 保護」）。
3. **每個問題配程式碼**：finding 緊鄰處貼關鍵 3–5 行 + `file:line`（若審的是 MR，附 GitLab 行號連結），讓 reviewer 不必另開檔案。
4. **帶著教（學習點）**：說明「為什麼這是問題」背後的原理，讓讀者下次能自己看出同類問題。深入的原理說明放進 `<details>` 折疊區塊，避免主文膨脹。
5. **不假設讀者懂架構**：若問題牽涉既有架構決策或慣例，先簡述該架構在做什麼、為何存在，再說新改動為何與它衝突。

判斷標準：把報告給一個沒看過這個專案的前端工程師，他能否光憑報告（不另開檔案）就理解問題、並認同（或有依據地反駁）這是不是問題。做不到就再調整。

### 折疊區塊使用

詳細內容（程式碼範例、測試案例、改進建議實作、技術深度分析）放在 `<details><summary>...</summary>...</details>` 折疊區塊內。

---

## 輸出格式

依照 `references/output-format-template.md` 的結構產出最終報告。
