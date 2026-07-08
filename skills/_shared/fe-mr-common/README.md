# fe-mr-common（共用 references）

此目錄收納 `fe-mr-*` 系列 skill 共用的判準與規則，**不是獨立 skill**（沒有 SKILL.md，install.sh 會自動跳過 `_` 開頭的目錄）。

## 引用方

| Skill | 引用內容 |
|---|---|
| [fe-mr-digest](../../fe-mr-digest/) | diagram-rules、difficulty-levels、learning-tags、good-pattern-catalog、writing-principles |
| [fe-mr-walkthrough](../../fe-mr-walkthrough/) | diagram-rules、good-pattern-catalog、writing-principles、difficulty-levels（選用）、learning-tags（選用） |
| [fe-mr-review](../../fe-mr-review/) | review-writing-principles |
| [fe-mr-review-html](../../fe-mr-review-html/) | review-writing-principles |
| [fe-code-review](../../fe-code-review/) | review-writing-principles |

## 檔案清單

| 檔案 | 內容 |
|---|---|
| [diagram-rules.md](diagram-rules.md) | 流程圖該畫／不該畫的三情境準則、Mermaid 與 Figma 渲染方式 |
| [difficulty-levels.md](difficulty-levels.md) | 🟢🟡🔴 三級難度分級的判準與典型主題 |
| [learning-tags.md](learning-tags.md) | 12 種學習標籤的涵蓋範圍 |
| [good-pattern-catalog.md](good-pattern-catalog.md) | 6 種值得標記的程式技巧範式、判準、反例、格言模板 |
| [writing-principles.md](writing-principles.md) | 淺顯易懂、聚焦學習價值、中文文案排版規範 |
| [review-writing-principles.md](review-writing-principles.md) | review 報告撰寫原則（白話先行、術語走名詞補充）— 供 review 類 skill 共用 |

## 修改規則

修改前必須：

1. 用 `grep -r "_shared/fe-mr-common" skills/` 確認所有引用方
2. 評估改動對每個引用方的影響（特別是輸出格式變更會影響既有 digest／walkthrough 報告的一致性）
3. 修改後跑回歸測試：對同一份 MR 重新執行各引用方 skill，比對輸出差異
