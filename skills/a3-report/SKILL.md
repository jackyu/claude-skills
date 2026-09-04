---
name: a3-report
description: 產出給主管看的週報與 A3 提案。使用時機：(1) 用戶要寫週報、跟主管報進度、報這週做了什麼, (2) 用戶有事情需要主管拍板、要簽核、要決定, (3) 用戶提到 A3、一頁報告、豐田 A3, (4) 用戶要寫提案說服主管，例如技術債清償、導入某工具、投資某項重構, (5) 用戶說要把散亂的筆記、PM issue、GitLab 活動整理成給上面看的文件, (6) 用戶要把週報或 A3 提案做成簡報或網頁交出去。即使只說「幫我整理這週要跟主管講的東西」也應觸發。不觸發於：MR／PR 的程式碼審查（用 fe-mr-review）、從 MR 萃取學習筆記（用 fe-mr-digest）、把 PM 需求拆成開發任務（用 fe-issue）、把 review 結果做成 HTML 報告（用 fe-mr-review-html）、幫專案加品質關卡或 lint 門檻（用 fe-guardrails）、把學習內容整理成一頁速查表（用 teach-me）。
---

# A3 Report

把散亂素材整理成主管讀得下去的一頁文件。兩種模式：

| 模式 | 用在什麼場合 | 骨架 |
|---|---|---|
| `weekly` | 每週跟主管同步進度，順便把要拍板的事推上去 | 進度／風險與 blocker／需要拍板的事／下週 |
| `proposal` | 要說服主管做一件事：清技術債、導入工具、投資重構 | 豐田 A3 完整八格 |

`weekly` 的每個拍板事項用縮小版 A3（問題→現況→方案比較→建議→要決定什麼）。八格不當週報骨架，硬套會變成填表格。

## 語氣

引用 `../_shared/fe-mr-common/writing-principles.md` 的兩段，其餘不套：

- 「共用規範」整段（淺顯易懂、中文文案排版、結構排版）。
- 「審查語氣」的第 1 節「語氣與表達：白話先行、術語走名詞補充」。

**排除**審查語氣的第 2 到第 4 節（貼程式碼、四欄檢查項、比喻），那些是寫給工程師看的。

**讀者假設改寫**：共用規範寫「假設讀者是 1-2 年經驗的前端工程師」，本 skill 改為「讀者是主管，不讀 diff，只看取捨、風險、要簽什麼」。技術名詞第一次出現補一句白話，之後直接用。

## Step 0：解析參數

skill 沒有 `$ARGUMENTS`，從使用者訊息偵測：

| 參數 | 偵測 | 預設 |
|---|---|---|
| mode | `--mode weekly\|proposal`；「週報」「這週進度」→ weekly；「提案」「A3」「想推動 X」→ proposal | 走 Step 1 判斷 |
| format | `--format md\|ppt\|html`；「做成簡報」「投影片」→ ppt；「做成網頁」→ html | md |
| period | `--since`／`--until`；「上週」「這兩週」 | 本週一至今日，日期由你算好再傳給腳本 |
| project | `--project a/b,c/d` | `git remote get-url origin` 推算，推不出來就問 |

## Step 1：定模式

訊號明確就直接定。兩種訊號都有、或都沒有，用 AskUserQuestion 問一次，不要猜。

判準：使用者想同步「這段時間發生什麼」→ weekly；想推動「一件還沒開始的事」→ proposal。

## Step 2：必答三件事

一次問完，使用者已經講過的跳過：

1. **受眾**：主管是誰、有沒有技術背景。
2. **要做的決定**：weekly 問「這週有沒有要主管拍板的事」；proposal 問「要主管決定什麼、期限什麼時候」。
3. **期間**：確認算出來的區間對不對。

**硬規則：判斷不出受眾或目的就先問，不准猜。** 猜錯的報告寫得再漂亮也是白寫。

## Step 3：蒐集素材

細節見 [`references/source-collection.md`](references/source-collection.md)。三個來源：

