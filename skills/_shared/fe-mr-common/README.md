# fe-mr-common（共用 references）

此目錄收納 `fe-mr-*` 系列 skill 共用的判準與規則，**不是獨立 skill**（沒有 SKILL.md，install.sh 會自動跳過 `_` 開頭的目錄）。

## 引用方

| Skill | 引用內容 |
|---|---|
| [fe-mr-digest](../../fe-mr-digest/) | diagram-rules、difficulty-levels、learning-tags、good-pattern-catalog、writing-principles（學習導讀語氣）、mr-context-usage |
| [fe-mr-walkthrough](../../fe-mr-walkthrough/) | diagram-rules、good-pattern-catalog、writing-principles（學習導讀語氣）、mr-context-usage、difficulty-levels（選用）、learning-tags（選用） |
| [fe-mr-review](../../fe-mr-review/) | writing-principles（審查語氣）、mr-context-usage |
| [fe-mr-review-html](../../fe-mr-review-html/) | writing-principles（審查語氣） |
| [fe-code-review](../../fe-code-review/) | writing-principles（審查語氣） |
| [a3-report](../../a3-report/) | writing-principles（只引「共用規範」整段與審查語氣 §1 白話先行；讀者改為主管，不屬於兩種語氣任一） |

## 檔案清單

| 檔案 | 內容 |
|---|---|
| [diagram-rules.md](diagram-rules.md) | 流程圖該畫／不該畫的三情境準則、Mermaid 與 Figma 渲染方式 |
| [difficulty-levels.md](difficulty-levels.md) | 🟢🟡🔴 三級難度分級的判準與典型主題 |
| [learning-tags.md](learning-tags.md) | 12 種學習標籤的涵蓋範圍 |
| [good-pattern-catalog.md](good-pattern-catalog.md) | 6 種值得標記的程式技巧範式、判準、反例、格言模板 |
| [writing-principles.md](writing-principles.md) | 共用規範（淺顯易懂、中文文案排版）＋學習導讀語氣（fe-mr-digest／fe-mr-walkthrough）＋審查語氣（fe-mr-review／fe-mr-review-html／fe-code-review）三部分合一 |
| [mr-context-usage.md](mr-context-usage.md) | `mr-context.sh` 完整用法、選項與補抓腳本 — 供 fe-mr-review、fe-mr-digest、fe-mr-walkthrough 共用 |

## 修改規則

修改前必須：

1. 用 `grep -r "_shared/fe-mr-common" skills/` 確認所有引用方
2. 評估改動對每個引用方的影響（特別是輸出格式變更會影響既有 digest／walkthrough 報告的一致性）
3. 修改後跑回歸測試：對同一份 MR 重新執行各引用方 skill，比對輸出差異
