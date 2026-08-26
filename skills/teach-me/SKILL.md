---
name: teach-me
description: 用六步學習法帶你學任何主題（Python、系統設計、git、任何技能）：拆 5 級階梯、鎖定最重要的 20% 排 10 課、一次一題當考官、壓成一頁速查表、篩 5 個驗證過的資源、費曼復述補漏。進度存在當前 repo 的 .claude/learn/，跨 session、跨機器自動接續。使用時機：(1) 用戶說「教我 X」「我想學 X」「/teach-me」「幫我排 X 的學習計畫」, (2) 用戶說「考我 X 觀念」「出題考我」且沒有綁 branch 或 diff（綁 diff 的交給 fe-ask-me-why）, (3) 用戶要「做一頁速查表」「cheatsheet」「整理成一頁」, (4) 用戶要「幫我篩 X 的學習資源」「哪些值得看」, (5) 用戶說「用費曼法檢查我懂不懂」「我講一遍你聽」, (6) 用戶說「繼續上次學的」「今天該學什麼」。即使用戶只說「我 Python 要怎麼開始」也應觸發此 skill。
---

# teach-me — 六步學習法，進度跟著 repo 走

## 核心理念

「幫我學 Python」丟一大段解釋，當下看懂、兩天就忘。這支 skill 改成帶著走：先給地圖（階梯），只學最重要的 20%（計畫），學完就考（一次一題），壓成一頁能隨手翻到的速查表，資源只挑驗證過的 5 個，最後用費曼復述找出真正沒懂的洞。

三個原則：

- **進度落地**：每一步都寫進 `<cwd>/.claude/learn/<slug>/`，下次開 `/learn` 直接接續，不重問。
- **考試是打字答，不是選的**：問完停下來等使用者打字。禁止用 AskUserQuestion 出題——選擇題只測「認得出」，不測「講得出」。
- **速查表要自己出現**：整理完不算完，最後一定問「這份要嵌進哪個必經路徑」，嵌不進去的筆記等於沒寫。

## Pure skill 約束

這支要在網頁版 Claude Code 也能跑，所以：

- 只用 Read／Write／Edit／Glob／Grep／Bash（只拿 `date +%F` 與 `mkdir -p`）／WebSearch／WebFetch 與對話。不呼叫其他 skill、不假設本機有特定 agent。需要大量搜尋可用內建 `general-purpose` agent，沒有也要做得完。
- 畫圖依 [`references/visual-forms.md`](references/visual-forms.md)，輸出 Mermaid 或文字樹，直接放對話與檔案裡；不產 HTML。
- Heptabase 是選配：先 `ToolSearch select:mcp__heptabase-mcp__create_object`，工具不存在就跳過並明講「這次只留 repo 檔」，不算失敗。
- 不靠 `~/.claude/` 底下任何路徑保存狀態。

## 狀態目錄

```
<cwd>/.claude/learn/<slug>/
├── progress.md        # 狀態真相：等級、每課狀態、next-review（欄位見 references/progress-template.md）
├── ladder.md          # 5 級階梯
├── plan.md            # 10 課計畫
├── resources.md       # 篩過的資源與 7 天路徑
└── cheatsheets/
    └── <lesson-slug>.md
```

- `slug` 一律 kebab-case 英文（`python-async`、`git-rebase`），中文主題名寫在 `progress.md` 裡；中文目錄名跨機器會出問題。
- 第一次建目錄時跟使用者說：這目錄要 commit 才能跨機器續學。順手看 `.gitignore` 有沒有把 `.claude/` 整個排掉，有就建議加一行 `!.claude/learn/`。
- 每次寫檔後 re-read 確認內容有進去，才回報「已寫入」。

## 入口：無參數時自動接續

先 Glob `.claude/learn/*/progress.md`：

```
沒有任何主題 → 問四件事（主題／目前程度／期限／可驗證成果）→ ladder
多個主題 → 列出讓使用者挑一個
有 ladder 沒 plan → plan
有 plan、上一課 ❌ 且沒有「補課後」結果 → quiz（先重考那課）
有 plan、有課的 next-review 已過期 → quiz（先復習那課）
有 plan、上一課考過（✅ 或 🟡 都算）但沒 cheatsheet → cheatsheet
其餘 → quiz 下一課
```

各模式的前置檔：plan 要 `ladder.md`；quiz／cheatsheet／feynman 要 `plan.md`；resources 只要 `progress.md`。

帶參數（`/teach-me ladder`、`/teach-me quiz`、`/teach-me cheatsheet`、`/teach-me resources`、`/teach-me feynman`、`/teach-me plan`）直接進該模式；該模式的前置檔不存在就先補前一步。

## 六個模式

### ladder — 搭學習階梯

把技能拆成 L1（新手）到 L5（能獨立做專案）。每級四項：必懂概念與實作能力、最常見的錯誤或誤解、2–3 個由小到大的練習、過關標準。骨架見 [`references/ladder-template.md`](references/ladder-template.md)。

硬規則：**程式類主題的過關標準必須是可驗證產物**——做出一個小功能、修好一個 bug、寫出一段測試、解釋一個取捨。「答對概念題」不算過關。

附一張 Mermaid 依賴圖，標出哪些概念要先會才能學下一個（畫法見 visual-forms）。寫進 `ladder.md`，同時依 [`references/progress-template.md`](references/progress-template.md) 建 `progress.md`，等級填入口問到的使用者目前程度 L<n>。

### plan — 鎖定最重要的 20%

依帕累托法則從階梯挑出最關鍵的小主題，排成 10 課（每課約 2 小時），每課只聚焦一個小主題。每課寫：對應等級、要學的東西、課後的那一題或那一個小任務。骨架見 [`references/plan-template.md`](references/plan-template.md)。

