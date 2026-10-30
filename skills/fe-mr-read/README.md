# fe-mr-read

讀懂一張 GitLab MR，需要的話再把它沉澱成 Heptabase 學習筆記。AI 先讀懂整個 MR，產出白話版導讀，扮演作者回答疑問；問答結束時問一次要不要存筆記，要的話沿用導讀結果，補上 Review 討論分析、難度與標籤寫進 Heptabase。

## 解決什麼問題

1. **看不懂 MR 在改什麼**：description 過於技術或太簡略，需要花時間爬 diff 還原意圖
2. **想問作者卻得等**：「為什麼不用 X 方式？」「這個 hook 為什麼要抽出來？」這類問題其實程式碼裡就有答案，但作者不在線時只能擱置
3. **看懂了卻沒留下來**：資深工程師的寫法和 Review 討論很值得學，但讀完就忘；另外跑一次學習筆記又要重讀整張 MR

fe-mr-read 直接：

- 把 MR 翻譯成 PM／QA 也能讀懂的白話版
- 對重點程式碼變更加上白話解釋，資料流／狀態／請求變化時加上 Mermaid 流程圖
- 列出值得學習的好做法
- 預備 FAQ + 自由提問，AI 用三級信心標記避免誤導
- 要存筆記時沿用導讀結果，只補 Review 精華、「為什麼不這樣做」、難度與學習標籤，不重讀

## 三段流程

| 段 | 做什麼 | 何時跑 |
|---|---|---|
| Phase 1 導讀 | 意圖 → 白話重述 → 變更地圖 → 重點區塊 → 流程圖 → 好做法雷達 → FAQ → 互動問答 | 每次 |
| Phase 2 問要不要存筆記 | 問答結束時問一次 | 每次 |
| Phase 3 學習筆記 | 沿用 Phase 1，補 Review 討論、替代方案、難度、標籤，寫進 Heptabase | 使用者說要，或 `fe-mr-review` 審完使用者說要 |

MR 的狀態不擋流程：開著的 MR 筆記標「草稿，MR 未合併」，關閉的 MR 筆記附「為什麼被放棄」。

## 與 fe-mr-\* 系列的分工

| Skill | 何時用 | 視角 | 產出 |
|---|---|---|---|
| `fe-code-review` | 作者推送前 | 多 agent 預審 | review 建議 |
| **`fe-mr-read` Phase 1** | **review 前** | **理解** | **導讀報告 + 互動問答** |
| `fe-mr-review` | review 中 | 找問題 | review comments |
| **`fe-mr-read` Phase 3** | **導讀或 review 之後** | **學習** | **Heptabase 學習筆記** |

`fe-mr-review` 審完會問要不要存學習筆記，使用者說要就直接跑本 skill 的 Phase 3（只補意圖與變更地圖，不進互動問答）。

## 觸發方式

本 skill 設了 `disable-model-invocation: true`，只能手打 `/fe-mr-read <MR_URL>` 觸發。常見說法：

- 「幫我先看懂這個 MR：<URL>」
- 「我想 review 這個 MR 但作者今天請假，幫我先導讀」
- 「把這個 MR 翻譯成 PM 也看得懂的版本」
- 「這個 MR 有什麼值得學的？幫我整理成筆記」

## 輸出

導讀報告依序由這幾段組成，最後進入互動問答迴圈：

```
📌 一句話總結
🗣️ 白話版描述（給 PM/QA）
🗺️ 變更地圖
🔍 重點區塊白話解釋（含 🟢🟡🔴 信心標記）
📊 流程圖（條件出現）
✨ 好做法雷達（含學習筆記 checkbox）
❓ 預備 FAQ
🚪 進入問答模式 — 你可以直接打字提問
```

學習筆記段落：這個 MR 在做什麼、怎麼做的、值得學習的技巧、Before／After（重構類）、為什麼不這樣做、Review 精華、流程圖、還沒有答案的問題、總結。寫進 Heptabase 卡片；Heptabase MCP 不在或建卡失敗時落到 `<repo 根目錄>/.claude/notes/<project_name>/mr-read-<iid>-<YYYY-MM-DD>.md`。

## 信心三級

AI 扮演作者時的信心標記，避免誤導：

- 🟢 **高信心**：程式流程、語法、明顯 refactor 動機 → 直接回答
- 🟡 **推測**：命名、檔案組織、樣式取捨 → 「我的理解是…，建議跟作者確認」
- 🔴 **必須問作者**：商業規則、產品優先序、跨系統相依 → 累積進待詢問清單，問答結束時整理輸出

## 檔案

| 檔案 | 內容 |
|---|---|
| `SKILL.md` | 三段流程主幹、信心三級、從 fe-mr-review 進 Phase 3 的方式 |
| `references/walkthrough-steps.md` | Phase 1 Step 1-9 細節 |
| `references/plain-language-rules.md` | 白話化準則 |
| `references/author-roleplay.md` | AI 扮演作者守則 |
| `references/qa-protocol.md` | 互動問答協定（含結束時接 Phase 2） |
| `references/learning-note.md` | Phase 3 步驟細節與 Heptabase 寫入方式 |
| `references/digest-template.md` | 學習筆記模板與段落取捨 |
| `assets/walkthrough-report.md` | 導讀報告範本 |
| `assets/faq-prompts.md` | 預備 FAQ 題庫 |

## 安裝

```bash
./scripts/install.sh -s fe-mr-read
```

依賴 `skills/_shared/fe-mr-common/` 中的共用 references（diagram-rules、good-pattern-catalog、difficulty-levels、learning-tags、writing-principles、mr-context-usage）。install.sh 會跳過 `_` 開頭的目錄，但 SKILL.md 透過相對路徑 `../_shared/fe-mr-common/...` 引用，symlink 解析後仍可正常讀取。

## 開發與貢獻

修改前請閱讀 [`SKILL.md`](SKILL.md) 與 `references/`、`assets/` 中的各檔案。共用 references 的修改規則見 [`../_shared/fe-mr-common/README.md`](../_shared/fe-mr-common/README.md)。

---

*Part of [claude-skills](../../README.md)*
