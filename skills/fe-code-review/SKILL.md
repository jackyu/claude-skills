---
name: fe-code-review
description: 前端程式碼審查 Orchestrator，串接內建 /code-review 與多個專業 Plugin Agents 進行全面 review。使用時機：(1) 用戶要求 code review、審查、檢查程式碼品質, (2) 用戶提到 review 或請求 MR/PR 審查, (3) 用戶說「幫我看一下這個 branch」「review 一下」「檢查一下程式碼」等非正式用語, (4) 收到外部 code review 回饋需要評估與回應、處理 reviewer 意見, (5) 用戶跑完內建 /code-review 或 pr-review-toolkit 後想要整合成完整報告。即使用戶沒有明確說「code review」，只要意圖是檢視程式碼變更的品質，就應該觸發此 skill。
---

# Frontend Code Review

串接內建 `/code-review` 與專業 Plugin Agents 進行全面的前端程式碼審查，並保留獨特的 Review 回饋處理準則。

## 工具呼叫方式

本 skill 混用兩種機制：

- **內建 `/code-review` skill**：用 `Skill` tool 呼叫，**`skill` 固定為 `code-review`，`args` 固定帶 effort level 字串，預設一律用 `high`**（即 `args: "high"`）。負責正確性 bug 偵測，在主對話中執行。
  - effort level **務必當作 `args` 傳入**，不要寫進 `skill` 名稱（寫成 `code-review high` 會導致 tool call 無法解析）。
  - 若要把問題直接發成 GitHub PR inline comment，`args` 改為 `"high --comment"`。
  - 因在主對話執行，先跑、不與 subagent 平行。
- **Plugin subagents**：用 `Agent` tool 調度，透過 `subagent_type` 參數指定（如 `pr-review-toolkit:code-reviewer`）。無依賴的 agents 在同一 message 平行呼叫。

## 模式判定

根據用戶意圖判定執行模式：

- **審查模式**：用戶要求做 code review、審查程式碼品質 → 執行 Plugin 審查流程
- **回饋處理模式**：用戶收到 review 回饋要處理、回應 reviewer 的意見 → 執行回饋處理流程

---

## 審查模式

### Step 1: 前置步驟

取得變更概覽，判斷變更規模：

```bash
BASE_BRANCH="origin/main"  # 或用戶指定的分支
git log "$BASE_BRANCH..HEAD" --pretty=format:"- %h %s"
git diff "$BASE_BRANCH..HEAD" --stat
git diff "$BASE_BRANCH..HEAD" --name-only
```

根據 `--stat` 輸出的總變更行數判斷規模：
- **小型**：< 50 行
- **中型**：50–300 行
- **大型**：> 300 行

### Step 2: 執行審查

依變更規模調度以下審查工具：

| 順序 | 工具 | 審查面向 | 適用規模 |
|------|------|---------|---------|
| 1 | 內建 `/code-review` skill | 正確性 bug 偵測（`args: "high"`） | 所有 |
| 2 | pr-review-toolkit:code-reviewer | CLAUDE.md 合規、專案慣例、整體品質 | 所有 |
| 3 | pr-review-toolkit:silent-failure-hunter | 錯誤處理、silent failure 偵測 | 中型＋大型 |
| 4 | pr-review-toolkit:pr-test-analyzer | 測試覆蓋品質、邊界案例 | 中型＋大型 |
| 5 | pr-review-toolkit:type-design-analyzer | 型別設計、invariants | 大型 |
| 6 | pr-review-toolkit:comment-analyzer | 註解準確性、技術債 | 大型 |

**調度規則：**
- 小型變更（< 50 行）：跑 #1 + #2
- 中型變更（50–300 行）：跑 #1 + #2–#4
- 大型變更（> 300 行）：跑 #1 + #2–#6
- #1 一律以 `args: "high"` 呼叫（不隨規模變動，避免 tool call 參數歧義），用 `Skill` tool 在主對話執行（先跑）；其餘無依賴的 plugin subagents 用 `Agent` tool 平行呼叫（#2 與 #3–#6 可平行）

**effort level 說明：** 預設統一用 `high`（覆蓋較廣）。僅在用戶明確要求「只看高信心問題」時才降為 `medium` / `low`。若用戶要把問題直接發成 GitHub PR inline comment，`args` 用 `"high --comment"`。

**跳過判斷：** 即使規模符合，若變更不涉及特定面向，應跳過對應 agent：

| Agent | 跳過條件 |
|-------|---------|
| #3 silent-failure-hunter | 變更僅涉及樣式/排版（CSS、className），無 API 呼叫或錯誤處理邏輯 |
| #4 pr-test-analyzer | `--name-only` 中無 `*.test.*` / `*.spec.*` 檔案，且無新增需要測試的邏輯 |
| #5 type-design-analyzer | 無新增或修改 `type` / `interface` / `enum` / `z.object` 定義 |
| #6 comment-analyzer | 變更中無新增或修改 JSDoc / 多行註解 / README |

