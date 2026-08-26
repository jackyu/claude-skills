---
name: fe-ask-me-why
description: 針對你正在開發的 branch diff，扮演 reviewer／面試官逐題反問「為什麼這樣做」「為什麼不那樣做」、API 回應格式怎麼接，答不出來就切換成導師模式解釋，最後產出掌握度報告寫進 Heptabase。目的是把 AI vibe coding 交出去的專案理解拿回來。使用時機：(1) 用戶說「考我」「問我為什麼」「ask me why」「grill 我」「問我這個 branch」「反問我」, (2) 用戶要開 MR 前想先確認自己講得出每個改動的理由, (3) 用戶說對 AI 改的東西沒把握、掌控度變低、reviewer 問了答不出來, (4) 用戶想確認自己懂不懂某支 API 的回應格式與串接方式, (5) 用戶想做開發知識的自我測驗或學習紀錄。即使用戶只是說「幫我看看我懂不懂這次改了什麼」也應觸發此 skill。
---

# fe-ask-me-why — 拿回專案的掌控權

## 核心理念

AI 幫你寫完的程式碼，你不一定講得出「為什麼」。這支 skill 用 reviewer 的方式逼你講：每一題都綁在你 branch 的實際改動上，答對就下一題，答錯或不知道就切換成導師講給你聽，講完再換個角度問一次。

三個原則，缺一就變成閒聊：

- **題目從 diff 長出來**：每題都指到 `檔案:行號`，不出「請解釋 React Query」這種泛題。
- **答案是打字答，不是選的**：問完就停下來等使用者打字。禁止用 AskUserQuestion 出題——選擇題只測「認得出」，不測「講得出」。
- **每題都有評分**：三檔（答對／部分對／答錯或不知道），「部分對」最有價值，那是「以為懂」的地方。

角色分工：出題時是嚴格但不刁難的資深 reviewer；使用者說「不知道」時是帶新人的導師。兩個角色都不酸、不打分數羞辱。

## 工作流程

### Step 1：拿素材

1. `git fetch origin`，取 `git diff origin/main...HEAD` 加上未 commit 的改動（`git diff HEAD`）。
2. diff 是空的 → 問使用者要考哪些檔案或目錄，改用指定檔案模式。
3. diff 超過 500 行 → 先列出改動的檔案清單，請使用者挑 2–3 個最沒把握的區塊，只考那些。
4. 有 spec 或 issue（`docs/`、`IMPLEMENTATION_PLAN.md`、`/spec` 產物）就一起讀，題目可以問「spec 要求 X，你的實作在哪裡對應」。
5. 問一句「這個 branch 開 MR 了嗎？有就貼連結」。有 → 從 URL 拆出 project path 與 IID，跑 `~/.claude/skills/_shared/fe-mr-common/scripts/mr-context.sh <project_path> <mr_iid> --minimal` 拿 MR 標題與 `web_url`，留給收尾當卡片標題與連結。沒有 → 標題暫用 spec／issue 標題，都沒有就請使用者用一句話講這個 branch 在做什麼；連結先留 branch 名與 `git log --oneline origin/main..HEAD` 的 commit 範圍，MR 開了再補。

大量讀檔派 subagent（Explore），主對話只收「改動摘要＋值得出題的位置清單」。

### Step 2：先備好題庫再開考

出題前一次備齊 5–7 題，**每題先寫好標準答案與常見誤解，再問**。沒有標準答案的反問會變成鬼打牆。題庫不給使用者看，只在心裡（或 scratchpad）留著。

題型四類，每輪至少涵蓋三類：

| 題型 | 問法範例 |
|---|---|
| 為什麼這樣做 | 「`use-orders.ts:24` 為什麼要 `cancelQueries` 再寫快取？少了會怎樣？」 |
| 為什麼不那樣做 | 「這裡等 refetch 完再更新畫面不是更簡單嗎？為什麼選樂觀更新？」 |
| API 契約 | 「`GET /orders` 回的 `status` 有哪些值？後端回 400 時 body 長怎樣、你前端接在哪一行？」 |
| 影響範圍 | 「改了 `OrderCard` 的 props，還有誰在用它？你怎麼確認沒炸？」 |

難度依 [`_shared/fe-mr-common/difficulty-levels.md`](../_shared/fe-mr-common/difficulty-levels.md)，由淺到深排：前兩題 🟢 暖身，中間 🟡，最後留 1–2 題 🔴。

API 契約題的標準答案要從程式碼找：Zod schema、型別檔、MSW handler、API 文件。找不到就明講「我也沒看到契約在哪，這題改成：你要去哪裡確認？」

### Step 3：一題一答

每題的格式固定：

```
Q3／7 🟡 為什麼不那樣做
`features/orders/api/use-cancel-order.ts:31`
（貼 5–10 行關鍵程式碼）

問題本文
```

問完就停，等使用者打字。收到回答後：

1. **評分**：✅ 答對／🟡 部分對／❌ 答錯或不知道。部分對要點名少了什麼（「你講到會回滾，但沒講 `onSettled` 為什麼還要再 invalidate」）。
2. **追問一次**：答對或部分對時可追一題衍生問題（「那如果 cancel 到一半使用者切頁呢？」），最多追一次，不無限延伸。
3. **不接受含糊**：「我大概知道」「應該是快取的關係」這種回答請使用者用自己的話講具體一點，再評分。
4. **逐題留紀錄**：每題評完就把五樣東西原封寫進 scratchpad 的 `qa-log.md`：題目全文、使用者原文回答、評分、題庫裡先寫好的**標準答案**、你回覆使用者的**講評全文**（就是剛剛送出去的那段話，逐字貼，不縮寫）。不要事後憑印象重組、不要把講評濃縮成一句「少了 X」——收尾要把這份考古題完整放進卡片，日後複習就是靠「當時的回答 vs 標準答案 vs 當時的講評」三者並排看差異。
5. 評完進下一題。一輪最多 7 題，到了就收，超過會變成折磨、使用者又會想放行。

