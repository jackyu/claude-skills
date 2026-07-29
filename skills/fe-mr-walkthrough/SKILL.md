---
name: fe-mr-walkthrough
description: 協助 reviewer 在 review 前快速理解 GitLab MR：白話化說明、流程圖輔助、AI 扮演作者答疑、標記值得學習的好做法（可銜接 fe-mr-digest）。使用時機：(1) 用戶說「幫我先看懂這個 MR」「解釋一下這個 MR 在幹嘛」, (2) 用戶提到 MR walkthrough、MR 導讀、MR 理解, (3) 用戶想在 review 前先 brief 自己, (4) 用戶要把 MR 翻譯成 PM/QA 看得懂的版本, (5) 用戶想對 MR 提問但作者不在線, (6) 用戶說「這個 MR 有沒有什麼值得學的」但 MR 尚未合併。
---

# MR Walkthrough

協助 reviewer 在 review 前**理解** MR——產出白話版描述、變更地圖、流程圖、好做法雷達、預備 FAQ，並進入互動問答模式讓 reviewer 把「程式流程／邏輯處理」類的問題在 AI 階段就解掉，把真正屬於商業邏輯／架構決策的疑問留給作者。

## 核心理念

**理解 ≠ 審查 ≠ 學習**。本 skill 不評斷對錯（評斷由 `fe-mr-review` 負責），不要求 MR 已合併（合併後的學習筆記由 `fe-mr-digest` 負責），只做兩件事：

1. **把 MR 翻譯給 reviewer**：白話化技術描述、加上流程圖、補充程式碼解釋
2. **扮演作者答疑**：對程式流程／語法／重構動機等問題即時回答；商業邏輯／架構決策則明確標示「請直接問作者」

與其他 fe-mr-* skill 的分工：

| Skill | 時機 | 視角 | 產出 |
|---|---|---|---|
| `fe-code-review` | 作者推送前 | 多 agent 預審 | review 建議 |
| `fe-mr-review` | review 中 | 找問題 | review comments |
| **`fe-mr-walkthrough`** | **review 前** | **理解** | **導讀報告 + 互動問答** |
| `fe-mr-digest` | 合併後 | 學習 | 完整學習筆記 |

---

## 工作流程

### Step 1：取得 MR 資訊

執行：

```bash
~/.claude/skills/_shared/fe-mr-common/scripts/mr-context.sh <project_path> <mr_iid>
```

完整用法、選項與補抓腳本見 [`_shared/fe-mr-common/mr-context-usage.md`](../_shared/fe-mr-common/mr-context-usage.md)。

**WIP MR 處理**：若 MR 是 Draft / WIP 狀態（mr-context.sh 輸出的 State 欄會標 `(draft)`），照常產出 walkthrough 但在報告開頭標註「⚠️ 此 MR 仍在進行中，內容可能還會變動」。

### Step 2：解析 MR 意圖

從以下線索還原作者腦中模型：

- **Title**：通常是一句話總結，注意 `feat` / `fix` / `refactor` 等前綴
- **Description**：作者自己的解釋（可能含技術術語）
- **Branch name**：常隱含 ticket 編號或功能代號
- **Linked issue**：產品需求或 bug 描述
- **Commit messages**：作者的思考過程切片

寫成「📌 一句話總結」（≤ 30 字）。

### Step 3：白話化重述

依 [`references/plain-language-rules.md`](references/plain-language-rules.md)：

- 移除框架名詞或加上類比解釋（例：「reducer」→「狀態更新規則」）
- 假設讀者是「會用產品但不寫 code」的 PM / QA
- 檢查問題：「讀完這段，PM 能跟主管解釋這個 MR 在改什麼嗎？」

寫成「🗣️ 白話版描述」。

### Step 4：變更地圖

把 diff 中的檔案分組，每組一句話總結：

| 分組 | 檔案數 | 一句話總結 |
|---|---|---|
| 訂單付款流程 | 4 | 把舊的單一付款改成支援多種付款方式 |
| 共用 UI | 2 | 新增 PaymentMethodSelector 元件 |
| 型別定義 | 1 | 新增 `PaymentMethod` discriminated union |

不貼檔案路徑全文，用「功能分組」歸納。

### Step 5：重點區塊白話解釋

從 diff 挑 3-5 個 hotspot（最值得理解的變更區塊）。每個 hotspot：

1. 引用原碼片段（只取關鍵幾行）
2. 用白話文解釋這段在做什麼、為什麼這樣寫
3. 加上信心標記（🟢 / 🟡 / 🔴，見下節）

**hotspot 挑選原則**：選「reviewer 看不懂可能會卡住」的區塊，不選一目了然的純樣式或變數重命名。

### Step 6：判斷是否畫流程圖

依 [`_shared/fe-mr-common/diagram-rules.md`](../_shared/fe-mr-common/diagram-rules.md) 三情境準則：

