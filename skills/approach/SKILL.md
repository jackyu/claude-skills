---
name: approach
description: 這張票有沒有做法要先決定——套件或手寫、放哪裡、介面形狀、從哪裡開始，四類逐一檢查；有把握的整批列出，拿不準的逐題問並附推薦答案，升級到 research／how／architect／prototype 要使用者核准。排在 grill 之後、`/to-spec` 之前，輸出留在對話裡讓 to-spec 整理進 Implementation Decisions。使用者打 `/approach` 時使用。
disable-model-invocation: true
---

# approach：做法檢查

grill 問完需求、`/to-spec` 還沒整理規格書之前，先把「怎麼做」的決定談完，不要留給實作時的 AI 自己補。每張票都跑一次，就算多半是一行結束。

**用法**：`/approach`。沒有參數，吃的是這個對話裡 grill 談過的內容和目前分支／票號。

跑完到 `/to-spec` 之間**不要 `/clear`**——這份輸出只留在對話裡，由 `/to-spec` 整理進 Implementation Decisions，不另外寫檔。

## Step 1：判斷四類有沒有碰到

逐一檢查，碰到才往下做快查；都沒碰到就印一行「這張票沒有要先決定的做法」，結束。

| 類別 | 什麼情況才問 |
|---|---|
| 套件或手寫 | 有現成套件可用，或要新增依賴 |
| 放哪裡 | 新增檔案、抽共用、邏輯跨 app |
| 介面形狀 | 新 hook、新 API 層、新型別、狀態怎麼建模，或這張票要寫測試（測試打在哪個介面也算介面形狀） |
| 從哪裡開始 | 沒做過的技術、要等後端、要拆好幾張票 |

## Step 2：快查（碰到的類別才做）

每個碰到的類別，查到的結果都進 Step 3 的整批列出，不要邊查邊問。

- **套件或手寫**：查相關 app 的 `package.json` 和 lockfile 有沒有類似套件；grep repo 有沒有現成寫法可以照抄
- **放哪裡**：用 Skill 工具載入 `fe-arch` 判斷該放哪一層、哪個目錄；grep 既有同類模組，確認有沒有第二個使用者出現、要不要就近放置
- **介面形狀**：列出這張票會新增的 hook／型別／狀態，標出「錯誤還是資料」這類建模決定（例：後端回的業務狀態該用 React Query 的 error 處理，還是當成一般資料渲染）
- **介面形狀（測試打在哪）**：列出這張票的測試要打在哪些對外介面（Pocock 叫 seam：元件的 props 與畫面、hook 的回傳值、API 層函式），每個介面一行寫它抓得到什麼、抓不到什麼。這份清單就是 `implement` 說的「pre-agreed seams」。兩條規則：
  - 測試只打在這些介面上：不測沒 export 的 helper，不 mock 自己寫的模組；只在系統邊界 mock（後端 API、時間、亂數）。斷言結果不斷言呼叫：快取有沒有失效看 `getQueryState(key)?.isInvalidated`，不 spy `invalidateQueries`。判準見 Pocock `tdd/SKILL.md` 的 Anti-patterns 和 `tdd/mocking.md`
  - 想測的行為只能穿過介面才測得到時，代表介面形狀不對：把它列進「需要你決定」，提議把邏輯收進更少、更深的介面後面（詞彙見 Pocock `codebase-design`），不要為了測試把內部函式 export 出來
- **從哪裡開始**：標出這張票裡風險最高、最沒把握的一塊（沒做過的技術、依賴還沒就位、跨多張票的第一步）

讀程式碼一律讀 `origin/main`，跟 `to-acceptance` 的做法一致：

```bash
git -C <主 checkout> fetch origin
git -C <主 checkout> show origin/main:<路徑>
```

## Step 3：一次輸出

跟 `to-acceptance` Step 4 的問法一樣，彙整成**一份輸出**，依序：

