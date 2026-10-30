# Phase 1 導讀步驟細節

`SKILL.md` Phase 1 各步驟的完整做法。步驟編號與 `SKILL.md` 一致。

## Step 1：取得 MR 資訊

```bash
~/.claude/skills/_shared/fe-mr-common/scripts/mr-context.sh <project_path> <mr_iid> --all-discussions
```

一律帶 `--all-discussions`：預備 FAQ 要看已解決的討論避免重複，Phase 3 的 Review 精華也要用，抓一次就好，Phase 3 不再重抓。完整用法、選項與補抓腳本見 [`_shared/fe-mr-common/mr-context-usage.md`](../../_shared/fe-mr-common/mr-context-usage.md)。

記下 State 欄（`merged`／`opened`／`closed`，Draft 會標 `(draft)`），Phase 3 決定筆記狀態要用。

**WIP MR 處理**：若 MR 是 Draft／WIP，照常產出導讀，但在報告開頭標註「⚠️ 此 MR 仍在進行中，內容可能還會變動」。

## Step 2：解析 MR 意圖

從以下線索還原作者腦中模型：

- **Title**：通常是一句話總結，注意 `feat`／`fix`／`refactor` 等前綴
- **Description**：作者自己的解釋（可能含技術術語）
- **Branch name**：常隱含 ticket 編號或功能代號
- **Linked issue**：產品需求或 bug 描述
- **Commit messages**：作者的思考過程切片

寫成「📌 一句話總結」（≤ 30 字）。

## Step 3：白話化重述

依 [`plain-language-rules.md`](plain-language-rules.md)：

- 移除框架名詞或加上類比解釋（例：「reducer」→「狀態更新規則」）
- 假設讀者是「會用產品但不寫 code」的 PM／QA
- 檢查問題：「讀完這段，PM 能跟主管解釋這個 MR 在改什麼嗎？」

寫成「🗣️ 白話版描述」。

## Step 4：變更地圖

把 diff 中的檔案分組，每組一句話總結：

| 分組 | 檔案數 | 一句話總結 |
|---|---|---|
| 訂單付款流程 | 4 | 把舊的單一付款改成支援多種付款方式 |
| 共用 UI | 2 | 新增 PaymentMethodSelector 元件 |
| 型別定義 | 1 | 新增 `PaymentMethod` discriminated union |

不貼檔案路徑全文，用「功能分組」歸納。

## Step 5：重點區塊白話解釋

從 diff 挑 3-5 個 hotspot（最值得理解的變更區塊）。每個 hotspot：

1. 引用原碼片段（只取關鍵幾行）
2. 用白話文解釋這段在做什麼、為什麼這樣寫（三段格式見 [`plain-language-rules.md`](plain-language-rules.md) 結尾）
3. 加上信心標記（🟢／🟡／🔴，見 `SKILL.md`「AI 扮演作者的信心三級」）

**hotspot 挑選原則**：選「reviewer 看不懂可能會卡住」的區塊，不選一目了然的純樣式或變數重命名。

## Step 6：判斷是否畫流程圖

依 [`_shared/fe-mr-common/diagram-rules.md`](../../_shared/fe-mr-common/diagram-rules.md) 三情境準則：

- **資料流變化** → Flowchart
- **狀態流轉** → State Diagram
- **請求流程** → Sequence Diagram

不為畫而畫。若 MR 沒有改動上述三類流程，跳過這段（UI 元件樹、檔案結構、單純條件分支都不需要圖）。使用 Mermaid + `mcp__figma__generate_diagram` 渲染。

## Step 7：好做法雷達

依 [`_shared/fe-mr-common/good-pattern-catalog.md`](../../_shared/fe-mr-common/good-pattern-catalog.md) 的 6 種範式掃描 diff：

1. 抽象化擴用
2. 語法簡化
3. 型別精緻化
4. 邊界處理收斂
5. 效能優化（有證據）
6. 模式套用

每筆輸出格式：

```
✨ {範式名稱} | 位置 `path/to/file.tsx:42` | 「{一句格言}」
[ ] 值得寫進學習筆記？
```

reviewer 可在報告中勾選；Phase 3 寫筆記時，勾選的項目優先放進「✨ 值得學習的技巧」。

## Step 8：預備 FAQ

預測 reviewer 可能會問的 5 個問題並自答。常見題庫見 [`../assets/faq-prompts.md`](../assets/faq-prompts.md)。每題附上：

- 問題（用 reviewer 口吻）
- 自答（用「我的理解是…」開頭）
- 信心等級 🟢／🟡／🔴

## Step 9：進入互動問答模式

報告末尾固定附上 3-5 題「建議問題」+「自由提問提示」。reviewer 可直接打字或回應編號。

互動規則見 [`qa-protocol.md`](qa-protocol.md)。每次回答遵循 `SKILL.md`「AI 扮演作者的信心三級」，並把 🔴 等級的問題累積進「待詢問作者清單」，問答結束時整理輸出，接著進 Phase 2。
