---
name: fe-mr-read
description: 讀懂一張 GitLab MR，需要的話再把它沉澱成 Heptabase 學習筆記。先導讀（白話化說明、變更地圖、流程圖、AI 扮演作者答疑、好做法雷達），結束時問一次要不要存筆記，要的話補 Review 討論分析、「為什麼不這樣做」、難度與學習標籤寫進 Heptabase。MR 開著、合併或關閉都能用。使用時機：(1) 用戶說「幫我先看懂這個 MR」「解釋一下這個 MR 在幹嘛」, (2) 用戶提到 MR 導讀、MR walkthrough、MR 理解, (3) 用戶想在 review 前先 brief 自己, (4) 用戶要把 MR 翻譯成 PM/QA 看得懂的版本, (5) 用戶想對 MR 提問但作者不在線, (6) 用戶要把 MR 整理成學習筆記、提到 MR 學習、MR 筆記、MR digest, (7) 用戶想從某個 MR 學工程師的思路或技巧、從 code review 討論中學習, (8) 用戶說「這個 MR 有什麼值得學的」「這個 MR 寫得不錯，幫我整理一下」。
disable-model-invocation: true
---

# MR Read

讀懂一張 MR，必要時存成學習筆記。分三段：

1. **Phase 1 導讀**：把 MR 翻譯給讀者看，扮演作者答疑。不評斷對錯，不要求 MR 已合併
2. **Phase 2 問要不要存筆記**：問一次，不要就停
3. **Phase 3 學習筆記**：沿用 Phase 1 的結果，補 Review 討論、「為什麼不這樣做」、難度、標籤，寫進 Heptabase

## 核心理念

**理解 ≠ 審查**。評斷對錯是 `fe-mr-review` 的事。本 skill 只做三件事：

1. **把 MR 翻譯給讀者**：白話化技術描述、加上流程圖、補充程式碼解釋
2. **扮演作者答疑**：程式流程、語法、重構動機這類問題當場回答；商業邏輯、架構決策明確標「請直接問作者」
3. **把學到的東西留下來**：從程式碼與 Review 討論萃取「做了什麼、怎麼做、為什麼這樣做、Reviewer 怎麼看」

與其他 fe-mr-* skill 的分工：

| Skill | 時機 | 視角 | 產出 |
|---|---|---|---|
| `fe-code-review` | 作者推送前 | 多 agent 預審 | review 建議 |
| **`fe-mr-read` Phase 1** | **review 前** | **理解** | **導讀報告 + 互動問答** |
| `fe-mr-review` | review 中 | 找問題 | review comments |
| **`fe-mr-read` Phase 3** | **導讀或 review 之後** | **學習** | **Heptabase 學習筆記** |

---

## Phase 1：導讀

各步驟完整做法見 [`references/walkthrough-steps.md`](references/walkthrough-steps.md)。

1. **取得 MR 資訊**：`mr-context.sh <project_path> <mr_iid> --all-discussions`。一律帶 `--all-discussions`，Phase 3 直接沿用，不重抓。記下 State 欄
2. **解析意圖**：從 title、description、branch、linked issue、commit messages 還原作者想做什麼，寫成「📌 一句話總結」（≤ 30 字）
3. **白話化重述**：依 [`references/plain-language-rules.md`](references/plain-language-rules.md) 寫「🗣️ 白話版描述」，讀者是會用產品但不寫 code 的 PM／QA
4. **變更地圖**：檔案按功能分組，每組一句話
5. **重點區塊白話解釋**：挑 3-5 個 reviewer 會卡住的 hotspot，每個附信心標記
6. **判斷是否畫流程圖**：只在資料流、狀態流轉、請求流程三種情境畫，不為畫而畫
7. **好做法雷達**：依 good-pattern-catalog 6 種範式掃 diff，每筆附「值得寫進學習筆記？」checkbox
8. **預備 FAQ**：預測 5 題並自答，信心等級要有高有低
9. **互動問答**：依 [`references/qa-protocol.md`](references/qa-protocol.md) 進問答迴圈，🔴 問題累積成待詢問作者清單

報告格式見 [`assets/walkthrough-report.md`](assets/walkthrough-report.md)，由這幾段組成：

1. **📌 一句話總結**
2. **🗣️ 白話版描述**（給 PM／QA 看）
3. **🗺️ 變更地圖**
4. **🔍 重點區塊白話解釋**（含信心標記）
5. **📊 流程圖**（條件出現）
6. **✨ 好做法雷達**（含學習筆記 checkbox）
7. **❓ 預備 FAQ**
8. **🚪 進入問答模式**
9. **🔴 待詢問作者清單**（問答結束時補上）

### AI 扮演作者的信心三級

完整守則見 [`references/author-roleplay.md`](references/author-roleplay.md)。

| 等級 | 範圍 | 回答方式 |
|---|---|---|
| 🟢 高信心 | 程式流程、語法、明顯 refactor 動機（DRY、抽 hook）、library API 行為、TypeScript 編譯器行為 | 直接回答 |
| 🟡 推測 | 命名選擇、檔案組織、為何不用某方案、樣式取捨 | 「我的理解是…，建議跟作者確認」 |
| 🔴 必須問作者 | 商業規則、外部合約/SLA、產品優先序、跨系統相依、為何不做某功能 | 「此屬商業/架構決策，無法從 code 推斷，請直接詢問 @{author}」並加入待詢問清單 |

**禁忌**：禁用「作者說」「作者認為」這種偽造引用。用「我的理解是」「推測作者用意」開頭。

---

## Phase 2：問要不要存筆記

問答結束時（使用者打「結束」「夠了」，或換話題、換 skill），整理完 🔴 清單後問**一次**：

