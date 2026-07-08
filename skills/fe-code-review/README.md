# FE Code Review

> 前端程式碼審查 Orchestrator，串接內建 /code-review 與專業 Plugin Agents 進行全面審查

## Purpose

以 Orchestrator 角色串接內建 `/code-review` skill 與多個專業 Plugin Agents（pr-review-toolkit 系列），依變更規模智慧調度審查範圍，整合各來源輸出為統一報告。同時保留收到外部 code review 回饋時的處理準則，強調技術驗證優先於表演性附和。

## When to Use

- 用戶要求 code review
- 用戶提交程式碼變更請求審查
- 用戶提到 review、審查、檢視程式碼品質
- 收到外部 code review 回饋需要評估與回應

## Modes

### 審查模式
串接以下審查工具，依變更規模（小/中/大）智慧調度：

| 工具 | 審查面向 |
|------|---------|
| 內建 `/code-review` skill | 正確性 bug 偵測（依規模調 effort level） |
| pr-review-toolkit:code-reviewer | CLAUDE.md 合規、專案慣例、整體品質 |
| pr-review-toolkit:silent-failure-hunter | 錯誤處理、silent failure 偵測 |
| pr-review-toolkit:pr-test-analyzer | 測試覆蓋品質、邊界案例 |
| pr-review-toolkit:type-design-analyzer | 型別設計、invariants |
| pr-review-toolkit:comment-analyzer | 註解準確性、技術債 |

### 回饋處理模式
收到 review 回饋時的結構化處理流程（閱讀、理解、驗證、評估、回應、實作），包含 YAGNI 檢查與反駁準則。

## Key Features

- Orchestrator 架構，依變更規模智慧調度內建 /code-review 與 plugin agents
- 可平行執行無依賴的 plugin agents，提升審查效率
- 整合結果去重、排序（Critical → Suggestion）、來源標註
- 白話文報告：先講脈絡再講問題、術語附白話、帶學習點，讓不熟架構的工程師（含新手）也能判斷與學習
- 完整的回饋處理準則（技術驗證優先）
- 中文文案排版規範（中英文間距、全形標點等）
- 結構化輸出格式，含折疊區塊和篇幅控制

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Main skill instructions |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
