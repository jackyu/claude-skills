---
name: fe-mr-digest
description: 將已合併的 GitLab MR 轉化為學習筆記，從資深工程師的程式碼和 Review 討論中萃取知識。使用時機：(1) 用戶要求將 MR 整理成學習筆記, (2) 用戶提到 MR 學習、MR 筆記、MR digest, (3) 用戶想從某個 MR 學習工程師的思路或技巧, (4) 用戶提到從 code review 中學習, (5) 用戶想把 MR 當作教材或知識庫素材, (6) 用戶說「這個 MR 寫得不錯，幫我整理一下」。此 skill 的目的不是審查程式碼，而是萃取學習價值——理解工程師怎麼思考、怎麼解決問題、Reviewer 怎麼看待這些決策。即使用戶只是說「幫我看看這個 MR 有什麼值得學的」也應觸發此 skill。
---

# MR Learning Digest

將已合併的 MR 轉化為淺顯易懂的學習筆記，讓新手工程師也能從資深工程師的程式碼和 Review 討論中學習。

## 核心理念

這個 skill 的本質是「學」而非「審」。目標是從每個 MR 中萃取：

- **做了什麼**：這個 MR 解決了什麼問題
- **怎麼做的**：工程師選擇了什麼方案，用了哪些技巧
- **為什麼這樣做**：決策背後的考量，包括「為什麼不用其他方式」
- **Reviewer 怎麼看**：資深工程師審查時關注了什麼，提出了什麼見解

所有內容都用淺顯易懂的方式撰寫，假設讀者是剛入行 1-2 年的前端工程師。技術概念首次出現時，用一句話解釋它是什麼、為什麼重要。

---

## 工作流程

### Step 1: 確認 MR 狀態與取得資訊

執行：

```bash
~/.claude/skills/_shared/fe-mr-common/scripts/mr-context.sh <project_path> <mr_iid> --all-discussions
```

完整用法、選項與補抓腳本見 [`_shared/fe-mr-common/mr-context-usage.md`](../_shared/fe-mr-common/mr-context-usage.md)（學習筆記通常需要已解決討論，故帶 `--all-discussions`）。

**依 State 欄處理**（mr-context.sh 輸出的 MR meta 含 State 欄）：

- `merged` → 直接產出學習筆記
- `opened` → 提醒用戶此 MR 仍在進行中，內容可能還會變動，詢問是否仍要產出
- `closed` → 提醒用戶此 MR 並未被採納，詢問是否想了解為什麼被放棄

### Step 2: 理解 MR 描述

仔細閱讀 MR 的 description，這是作者自己的說明，通常包含：

- 變更的目的和背景
- 實作方式的摘要
- 相關的 Issue 或需求連結

如果 description 寫得好，它就是筆記的骨幹。如果過於簡略，就需要從 diff 和 Review 討論中反推上下文。

### Step 3: 分析程式碼變更

逐一分析 diff 內容，重點不是逐行解讀，而是理解「設計意圖」：

#### 3.1 辨識變更的核心主題

判斷這個 MR 主要在做什麼類型的工作：

| 類型 | 特徵 | 學習重點 |
|------|------|----------|
| 新功能開發 | 新增檔案、新 component、新 API 串接 | 架構設計、資料流、元件切分 |
| 重構優化 | 檔案重命名、邏輯抽離、結構調整 | Before/After 對比、改善的理由 |
| Bug 修復 | 小範圍精確修改、條件判斷調整 | 根因分析、怎麼定位問題 |
| 效能優化 | memo、lazy loading、快取策略 | 效能瓶頸識別、優化手段 |
| 基礎設施 | config、CI/CD、工具鏈 | 工程實踐、DX 提升 |

#### 3.2 萃取技巧與設計決策

從程式碼中找出值得學習的地方，依循 [`_shared/fe-mr-common/good-pattern-catalog.md`](../_shared/fe-mr-common/good-pattern-catalog.md) 的 6 種範式：

1. **抽象化擴用**：inline → 函式/Hook/元件，呼叫點 ≥ 2 或語意完整
2. **語法簡化**：行數 ↓ ≥ 40% 且可讀性未降
3. **型別精緻化**：any → 具名型別、discriminated union、utility types
4. **邊界處理收斂**：分散的 null/error/loading 處理收到單一節點
5. **效能優化（有證據）**：memo/lazy/cache + 明確瓶頸或量化改善
6. **模式套用**：明確採用具名設計模式（Compound、State Machine、Strategy…）

每個範式的判準、範例觸發、反例與格言模板見 catalog，本 skill 在 Step 3 識別時對每個 hotspot 用 catalog 比對。

#### 3.2.1 架構決策（選用）

