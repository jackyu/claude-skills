# FE Code Review

> 前端程式碼審查 Orchestrator：Spec／Standards 兩軸主幹，加上爆炸半徑與無害區對抗挑戰

## Purpose

以 Orchestrator 角色調度多個審查來源，整合為統一報告。主幹是 `mattpocock-skills:code-review` 的兩軸審查（Spec 軸／Standards 軸，兩軸分節不互相遮蔽），外加內建 `/code-review` 與 pr-review-toolkit 專項 agent 補正確性，再由兩個自訂軸補上「diff 之外」的視角：爆炸半徑（被改的匯出符號在 diff 外的呼叫點還安不安全）與無害區對抗挑戰（挑最不起眼的 hunk 主動破壞）。同時保留收到外部 code review 回饋時的處理準則，強調技術驗證優先於表演性附和。

## When to Use

- 用戶要求 code review
- 用戶提交程式碼變更請求審查
- 用戶提到 review、審查、檢視程式碼品質
- 用戶問「這個改動會影響到哪」「有沒有漏看的副作用」「規格有沒有實作到」
- 收到外部 code review 回饋需要評估與回應

## Entry Points

- **`/cr [fixed-point] [spec 路徑]`** — 薄入口命令（`~/.claude/commands/cr.md`），只解析參數後呼叫本 skill，流程單一來源在 SKILL.md。
- 直接觸發本 skill（符合上方 When to Use 的用語即可）。

## Modes

### 審查模式

五個 Step：

| Step | 內容 |
|------|------|
| 1 | 前置：固定基準點（fail-fast，ref 不可解析或 diff 為空就停）、規模判定（大型變更額外判「該不該拆」）、spec 來源定位 |
| 2 | 主幹兩軸：呼叫 `mattpocock-skills:code-review`，餵入本環境的 Standards 來源（含 `fe-guardrails` 的門檻數字）與 spec 來源，並在 Spec 軸 brief 追加「不變量破壞」檢查 |
| 3 | 專項工具：依規模調度內建 `/code-review` 與 pr-review-toolkit agents |
| 4 | 爆炸半徑軸與無害區對抗挑戰軸（各一個 `general-purpose` subagent，與 Step 3 平行） |
| 5 | 整合報告：兩軸分節不 rerank，其餘依嚴重度排序；末節核對架構規範與靜態品質門檻 |

調度的審查來源：

| 來源 | 審查面向 | 適用規模 |
|------|---------|---------|
| `mattpocock-skills:code-review` → Spec 軸 | 規格缺漏、scope creep、實作走樣、不變量破壞 | 所有 |
| `mattpocock-skills:code-review` → Standards 軸 | `~/.claude/rules/*.md`、fe-arch、專案 CLAUDE.md 合規 + Fowler smell baseline | 所有 |
| 內建 `/code-review` skill | 正確性 bug 偵測（`args: "high"`） | 所有 |
| pr-review-toolkit:silent-failure-hunter | 錯誤處理、silent failure 偵測 | 中型＋大型 |
| pr-review-toolkit:pr-test-analyzer | 測試覆蓋品質、邊界案例 | 中型＋大型 |
| pr-review-toolkit:type-design-analyzer | 型別設計、invariants | 大型（型別重的 diff 提前啟用） |
| 爆炸半徑軸（`general-purpose`） | 被改匯出符號在 diff 外的呼叫點是否還安全 | 所有 |
| 無害區對抗挑戰軸（`general-purpose`） | 挑最不起眼的 hunk 主動破壞，finding 須存活反駁 | 所有 |

### 回饋處理模式

收到 review 回饋時的結構化處理流程（閱讀、理解、驗證、評估、回應、實作），包含 YAGNI 檢查與反駁準則。

## Key Features

- 兩軸主幹：Spec 軸與 Standards 軸分節呈現、不合併 rerank，避免一軸的通過遮蔽另一軸的失敗
- 爆炸半徑追蹤：每個被改的匯出符號都要交出呼叫點清單，結論是「無 diff 外呼叫者」也要明列
- 無害區對抗挑戰：finding 必須先被自己反駁過才進報告，反駁成功的寫進「已挑戰未破」清單當作驗過的證據
- 靜態品質門檻用數字判定：函式長度、巢狀深度、單檔行數、重複邏輯、條件複雜度都對照 [`fe-guardrails`](../fe-guardrails/) 的門檻表，沒超標也要寫出實測值
- 大型變更主動判「該不該拆」：三項判準都不成立時要明說「已評估，不建議拆」
- 依變更規模智慧調度專項 agent，無依賴者平行執行
- 整合結果去重（僅在正確性一節內）、排序（Critical → Suggestion）、來源標註
- 白話文報告：先講脈絡再講問題、術語附白話、帶學習點，讓不熟架構的工程師（含新手）也能判斷與學習
- 完整的回饋處理準則（技術驗證優先）
- 中文文案排版規範（中英文間距、全形標點等）
- 結構化輸出格式，含折疊區塊和篇幅控制

## Design Rationale

兩個自訂軸的存在理由：vibe coding 的變更常在「看似無害」處被人類 reviewer 抓出致命問題。差別在於資深 reviewer 拿 diff 對照的是**系統不變量**與**跨功能耦合**，而不是 diff 內的孤立正確性。

「批判性思考」「第一性原理」這類要求若只寫成口號，對執行者是 no-op。本 skill 把它們拆成可檢核的程序：第一性原理 → Spec 軸的不變量推導與逐條結論；批判性思考 → 爆炸半徑的符號／呼叫點對照清單，與無害區的破壞情境加反駁存活機制。判準都寫成可逐項對照的形式（清單數量相符、每條都有結論、每個 finding 都有反駁紀錄）。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Main skill instructions |
| `references/output-format-template.md` | 報告版型，節次對應 SKILL.md Step 5 |
| `evals/evals.json` | 觸發與流程行為的評測案例 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