- **手打筆記**：請使用者貼進來或給路徑，原文先入清單。
- **PM issue**：跑 `~/.claude/skills/_shared/fe-mr-common/scripts/issue-get.sh <issue_url>`，失敗請使用者貼。
- **GitLab 本期活動**：跑 `bash ~/.claude/skills/a3-report/scripts/gitlab-activity.sh <project_path_or_id> --since YYYY-MM-DD --until YYYY-MM-DD [--author me]`，多專案跑多次，失敗請使用者貼清單。沒裝到 `~/.claude/skills/` 就改用 repo 內的 `skills/a3-report/scripts/gitlab-activity.sh`。

匯成一份**事實清單**，每條標來源：`[筆記]`／`[issue #N]`／`[MR !N]`，多專案時加專案前綴。

**硬規則：清單裡沒有的事不能出現在輸出。** 要出現就標待確認。任何情況都不准憑記憶補資料。

## Step 4：產出內容

- weekly 套 `assets/weekly-template.md`，每個拍板事項套 `assets/decision-item-template.md`。
- proposal 套 `assets/proposal-a3-template.md`，每格寫什麼看 [`references/a3-grid.md`](references/a3-grid.md)。weekly 模式只需讀 `references/a3-grid.md` 末尾的「縮小版 A3：拍板事項怎麼從八格縮成五項」一節，八格定義是 proposal 才用。

共同硬規則：

1. **每格一句結論再條列。** 主管只讀結論句也要看得懂。
2. **② 現況與 ⑦ 成效的每個數字都要能對回事實清單。** 對不回去就改標待確認，格式固定：

   ```
   🔴 待確認：<缺什麼>，去哪拿：<Sentry／GA／某 dashboard／問誰>
   ```

   「去哪拿」不准留空，也不准寫「同上」「見上方」，每一條自己寫完整。
3. **信心三級**沿用 `../fe-mr-walkthrough/SKILL.md` 的「AI 扮演作者的信心三級」：🟢 有素材佐證／🟡 推測並寫依據／🔴 待確認。🔴 與待確認是同一件事，不另設第四級。
4. **禁止偽造引用**：不准寫「PM 說」「主管說」，除非事實清單有原文。
5. **一頁放不下**：影響決策的留主體，其餘進附錄；不准刪待確認項來騰空間。

## Step 5：自檢閘門

讀 [`references/checklist.md`](references/checklist.md)，逐點打 ✅ 或 ⚠️。

- weekly 閘門表固定四列：①②⑤⑥。② 同時涵蓋拍板事項的現況數字與進度數字。
- proposal 八點全套。

閘門表固定放輸出末尾，三欄「檢查點｜結果 ✅／⚠️｜說明」。⚠️ 的說明欄要指向對應的待確認項。

**⚠️ 先修，修不了就改標待確認再交，不准靜默略過，也不准刪內容換 ✅。**

## Step 6：格式分流

細節見 [`references/output-formats.md`](references/output-formats.md)。

- **md**：輸出到對話。
- **ppt**：用 `Skill` tool 呼叫 `document-skills:pptx`，傳最終 markdown、投影片對應表、約束三樣。回 `disable-model-invocation` 就改用 pptxgenjs 自己產，不要重試。輸出 `.claude/tmp/a3-report-<slug>.pptx`。
- **html**：套 `assets/a3-onepage.html`，遵守 `../fe-show-me/SKILL.md` HTML 規則的第 2、3、4 條（self-contained、路徑固定、不主動 `open`）。規則 1「一律假資料」縮限：專案進度照實寫，但不放客戶個資、帳號、金額明細、API 原始回應。輸出 `.claude/tmp/a3-report-<slug>.html`；cwd 不是 git repo 就落 scratchpad 並告知。

轉格式階段不新增、不改寫內容，只搬版面。

## Step 7：收尾

1. 印出產出的絕對路徑（md 模式跳過）。
2. 把所有「待確認」項列一次，提醒使用者報告前補齊，或在會議上當場說明缺什麼、去哪拿。
3. 閘門表有 ⚠️ 就再念一次是哪幾點。