判斷依據來自 Step 1 的 `git diff --name-only` 和 `git diff --stat`。有疑慮時寧可多跑，不要漏掉。

### Step 3: 整合審查結果

將 `/code-review` 與各 plugin agent 的輸出整合成統一報告：

1. **去重**：多個來源報告同一問題時合併（例如 `/code-review` 與 code-reviewer 都抓到的 bug），保留最詳細的描述
2. **排序**：Critical → High → Medium → Suggestion
3. **來源標註**：每個問題標註來自哪個工具 / agent
4. **前端補充**：`/code-review` 與 plugin agents 不一定了解前端特有問題，需額外補充：
   - React re-render 效能（缺少 memo、key 不穩定、在 render 中建立新物件/函式）
   - Next.js SSR/CSR/SSG 選擇是否合理
   - Bundle size 影響（大型 library 是否有 tree-shakable 替代方案）
   - 瀏覽器相容性與 hydration mismatch 風險
5. **架構規範合規**：載入 `fe-arch` skill，對新增／搬移的檔案跑其「Code Review 檢查清單」（元件位置、API 三層結構、共用歸屬、`z.infer`、測試放同層 `__tests__/`、`page.tsx` 無邏輯）。分級：檔案位置錯誤 → Minor（建議搬移）；高風險域 API 回應缺邊界 `parse()` → Critical（阻擋合併）

### Step 4: 輸出

使用下方「輸出格式」產出最終報告。

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

**讀者預設是不熟悉本專案架構的工程師（含新手）。** 報告要讓人在不了解既有架構的前提下，也能判斷「這到底是不是問題」、並從中學到東西。共用原則見 [`_shared/fe-mr-common/review-writing-principles.md`](../_shared/fe-mr-common/review-writing-principles.md)，本 skill 額外遵守：

1. **先講脈絡，再講問題**：不要劈頭就用專案內部的模組名 / 抽象層 / 設計模式描述問題。先用一兩句白話說明「這段程式在做什麼、涉及什麼背景」，再指出哪裡不對、會造成什麼後果。
2. **平鋪直述、客觀直白**：用具體後果描述問題（「使用者連點兩次會送出兩筆訂單」），而不是只丟術語結論（「缺少 idempotency 保護」）。
3. **每個問題配程式碼**：finding 緊鄰處貼關鍵 3–5 行 + `file:line`（若審的是 MR，附 GitLab 行號連結），讓 reviewer 不必另開檔案。
4. **白話先行、術語走名詞補充**：句子先用白話把事情講懂，第一次出現的術語用「中文 (English)」格式；需要展開的複雜術語不塞進主句，放到該段／該 finding 末的「名詞補充」當學習素材。語氣與表達細則（不過度吹捧、形容詞克制、改寫前後範例）詳見共用檔 [`review-writing-principles.md`](../_shared/fe-mr-common/review-writing-principles.md) §1。
5. **帶著教（學習點）**：說明「為什麼這是問題」背後的原理，讓讀者下次能自己看出同類問題。深入的原理說明放進 `<details>` 折疊區塊，避免主文膨脹。
6. **商業邏輯用比喻（限導讀）**：在「摘要」用「就像…」幫讀者建立心智模型，與精確描述並存；技術細節區維持精確，不硬套比喻。
7. **不假設讀者懂架構**：若問題牽涉既有架構決策或慣例，先簡述該架構在做什麼、為何存在，再說新改動為何與它衝突。

判斷標準：把報告給一個沒看過這個專案的前端工程師，他能否光憑報告（不另開檔案）就理解問題、並認同（或有依據地反駁）這是不是問題。做不到就再調整。

### 折疊區塊使用

詳細內容（程式碼範例、測試案例、改進建議實作、技術深度分析）放在 `<details><summary>...</summary>...</details>` 折疊區塊內。

## 中文文案排版規範

依循 [中文文案排版指北](https://github.com/sparanoid/chinese-copywriting-guidelines)：

### 空格
- 中英文之間加空格：`使用 React 開發` 而非 `使用React開發`
- 中文與數字之間加空格：`共 5 個檔案` 而非 `共5個檔案`
- 數字與單位之間加空格：`10 MB` 而非 `10MB`
- 例外：度數/百分比不加空格：`15°C`、`100%`

### 標點符號
- 使用全形標點：，、。；：「」
- 數字使用半形：`2024 年 1 月`
- 遇括號或引號，外側加空格：`核心（Core）模組`

### 專有名詞
- 使用官方大小寫：`GitHub`、`JavaScript`、`iOS`
- 不要全大寫：`GITHUB` ✗

---

## 輸出格式

依照 `references/output-format-template.md` 的結構產出最終報告。