> 要不要把這次導讀存成 Heptabase 學習筆記？勾選的好做法和 🔴 清單會一起帶進去。

- 不要 → 停，不再提
- 要 → 進 Phase 3
- 問答中使用者主動說「幫我做成筆記」→ 視同結束問答並答應，直接進 Phase 3

---

## Phase 3：學習筆記

各步驟完整做法見 [`references/learning-note.md`](references/learning-note.md)，筆記模板見 [`references/digest-template.md`](references/digest-template.md)。

**不重做 Phase 1**：白話重述、變更地圖、hotspot 解釋、流程圖、好做法雷達直接搬進筆記，不重讀 diff、不重新解釋。Phase 3 只補 Phase 1 沒有的東西：

1. **盤點 Phase 1 素材**：對照表見 learning-note.md Step N1
2. **補程式碼分析**：辨識變更類型（新功能／重構／Bug 修復／效能／基礎設施）、架構決策（選用，對照 fe-arch）、重構類才做 Before／After
3. **分析 Review 討論**：用 Phase 1 抓到的 `--all-discussions` 輸出，擷取設計討論、替代方案、知識分享、建設性分歧，保留問答脈絡並加「📖 學到什麼」
4. **推敲「為什麼不這樣做」**：有值得討論的替代方案才寫
5. **難度與學習標籤**：依 difficulty-levels 標難度、依 learning-tags 選 1-3 個標籤
6. **決定筆記狀態**：
   - `merged` → 寫合併日期
   - `opened`（含 Draft）→ 標「草稿，MR 未合併」
   - `closed` → 標「MR 已關閉、未合併」，加一段「為什麼被放棄」
7. **寫進 Heptabase**：`ToolSearch select:mcp__heptabase-mcp__create_object` 載入工具，`objectType: card` 建卡；第一行 h1 標題、第二行 `#標籤`；表格一律包 `<hepta-table tokenId="new" hasColumnHeader="true">…</hepta-table>`，多張用 `new-0`、`new-1`。MCP 不在或建卡失敗就落 `<repo 根目錄>/.claude/notes/<project_name>/mr-read-<iid>-<YYYY-MM-DD>.md`，拿掉 `<hepta-table>` 標籤。寫完 re-read 確認才回報「已寫入」

筆記寫完，對話只給 3 句摘要＋卡片標題或檔案路徑。

---

## 從 fe-mr-review 直接進 Phase 3

`fe-mr-review` 審完會問使用者要不要存學習筆記，使用者說要時直接跑本 skill 的 Phase 3，不經過 Phase 1 的互動問答。本 skill 設了 `disable-model-invocation`，Skill 工具載入不了，`fe-mr-review` 要用 Read 讀本檔與 `references/learning-note.md`、`references/digest-template.md` 照做。

這種進法只有 MR URL 或 iid，Phase 1 的素材不存在，所以 Phase 3 先自己補最少的理解：

1. **取 MR 資訊**：對話裡已有這張 MR 的 `mr-context.sh` 輸出（`fe-mr-review` 剛跑過）就沿用；沒有帶 `--all-discussions` 的話，補抓一次 `--all-discussions` 拿已解決的討論
2. **意圖**：照 Phase 1 Step 2 寫一句話總結
3. **變更地圖**：照 Phase 1 Step 4 分組
4. 其餘段落（關鍵實作、流程圖、值得學習的技巧）由 Phase 3 自己的分析產出：hotspot 照 Phase 1 Step 5 的挑法、流程圖照 diagram-rules、技巧照 good-pattern-catalog，但不產出 FAQ，也不進問答
5. 接著照 Phase 3 第 2 步以後做

review 找到的問題不是學習素材，不放進筆記；筆記仍用學習導讀語氣，不用審查語氣。

---

## 特殊情境

### 無 description 的 MR

不阻擋產出。導讀報告開頭標註「⚠️ 此 MR 描述空白，以下分析主要基於程式碼與 commit messages」，「白話版描述」明確標 🟡，建議向作者確認意圖。筆記也從 commit 訊息、關聯 Issue、diff 反推，開頭註明「此 MR 的描述較為簡潔，以下分析主要基於程式碼變更和 Review 討論。」

### 超大 MR（> 500 行變更）

- 變更地圖按功能分組後，挑 2-3 個最值得理解的分組做 hotspot 解釋
- 報告開頭標註「📦 大型 MR，本導讀聚焦在 X、Y、Z 三個分組，其他變更略過」
- 流程圖只畫最關鍵的一張
- 筆記開頭說明「這是一個較大的 MR，筆記聚焦在最有學習價值的部分。」

### WIP／Draft MR

照常產出，「好做法雷達」項目都加註「⏳ MR 未定稿，最終實作可能變動」。存筆記時標「草稿，MR 未合併」。

### 無 linked issue 的 MR

從 branch name 與 commit messages 反推需求，意圖推測明確標 🟡。

### 沒有 Review 討論

筆記跳過「Review 精華」段落，不需要特別說明。

---

## 與其他 skill 銜接

導讀報告末尾固定提示：

- **發現需要評斷對錯** → `/fe-mr-review`（產出 review comments）
- **互動中累積的 🔴 待詢問清單** → 直接複製到 MR comment 留言給作者
- **想存學習筆記** → 問答結束時會問（Phase 2），不用另外下指令

---

## 寫作原則

輸出遵循 [`_shared/fe-mr-common/writing-principles.md`](../_shared/fe-mr-common/writing-principles.md)「學習導讀語氣」一節（淺顯易懂、聚焦理解與學習價值、尊重原作者）與其中的共用中文文案排版規範。筆記假設讀者是剛入行 1-2 年的前端工程師，技術概念首次出現時用一句話解釋。