- **資料流變化** → Flowchart
- **狀態流轉** → State Diagram
- **請求流程** → Sequence Diagram

不為畫而畫。若 MR 沒有改動上述三類流程，跳過這段。使用 Mermaid + `mcp__figma__generate_diagram` 渲染。

### Step 7：好做法雷達

依 [`_shared/fe-mr-common/good-pattern-catalog.md`](../_shared/fe-mr-common/good-pattern-catalog.md) 的 6 種範式掃描 diff：

1. 抽象化擴用
2. 語法簡化
3. 型別精緻化
4. 邊界處理收斂
5. 效能優化（有證據）
6. 模式套用

每筆輸出格式：

```
✨ {範式名稱} | 位置 `path/to/file.tsx:42` | 「{一句格言}」
[ ] 值得存成 digest 筆記？ → /fe-mr-digest <MR_URL>
```

reviewer 可在報告中勾選，事後一次接 `fe-mr-digest` 產出完整學習筆記。

### Step 8：預備 FAQ

預測 reviewer 可能會問的 5 個問題並自答。常見題庫見 [`assets/faq-prompts.md`](assets/faq-prompts.md)。每題附上：

- 問題（用 reviewer 口吻）
- 自答（用「我的理解是…」開頭）
- 信心等級 🟢 / 🟡 / 🔴

### Step 9：進入互動問答模式

報告末尾固定附上 3-5 題「建議問題」+「自由提問提示」。reviewer 可直接打字或回應編號。

互動規則見 [`references/qa-protocol.md`](references/qa-protocol.md)。每次回答遵循「AI 扮演作者的信心三級」（見下節），並把 🔴 等級的問題累積進「待詢問作者清單」，session 結束時整理輸出。

---

## AI 扮演作者的信心三級

完整守則見 [`references/author-roleplay.md`](references/author-roleplay.md)。

| 等級 | 範圍 | 回答方式 |
|---|---|---|
| 🟢 高信心 | 程式流程、語法、明顯 refactor 動機（DRY、抽 hook）、library API 行為、TypeScript 編譯器行為 | 直接回答 |
| 🟡 推測 | 命名選擇、檔案組織、為何不用某方案、樣式取捨 | 「我的理解是…，建議跟作者確認」 |
| 🔴 必須問作者 | 商業規則、外部合約/SLA、產品優先序、跨系統相依、為何不做某功能 | 「此屬商業/架構決策，無法從 code 推斷，請直接詢問 @{author}」並加入待詢問清單 |

**禁忌**：禁用「作者說」「作者認為」這種偽造引用。用「我的理解是」「推測作者用意」開頭。

---

## 輸出格式

完整範本見 [`assets/walkthrough-report.md`](assets/walkthrough-report.md)。報告由 8 個區塊組成：

1. **📌 一句話總結**（≤ 30 字）
2. **🗣️ 白話版描述**（給 PM/QA 看）
3. **🗺️ 變更地圖**（檔案功能分組）
4. **🔍 重點區塊白話解釋**（3-5 個 hotspot，含信心標記）
5. **📊 流程圖**（條件出現）
6. **✨ 好做法雷達**（含 digest 銜接 checkbox）
7. **❓ 預備 FAQ**（5 題自答 + 信心等級）
8. **🚪 進入問答模式**（建議問題 + 自由提問提示）

互動結束時，自動補上：

9. **🔴 待詢問作者清單**（互動中累積的 🔴 問題，可複製成 MR comment）

---

## 特殊情境

### 無 description 的 MR

不阻擋產出。在報告開頭標註「⚠️ 此 MR 描述空白，以下分析主要基於程式碼與 commit messages」，並在「白話版描述」段落明確標 🟡，建議向作者確認意圖。

### 超大 MR（> 500 行變更）

- 變更地圖按功能分組後，挑 2-3 個最值得理解的分組做 hotspot 解釋
- 報告開頭標註「📦 大型 MR，本導讀聚焦在 X、Y、Z 三個分組，其他變更略過」
- 流程圖只畫最關鍵的一張

### WIP / Draft MR

照常產出，但所有「好做法雷達」項目都加註「⏳ MR 未定稿，最終實作可能變動」。

### 無 linked issue 的 MR

從 branch name 與 commit messages 反推需求，意圖推測明確標 🟡。

---

## 與其他 skill 銜接

報告末尾固定提示：

- **發現需要評斷對錯** → `/fe-mr-review`（產出 review comments）
- **好做法雷達勾選了項目** → `/fe-mr-digest <MR_URL>`（即使 MR 未合併也可預先草擬）
- **互動中累積的 🔴 待詢問清單** → 直接複製到 MR comment 留言給作者

---

## 寫作原則

輸出遵循 [`_shared/fe-mr-common/writing-principles.md`](../_shared/fe-mr-common/writing-principles.md)「學習導讀語氣」一節（淺顯易懂、聚焦理解價值、尊重原作者）與其中的共用中文文案排版規範。