1. **整批列出**：有把握的決定直接列出結論（查到的套件現況、放置位置、介面清單、測試要打的介面、風險點），使用者掃過，沉默就當接受，有意見才改
2. **「需要你決定」**：查不到或屬於取捨的題目，逐題編號，每題附推薦答案
3. **「建議升級」**：拿不準、值得花成本深查的項目，逐項提議對應的升級方式（見 Step 4），附一句為什麼值得升級；使用者核准才做，沒核准就維持快查結果，標「未深查」
4. **「跨票決定」**：檢查前三段裡的決定，有沒有「之後的票也要遵守」的（跨票規則，不只這張票）。只對這種決定，核對 Pocock domain-modeling 的三個 ADR 條件（見 `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/<最新版本>/skills/engineering/domain-modeling/SKILL.md` 與同目錄 `ADR-FORMAT.md`，`<最新版本>` 取法見 Step 4 開頭）：難以回頭、沒有背景會覺得奇怪、真的有取捨不是唯一選項。三個都成立才在這一段提議：規則一句話寫進對應的 `.claude/reference/*.md`（照該檔既有風格：scope blockquote、一條規則一句話、不展開理由），附一行 ADR 路徑；理由寫成 `docs/adr/` 底下一份新的 ADR，格式照 `ADR-FORMAT.md`。跨票但沒通過三個條件的決定，只留在這份輸出和之後的 spec／MR 描述，不提 ADR

做完**停下來等使用者回覆**。回覆裡有新問題，就再做一輪同樣格式的輸出，直到沒有新問題。

這個「開始」階段還在主 checkout、worktree 還沒建立，**不要寫進主 checkout 的任何檔案**——第 4 段「跨票決定」核准的提議，和 Step 4 升級跑出來的任何產物，都只記成待寫／待交項目留在對話裡，交給 `/to-spec` 一併收進 Implementation Decisions；reference／ADR 要等 worktree 建立、實作開始後才真的寫檔，跟功能一起 commit。

## Step 4：升級（要使用者逐項核准）

路徑裡的 `<最新版本>` 一律用 `ls <目錄> | sort -V | tail -1` 取最新版本號，不要寫死版號（快取裡常同時留著新舊兩版）。

| 類別 | 升級 | 怎麼跑 | 產出放哪裡 |
|---|---|---|---|
| 套件或手寫 | Pocock `research` | Skill 工具載入 `mattpocock-skills:research`，照它的流程走 | `research` 預設會把比較結果寫成 md 檔。**不要讓它寫進主 checkout 的追蹤檔案**：指定輸出放 session scratchpad，若專案有 gitignore 掉的筆記目錄（例如 rsc-frontend 的 `docs/notes/`）也可以放那裡；寫完的內容整段貼回對話，供 `/to-spec` 收進 Implementation Decisions |
| 放哪裡 | pstack `how` | `how` 設了 `disable-model-invocation`，Skill 工具載入不了。先讀 `~/.claude/plugins/cache/cursor-plugins/pstack/<最新版本>/docs/harness/claude-code.md`（pstack 要求先讀這份），再讀 `~/.claude/plugins/cache/cursor-plugins/pstack/<最新版本>/skills/how/SKILL.md` 並照裡面的步驟做 | 只是講解分層與負責範圍，結論直接整批列出，不寫檔 |
| 介面形狀 | pstack `architect` | 同上，換成 `skills/architect/SKILL.md` | 型別和函式簽名寫進對話、留給 spec 收錄，不要寫進主 checkout 的 `src/` 或任何追蹤檔案 |
| 從哪裡開始 | Pocock `prototype` | Skill 工具載入 `mattpocock-skills:prototype`，照它的流程走 | `prototype` 會動手寫程式碼確認可行。**一律在 session scratchpad 裡做，不要碰主 checkout 的任何追蹤檔案**；做完確認可行與否就整段丟棄，把結論（可行／不可行、理由）帶回對話 |

使用者沒核准的升級項目，決定維持 Step 3 的快查結果，在輸出裡標「未深查」。

## 完成後

跟使用者說：

- 四類各碰到幾個、有幾個「需要你決定」的題目已確認
- 有幾個決定標「未深查」（使用者沒核准升級）
- 有幾個跨票決定待寫成 `.claude/reference/` 規則＋ADR（worktree 建立後才會真的寫檔）
- 下一步是 `/to-spec`；如果核准了 `prototype` 升級，提醒先跑完原型再進 `/to-spec`
