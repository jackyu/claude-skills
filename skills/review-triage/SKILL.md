---
name: review-triage
description: 在 code review 交回 finding 之後、派人修正之前，逐筆判定每個 finding 是不是使用者真的會碰到的問題：標重現層級、從真實入口複核可達性、必要時用 verify-admin／verify-client 實跑，判成確認／待驗證／撤銷／防禦性建議，確認的附真人照做就能重現的步驟；修正後重跑時核對上一輪確認的有沒有關掉，並抓出「在修上一輪修法」的訊號。兩道審查（Pocock code-review 或 /cr，加上 Codex）都交回後，由主對話把原始 finding 存檔再呼叫。
context: fork
background: false
---

# review-triage：判定 review finding

只判定，不修程式、不 commit、不發 GitLab。判定標準以 `references/reachability.md` 為準，先讀它。

**用法**：`/review-triage <finding 檔的絕對路徑>`

這個 skill 跑在乾淨的上下文，看不到主對話。所以呼叫前，主對話要先把審查交回的原始內容存成 finding 檔（見「主對話的準備」），參數只給路徑。沒有參數或檔案不存在 → 回報「請主對話先存 finding 檔」並結束。

## 主對話的準備（呼叫前）

1. 定 `<key>`：照 `/cleanup` 的方式從參數、驗收清單 meta 的 `branch` 找；找不到就用 `branch-<分支名，底線換成連字號>`。必須符合 `^[a-z0-9-]+$`
2. 定輪次 `<N>`：`<main>/.claude/verify-evidence/<key>/` 底下已有幾份 `review-triage-r*.md` 再加 1
3. 寫 `<main>/.claude/verify-evidence/<key>/review-findings-r<N>.md`：
   - 開頭 meta：worktree 絕對路徑、base（預設 `origin/<預設分支>`）、目前 HEAD SHA、spec 與驗收清單路徑（沒有就寫無）
   - 每道審查一節，**原文照貼**（Pocock code-review 的兩軸報告、`/cr` 報告、Codex 的回報），標明來源
   - 不附主對話自己的判斷、實作者的辯護或開發對話
4. 呼叫 `/review-triage <那個檔的絕對路徑>`

## Step 1：讀材料

- finding 檔、`references/reachability.md`
- 上一輪 `review-triage-r<N-1>.md`（有的話）和它記的 HEAD
- `cd <wt> && git diff <base>...HEAD`；有上一輪時另看 `git diff <上一輪 HEAD> HEAD`（這一輪的修正）
- spec、驗收清單（有的話），用來判斷 Spec 類 finding

## Step 2：整理候選

- 把各道審查的 finding 拆成一筆一筆，同一個問題被兩道都報的合併成一筆、註明兩個來源
- 純風格、命名、文件類（沒有行為後果的）直接列進「非行為類」，不做可達性複核，照原 finding 轉述給主對話決定
- 有上一輪時，每筆標記：**新的**，或**上一輪某筆的延續**（同一個根因還在）

## Step 3：逐筆判定

照 `references/reachability.md` 第一節逐步走，判成四種之一：

| 判定 | 條件 | 必附 |
|---|---|---|
| 確認 | 真實流程可達、有實際損害 | 第二節的操作步驟、重現層級、防護為什麼沒擋住 |
| 待驗證 | 底層重現了，但實務可達性沒證實 | 已重現到哪一層、缺什麼證據、最小下一步 |
| 撤銷 | 必要操作被證實擋住、沒有其他入口 | 擋住它的防護 `檔案:行號` 與生效時機 |
| 防禦性建議 | 不是使用者會碰到的 bug，但加強有價值 | 一句理由 |

**要不要實跑 UI**：finding 牽涉 UI 時序、生命週期、遮罩或導航，而程式碼讀不出定論 → 用 `<wt>/.claude/skills/verify-admin` 或 `verify-client` 的 drive 走真實入口（起 app、port 規則、cleanup 照各自 SKILL.md；不碰 3000、3001）。證據放 `<main>/.claude/verify-evidence/<key>/triage-r<N>/`。跑不起來就判待驗證、寫明卡在哪，不要用直接呼叫 handler 的測試冒充。

## Step 4：修正輪的檢查（有上一輪才做）

- **上一輪確認的關掉沒**：每筆對照這一輪的修正 diff 和對應測試，標「已關／未關／部分」。已關要看到測試在修正前會紅（實作者的紅轉綠紀錄或自己重跑），而且測試層級不低於確認時的重現層級；只有 hook 測試、但當初是在實際 UI 確認的，算部分
- **在修上一輪修法**：這一輪的新 finding 指向的程式碼，落在上一輪修正 diff 改過的範圍，而且跟上一輪同一個根因或同一段邏輯 → 標成 ⚠ 並在報告最前面寫出來。這是前提可能錯了的訊號，要使用者重看建模，不建議繼續派修

## Step 5：寫報告

寫到 `<main>/.claude/verify-evidence/<key>/review-triage-r<N>.md`：

1. meta：輪次、worktree、base、HEAD、finding 檔路徑、是否實跑 UI
2. ⚠ 訊號（有的話）
3. 總表：編號、來源、一句話、判定、重現層級
4. 每筆細節：照 Step 3 表格的「必附」
5. 上一輪確認項的關閉狀態（修正輪才有）
6. 非行為類清單

## Step 6：回報主對話

最後一則訊息就是回報，主對話只看得到它：

- 報告路徑
- 總表（判定、重現層級、一句話）
- ⚠ 訊號原文
- 建議下一步：
  - 確認的 → 派修，要求先寫跟重現層級一致、修正前會紅的測試
  - 待驗證的 → 請使用者選：補驗證、收進追蹤票、當防禦性建議放掉
  - 有 ⚠ → 先停下來問使用者，不派修

## 不做的事

- 不改程式、不寫測試、不 commit
- 不自己再審一次找新 finding；只判定交進來的
- 不把待驗證包裝成確認，也不把未知寫成「不可能」