### Step 4：「不知道」走導師模式

使用者說不知道或答錯時：

1. 切換語氣，用 [`_shared/fe-mr-common/writing-principles.md`](../_shared/fe-mr-common/writing-principles.md) 的學習導讀語氣講解：為什麼要這樣做、反例會發生什麼事、邊界條件在哪。
2. 資料流、狀態流轉、請求時序這三種情境才畫圖（判準見 [`_shared/fe-mr-common/diagram-rules.md`](../_shared/fe-mr-common/diagram-rules.md)），畫圖交給 `fe-show-me`。單純 if/else 不畫。
3. 講完**換個角度再問一次同一觀念**，確認真的懂了。例：講完樂觀更新三段式後問「那 `onError` 拿到的 context 是誰給的？」。這題也要評分，記錄為「補課後」的結果；導師模式的講解全文、重問的題目、回答、講評，一樣逐字寫進 `qa-log.md`。
4. 導師模式不是脫逃出口。使用者連續兩題不知道，暫停出題，問要不要先把這個主題整個講一遍再繼續。

### Step 5：收尾產出掌握度報告

7 題考完（或使用者說停）：

1. 依 [`references/report-template.md`](references/report-template.md) 產出報告。標題固定 `[審查測驗] <MR 標題>`（Step 1 拿到的；沒 MR 就用 spec／issue 標題或使用者那句話），不用 branch 名——branch 名對日後檢索沒意義。標題下方第一段放 MR 連結，讓人從筆記直接跳回去對照 diff。
2. 報告兩大段：**掌握度報告**（懂／半懂／不懂、reviewer 可能追問的三題、補課紀錄）與**完整考古題**（從 `qa-log.md` 原封搬，每題一個 toggle：題目當標題、展開是使用者原文回答＋評分＋標準答案＋講評全文）。考古題不摘要、不改寫、不把講評縮成一句；卡片長一點沒關係，這段就是拿來重看的。
3. 標籤依 [`_shared/fe-mr-common/learning-tags.md`](../_shared/fe-mr-common/learning-tags.md) 選 1–3 個。
4. 寫進 Heptabase：先 `ToolSearch select:mcp__heptabase-mcp__create_object` 載入工具，再以 `objectType: card` 建卡。內容第一行是 h1 標題，第二行 `#標籤`（`#tag` 會不會自動掛標籤未驗證，掛不上就當一般文字，不算失敗）。**表格一律包在 `<hepta-table tokenId="new" hasColumnHeader="true">…</hepta-table>` 裡**，裸的 markdown table Heptabase 不認，會顯示成一串符號；同一次寫入有多張表就用 `new-0`、`new-1`。每格只能一段行內文字，不能放清單或換行。
5. Heptabase MCP 不在或建卡失敗 → 落到 `<repo 根目錄>/.claude/notes/<project_name>/ask-me-why-<YYYY-MM-DD>-<branch>.md`，內容同一份但把 `<hepta-table>` 標籤拿掉、toggle 的 `+` 換成 `-`，變回一般 markdown。`project_name` 是被考的那個專案的名稱，取 `basename $(git rev-parse --show-toplevel)`；先用專案名分一層，之後多個專案的報告才不會混在一起。目錄不在就建，並跟使用者說明落在哪。
6. 建卡或寫檔後 re-read 確認內容有進去（尤其表格有沒有變成真的表格、考古題題數對不對），才回報「已寫入」。

報告寫完，對話只給 3 句摘要＋卡片標題或檔案路徑，不把整份報告倒進對話。

## 輸出格式

見 [`references/report-template.md`](references/report-template.md)。

## 特殊情境

- **使用者要求泛題**（「考我 React Query 觀念」）：先問有沒有 branch 或檔案可以綁；堅持泛題就出，但每題仍要求「舉你專案裡的例子」。
- **使用者想跳題**：允許，記錄為「略過」，報告裡歸在不懂那欄並註明是跳過。
- **使用者答案比標準答案好**（例如提出更周延的做法）：直接承認，記下來，報告的「值得保留的洞見」段放進去。
- **diff 全是樣式或文案**：明講這輪沒什麼好考，問要不要改考近期其他 branch 或指定模組。
- **使用者中途要求解釋整段程式碼**：那是 `fe-mr-walkthrough` 的事，可以提示切過去，但當前這一題先收掉再切。

## 與其他 skill 銜接

- 導師模式要畫圖 → `fe-show-me`
- 想先看懂整包再來考 → `fe-mr-walkthrough`
- MR 合併後把這次補課的觀念整理成正式筆記 → `fe-mr-digest`（報告裡「不懂」與「補課紀錄」是現成素材）
- session 結束想沉澱流程改進 → `retro`

## 寫作原則

出題與評分：短句、直接、綁行號，不鋪陳「接下來讓我們…」。導師講解：遵循 `_shared/fe-mr-common/writing-principles.md` 學習導讀語氣。全程不用 emoji 裝飾，只用 ✅🟡❌ 與 🟢🟡🔴 當狀態符號。
