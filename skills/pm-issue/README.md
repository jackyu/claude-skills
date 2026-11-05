# PM Issue

> 用 PM 口吻寫需求 issue：非工程人員看得懂，開發做得出對的東西，驗收有明確標準

設成 `disable-model-invocation: true`，只能手打 `/pm-issue` 觸發，模型不會自己叫。

## Purpose

需求票常寫成工程師的語言（API、欄位、狀態碼），業務和審核人員讀不懂，也就沒辦法確認需求對不對；驗收標準寫成「系統正確處理」，到驗收時沒人能判斷合不合格。

這支 skill 以 PM 的角色寫票，骨架取自 rsc-pm#201：任務概述 → 需求 → Given/When/Then 驗收情境，再附一張待補資料表，讓缺的設計稿、截圖、文案一眼看得出來。

## When to Use

- 要開 PM 票、寫需求單、寫 user story
- 手上有口語需求、會議筆記、客戶反饋，要整理成 issue
- 既有 PM 票太技術，要改寫成非工程人員看得懂
- 在 rsc-pm 開票

**不要用在**：把 PM 票拆成前端技術票（用 `gitlab-issue`）、RD 驗收清單（用 `to-acceptance`）。

## 流程

| 步驟 | 做什麼 |
|---|---|
| 1. 收集需求 | 整理誰、現在的問題、希望變成怎樣、範圍、成功標準；前三件缺了才問（一次一題），後兩件先假設、標待確認 |
| 2. 產草稿 | 照模板填；驗收情境至少有主要成功、防呆、範圍外不受影響，有寄信或留紀錄再加資料完整性；符合條件就附 Mermaid 流程圖 |
| 3. 待補清單 | Figma、現況截圖、文案、Epic／Kickoff、未定案規則，逐項標已有／待補／待確認；截圖不能有客戶個資 |
| 4. 自我檢查 | 禁用詞清零、需求與驗收情境一一對得上、結果都是看得到的、寫了哪些不改 |
| 5. 建立 issue | 使用者確認後，用 `issue-create.sh` 先 dry-run 再建到 rsc-pm，建完用 iid 重查核對 |

## 流程圖什麼時候畫

步驟三步以上、中間有分岔、或兩個以上角色交接，符合任一條就畫。只改文案、顏色、單一按鈕不畫。

## 檔案結構

```
pm-issue/
├── SKILL.md                 # Step 1-5 流程
└── references/
    ├── template.md          # issue 骨架、rsc-pm labels 與標題前綴選法
    └── wording.md           # PM 口吻用詞規則與禁用詞
```

## 依賴

- `glab`（讀既有 PM 票）
- `~/.claude/scripts/gitlab/issue-create.sh`、`issue-update.sh`（寫入 GitLab，受寫入白名單管制）
- Figma MCP（選用，看設計稿核對畫面狀態）
