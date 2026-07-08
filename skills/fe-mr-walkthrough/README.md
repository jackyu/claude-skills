# fe-mr-walkthrough

協助 reviewer 在 review 前快速理解 GitLab MR 的互動式工具。AI 先讀懂整個 MR，產出白話版導讀，然後扮演作者回答 reviewer 的疑問——把「程式流程／邏輯處理」類的問題在 AI 階段就解掉，省下等待原作者回應的時間。

## 解決什麼問題

reviewer 在 review 前常遇到兩種卡點：

1. **看不懂 MR 在改什麼**：description 過於技術或太簡略，需要花時間爬 diff 還原意圖
2. **想問作者卻得等**：「為什麼不用 X 方式？」「這個 hook 為什麼要抽出來？」這類問題其實程式碼裡就有答案，但作者不在線時只能擱置

fe-mr-walkthrough 直接：

- 把 MR 翻譯成 PM / QA 也能讀懂的白話版
- 對重點程式碼變更加上白話解釋
- 在資料流／狀態／請求變化時加上 Mermaid 流程圖
- 列出值得學習的好做法（可一鍵接 fe-mr-digest 寫成筆記）
- 預備 FAQ + 自由提問，AI 用三級信心標記避免誤導

## 與 fe-mr-\* 系列的分工

| Skill | 何時用 | 視角 | 產出 | 要求合併 |
|---|---|---|---|---|
| `fe-code-review` | 作者推送前 | 多 agent 預審 | review 建議 | ❌ |
| `fe-mr-review` | review 中 | 找問題 | review comments | ❌ |
| **`fe-mr-walkthrough`** | **review 前** | **理解** | **導讀報告 + 互動問答** | ❌ |
| `fe-mr-digest` | 合併後 | 學習 | 完整學習筆記 | ✅ |

## 觸發方式

直接對話：

- 「幫我先看懂這個 MR：<URL>」
- 「解釋一下這個 MR 在幹嘛」
- 「我想 review 這個 MR 但作者今天請假，幫我先導讀」
- 「把這個 MR 翻譯成 PM 也看得懂的版本」
- 「這個 MR 有沒有什麼值得學的？」（未合併也可觸發）

## 輸出範例

報告依序由 8 段組成，最後進入互動問答迴圈：

```
📌 一句話總結
🗣️ 白話版描述（給 PM/QA）
🗺️ 變更地圖
🔍 重點區塊白話解釋（含 🟢🟡🔴 信心標記）
📊 流程圖（條件出現）
✨ 好做法雷達（含 checkbox）
❓ 預備 FAQ
🚪 進入問答模式 — 你可以直接打字提問
```

完整範本見 [`assets/walkthrough-report.md`](assets/walkthrough-report.md)。

## 信心三級

AI 扮演作者時的信心標記，避免誤導：

- 🟢 **高信心**：程式流程、語法、明顯 refactor 動機 → 直接回答
- 🟡 **推測**：命名、檔案組織、樣式取捨 → 「我的理解是…，建議跟作者確認」
- 🔴 **必須問作者**：商業規則、產品優先序、跨系統相依 → 累積進待詢問清單，session 結束時整理輸出

## 安裝

```bash
./scripts/install.sh -s fe-mr-walkthrough
```

依賴 `skills/_shared/fe-mr-common/` 中的共用 references（diagram-rules、good-pattern-catalog、writing-principles）。install.sh 會跳過 `_` 開頭的目錄，但 SKILL.md 透過相對路徑 `../_shared/fe-mr-common/...` 引用，symlink 解析後仍可正常讀取。

## 開發與貢獻

修改前請閱讀 [`SKILL.md`](SKILL.md) 的工作流程章節，與 `references/`、`assets/` 中的各檔案。共用 references 的修改規則見 [`../_shared/fe-mr-common/README.md`](../_shared/fe-mr-common/README.md)。