MR 中若出現符合或違反 `fe-arch` 規範的結構決策（檔案位置、API 三層結構、共用程式碼的提升時機、schema 歸屬），列為「架構決策」類學習點，附上對應的規範條目。判斷不確定時載入 fe-arch 比對，不要自行推測規範內容。

#### 3.3 識別 Before / After 對比機會

如果 MR 涉及重構或優化，提取重構前後的程式碼對比。呈現時要說明：

- 重構前的問題是什麼（可讀性差？耦合高？效能問題？）
- 重構後改善了什麼
- 這個改善為什麼重要

### Step 4: 分析 Review 討論

Review 討論是最有價值的學習素材之一，因為它展示了資深工程師的思考過程。

#### 4.1 擷取有學習價值的討論

不是所有 Review comment 都有學習價值。優先擷取：

- **設計層面的討論**：Reviewer 對架構、抽象、介面設計的看法
- **替代方案的探討**：「有沒有考慮過用 X 方式？」→ 作者的回應
- **知識分享型的留言**：Reviewer 補充的背景知識、最佳實踐、踩坑經驗
- **有建設性分歧的討論**：雙方對某個做法有不同意見，最終如何達成共識

忽略的類型：

- 純粹的 typo 修正或格式調整
- 簡單的 LGTM 或 Approve
- 與學習價值無關的行政性留言

#### 4.2 保留問答脈絡

對於有價值的討論，保留完整的問答脈絡：

```
💬 Reviewer（@reviewer_name）:
[Reviewer 的提問或意見，用自己的話整理，但保留核心觀點]

↩️ Author（@author_name）:
[作者的回應，保留關鍵的解釋和理由]

💬 Reviewer（@reviewer_name）:
[如果有後續討論，繼續保留]
```

在每段討論後加上「📖 學到什麼」，用一兩句話總結這段討論的學習重點。

### Step 5: 推敲「為什麼不這樣做」

從以下線索推敲工程師考慮過但沒有採用的替代方案：

- Review 討論中提到的其他做法
- 程式碼中留下的註解（如 `// 這裡不用 X 是因為...`）
- 從技術經驗推斷合理的替代方案

呈現時使用以下格式：

```
🤔 為什麼不用 [替代方案]？
[解釋為什麼當前方案更適合，替代方案的缺點是什麼]
```

不要為了寫而硬湊，只有在確實有值得討論的替代方案時才寫。

### Step 6: 判斷是否需要流程圖

依 [`_shared/fe-mr-common/diagram-rules.md`](../_shared/fe-mr-common/diagram-rules.md) 的三情境準則決定：

- **資料流變化** → Flowchart
- **狀態流轉** → State Diagram
- **請求流程** → Sequence Diagram

只在資料流／狀態／請求三種情境畫圖，不為畫而畫（UI 元件樹、檔案結構、單純條件分支都不需要圖）。使用 Mermaid + `mcp__figma__generate_diagram` 渲染。

### Step 7: 評估難度分級

依 [`_shared/fe-mr-common/difficulty-levels.md`](../_shared/fe-mr-common/difficulty-levels.md) 標記 🟢 初階 / 🟡 中階 / 🔴 進階。判斷依據是「讀懂變更需要的前置知識」與「改動範圍」，不是行數。

### Step 8: 標記學習標籤

依 [`_shared/fe-mr-common/learning-tags.md`](../_shared/fe-mr-common/learning-tags.md) 從 12 個標籤中選 1-3 個。不貪多、不取「程式語言」標籤、可新增專案專屬標籤但避免氾濫。

---

## 輸出格式

完整模板（含各段落結構、範例佔位符）與段落取捨原則見 [`references/digest-template.md`](references/digest-template.md)。

---

## 寫作原則

輸出遵循 [`_shared/fe-mr-common/writing-principles.md`](../_shared/fe-mr-common/writing-principles.md)「學習導讀語氣」一節（淺顯易懂、聚焦學習價值、尊重原作者）與其中的共用中文文案排版規範。

---

## 特殊情境處理

### MR 描述過於簡略

若 MR 描述不足以理解背景，從以下來源補充：

1. Commit 訊息的脈絡
2. 關聯的 Issue 描述
3. 從 diff 內容反推意圖

在筆記中標注：「此 MR 的描述較為簡潔，以下分析主要基於程式碼變更和 Review 討論。」

### 沒有 Review 討論

如果 MR 沒有任何 Review comment，跳過「Review 精華」段落，不需要特別說明。

### 超大型 MR（超過 500 行變更）

1. 先概述整體變更的架構
2. 聚焦在 2-3 個最有學習價值的重點，不要試圖涵蓋所有變更
3. 在開頭說明：「這是一個較大的 MR，筆記聚焦在最有學習價值的部分。」