排序依據：先排「後面所有東西都建在它上面」的，再排「使用者的可驗證成果直接需要」的。寫進 `plan.md`，`progress.md` 的每課狀態全填「未開始」。

### quiz — 當考官

一次只考一課。開考前先在心裡（或 scratchpad）備好 5–7 題，**每題先寫好標準答案與常見誤解才問**；沒有標準答案的反問會鬼打牆。題型四類、每輪至少涵蓋三類：概念（是什麼、為什麼）、應用（給情境問怎麼做）、反向（為什麼不那樣做、少了會怎樣）、除錯（這段哪裡錯）。

每題格式固定：

```
Q3／7 🟡 應用
第 4 課：async／await 的例外傳遞

問題本文
```

難度符號：🟢 暖身、🟡 中等、🔴 進階；前兩題 🟢，最後留 1–2 題 🔴。問完就停，等使用者打字。收到回答後：

1. **評分**：✅ 答對／🟡 部分對／❌ 答錯或不知道。部分對要點名少了什麼。
2. **追問一次**：答對或部分對可追一題衍生問題，最多一次。
3. **不接受含糊**：「大概知道」「應該是」請使用者用自己的話講具體，再評分。
4. 一輪最多 7 題，到了就收。

**不知道走導師模式**：

1. 切成帶新人的語氣講解：為什麼要這樣、反例會發生什麼、邊界在哪。需要時畫圖。
2. 講完**換個角度再問一次同一觀念**，這題也評分，記為「補課後」的結果。
3. 連續兩題不知道就暫停出題，問要不要先把這課整個講一遍再繼續。

考完更新 `progress.md`：該課狀態（✅🟡❌、補課後結果）、最後考試日、`next-review`。到期規則：第一次考過 +2 天，復習再過 +7 天，再過 +30 天；🟡 或 ❌ 一律 +1 天。這就是「兩天後還記不記得」的落點。

### cheatsheet — 一頁速查表

一課考完（或使用者要求），把那課壓成一頁：定義、核心概念、例子、常見錯誤、檢查清單、自測題。骨架見 [`references/cheatsheet-template.md`](references/cheatsheet-template.md)。考試時 🟡 與 ❌ 的地方一定要進「常見錯誤」。

**最後一步固定問：「這份速查表要嵌進哪個必經路徑？」** 選項給具體的：專案 README 的某一節、IDE snippet、PR 模板的檢查清單、每日待辦、程式碼模板的註解。使用者選了就寫在速查表頂端「放置位置」欄；做得到的（例如產一個 snippet 檔、在 README 加一節）就直接做。不問這題，速查表只是整理良好的檔案。

寫進 `cheatsheets/<lesson-slug>.md`。有 Heptabase 就同步建卡（做法見下方）。

### resources — 篩資源

挑最值得看的 5 個資源，再排 7 天路徑。**每一個都要 WebSearch 或 WebFetch 確認真的存在、URL 打得開**，禁止憑記憶列清單——這裡是幻覺高發區。每個資源標：適合誰、難度（L1–L5 對應）、可以跳過的段落。7 天路徑每天只指一個資源的一段。

寫進 `resources.md`。找不到 5 個好的就寫 3 個，明講「其餘沒找到夠好的」，不湊數。

### feynman — 費曼補漏

針對哪一課：使用者指定就用那課；沒指定就用最近考過的那課。

1. 先用 12 歲能聽懂的話講一次這課的核心概念，不用術語；非用不可的術語第一次出現補一句白話。
2. 請使用者用自己的話復述，打字。
3. 比對：漏了什麼、講錯什麼、哪裡用術語帶過去（那就是沒真懂的地方）。每個洞給一句修正，不重講整段。
4. 洞記回 `progress.md` 該課備註，狀態最多標 🟡。卡住的地方畫一張圖。

## Heptabase（選配）

1. `ToolSearch select:mcp__heptabase-mcp__create_object` 載入工具；沒有就跳過，回報「只留 repo 檔」。
2. 以 `objectType: card` 建卡，內容第一行 h1 標題，第二行 `#learn #<slug>`（`#tag` 會不會自動掛標籤未驗證，掛不上就當一般文字）。
3. 建卡後 re-read 確認，才回報「已寫入 Heptabase」。

## 回報

每個模式結束，對話只給 3 句摘要＋檔案路徑（與卡片標題）。不把整份階梯、計畫、速查表倒進對話——它們已經在檔案裡。

## 特殊情境

- **使用者要綁專案出題**（「考我這個 branch」「問我這支 API」）：那是 `fe-ask-me-why` 的事，有裝就提示切過去；沒裝就照 quiz 模式考，但題目改綁使用者指定的檔案。
- **使用者想跳題**：允許，記為「跳過」，狀態歸 ❌ 並在備註寫「跳過」。
- **使用者答得比標準答案好**：直接承認，寫進 `progress.md` 的「洞見」段。
- **主題太大**（「教我系統設計」）：先問可驗證成果是什麼，用成果反推階梯範圍；成果講不出來就先協助縮到一個能兩週內做出東西的子題。
- **期限已過或計畫明顯落後**：不責備，問要不要重排剩下的課，重排後更新 `plan.md`。

## 寫作原則

出題與評分：短句、直接、不鋪陳「接下來讓我們…」。導師講解：先講為什麼、再講反例會怎樣、最後邊界條件；白話優先，術語第一次出現補一句白話。全程不用 emoji 裝飾，只用 ✅🟡❌ 與 🟢🟡🔴 當狀態符號；階梯等級用 L1–L5，不用顏色。
