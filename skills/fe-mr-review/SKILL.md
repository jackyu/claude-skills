---
name: fe-mr-review
description: AI 輔助 GitLab Merge Request 審查與 Review Comment 回覆。使用時機：(1) 用戶要求審查 MR/PR, (2) 用戶提到 merge request review、PR review, (3) 用戶要求產出 code review 並包含人工確認項目, (4) 用戶提到要讓 AI 先 review 再由人確認, (5) 用戶要求針對 GitLab MR 進行審查, (6) 用戶要求分析 review comments, (7) 用戶提到 code review 回覆、review 回應, (8) 用戶說 MR 上有 review 建議要處理, (9) 用戶說要處理 review feedback。即使用戶只是說「MR 上有 review 幫我看一下」也應觸發此 skill。
disable-model-invocation: true
---

# MR Review

AI 輔助 GitLab Merge Request 審查工具，支援兩種模式：

| 模式 | 觸發情境 | 核心產出 |
|------|---------|---------|
| **審查模式 (Review)** | 審核成員發出的 MR | 風險分流 + 技術審查 + 合併建議 |
| **回覆評估模式 (Reply)** | MR 上有 review comments 需處理 | 交給 review-triage 判定，照判定修並逐則回覆 |

## 審查哲學：嚴謹搬家，但有一塊不能搬

「每一行邏輯對不對、命名/格式/規範有沒有守」這類**有標準答案**的事，交給有標準答案的工具——linter、type checker，加上 AI 直接掃。人不該耗在這層。

人要看的是機器看不了的三件事：**意圖對不對、架構與 bounded context 有沒有守住、高風險區的業務規則對不對。**

**但目前產品線（申請前台／審核後台）有一塊嚴謹不能往兩頭搬**——身分驗證、審核狀態機、權限邊界、個資處理、多步驟表單完整性。所以本 skill 的第一個動作不是技術審查，而是**風險分流**：把 MR 切成「高風險區（人逐行看）」與「一般區（自動化 + agent 掃）」。99% 不看，1% 看到死。

---

## 模式判定

依以下順序判定模式：

1. **明確意圖**：用戶明確提到「審查」「review」→ 審查模式；提到「回覆」「回應」「處理 review comments」「review feedback」→ 回覆評估模式
2. **模糊意圖**：若無法判定，詢問用戶：「請問您需要 (A) 審查這個 MR，還是 (B) 處理 MR 上既有的 review comments？」

---

## 共用步驟

兩種模式都從以下步驟開始，取得完整 context。

### Step 1: 取得 MR 資訊

執行：

```bash
~/.claude/skills/_shared/fe-mr-common/scripts/mr-context.sh <project_path> <mr_iid>
```

完整用法、選項與補抓腳本見 [`_shared/fe-mr-common/mr-context-usage.md`](../_shared/fe-mr-common/mr-context-usage.md)。

### Step 2: 取得完整 Diff Context

若 mr-context.sh 因 diff 過大降級為 stat 預覽，或需要更多周邊邏輯，使用本地 git diff 取得完整變更內容（比 GitLab API 回傳的 per-file diff 更完整）：

```bash
# 取得完整 diff
git diff origin/<target_branch>...origin/<source_branch>

# 取得變更的檔案列表
git diff origin/<target_branch>...origin/<source_branch> --name-only
```

若本地分支不存在，先 fetch：

```bash
git fetch origin <source_branch>:<source_branch>
```

---

## 審查模式 (Review Mode)

完成共用步驟後，先做 Step R0 看懂這張 MR，接著 **Step R1 風險分流務必最先做**，它決定後面每一段要用什麼強度審查。

### Step R0: 看懂這張 MR

借 `fe-mr-read` 導讀的前三步，只做理解、不評斷：解析意圖（描述、linked issue、commit）→ 白話重述 → 變更地圖（哪些模組、各自改了什麼）。產出放在報告最上方的「這張 MR 在做什麼」，3–5 行講完。

不做互動答疑和好做法雷達；那是 `fe-mr-read` 的事。R0 的內容**不放進** Step R3.5 交給 review-triage 的 finding 檔，避免作者意圖帶偏判定。

### Step R1: 高風險區分流（最優先）

讀取 `references/high-risk-zones.md`，掃過完整 diff，把每一段變更分類為「高風險區」或「一般區」。

判斷依據：是否觸及身分驗證與文件審核（KYC）、審核流程狀態機、申請人與審核人員的權限邊界、個資與敏感資料處理、多步驟表單的資料完整性。參考檔內有每一域的訊號關鍵字、前端常見錯法與 reviewer 確認點。

分流結果決定審查強度：

| 分類 | 審查強度 |
|------|---------|
| **高風險區** | 逐行細看；對齊 spec / PM 業務規則；建議 cross-model 複查；要求明確驗收標準 |
| **一般區** | 自動化 + AI 掃描即可，聚焦意圖與架構，不逐行 |

關鍵認知：高風險區的錯常是「業務規則錯」而非「語法錯」，linter / type checker / cross-model **都未必抓得到**，必須人看並回去對齊業務規則。

若 diff 完全未觸及任一高風險域，明確標示「本次無高風險區變更，採一般審查強度」，不要含糊帶過。

> **Cross-Context / Cross-Model 提示**：本 skill 在乾淨 session 只看最終產物（不帶產出時的對話歷史），本身即為 cross-context review。高風險區可再請不同 model 複查一次（例如 Codex 看 Claude 寫的），blind spot 不同。

> **視覺化提示**：審核狀態機、多步驟表單這類高風險區，文字描述常常講不清楚「這次改動的形狀」。可依 `fe-show-me` 用 call-tree diff（改了哪一層呼叫）或 state diagram（狀態流轉）表達，比純文字快。只在高風險區、且畫圖確實比文字清楚時才用，不為畫而畫。

### Step R2: 判斷 MR 類型

判斷類型只是用來校準風險分流與「合併建議」的理由，不再輸出獨立的 checklist 區塊。

**判斷順序**（依優先級）：

1. MR labels — 尋找 `feature`、`bugfix`、`hotfix`、`refactor`
2. Branch 名稱 — `feature/*`、`feat/*` → feature；`fix/*`、`bugfix/*`、`hotfix/*` → bugfix；`refactor/*` → refactor
3. Title prefix — `feat(...)` → feature；`fix(...)` → bugfix；`refactor(...)` → refactor
4. Diff 內容推斷 — 新增檔案為主 → feature；修改為主且無新檔案 → bugfix/refactor

> `references/review-focus.md` 依 MR 類型（Feature / Bugfix / Refactor）列出**選用的內部審查焦點**——提示該留意什麼，幫助你抓技術問題與高風險點。**不照抄成輸出**：真正需要人工確認的事項，併進 Step R1「風險分流」表的「需人工確認」欄，不另立 checklist 區塊。

### Step R3: 技術審查

審查強度依 Step R1 的分流結果：高風險區逐行，一般區聚焦意圖與架構。

**技術審查**（AI 直接判定，有問題就列出檔案、行數、具體建議）：

| 類別 | 檢查重點 |
|------|----------|
| 程式碼風格 | 命名一致性、格式規範、import 順序 |
| 潛在錯誤 | null/undefined 風險、type error、未處理的 Promise |
| React/Next.js | 不必要的 re-render、missing deps、hydration mismatch；**App Router robustness**——`useSearchParams` 要包 `<Suspense>`、`loading.tsx`/Shimmer 骨架高度落差致 CLS、a11y/ARIA（見 `review-focus.md`「實戰關注點 §8」） |
| TypeScript | 型別完整性、any 濫用、型別斷言合理性 |
| 錯誤處理 | try-catch 完整性、邊界條件、API 錯誤處理；**錯誤與副作用收在對的層**——別把分類/回報/轉換推到太下游、避免重複 Sentry 回報、副作用別塞進 effect/map（見 `review-focus.md`「實戰關注點 §1」） |
| 安全性 | XSS、敏感資料外洩、不安全的動態渲染 |
| 可維護性 | 重複邏輯、過長函式、單檔行數、magic number——**用數字判定，不憑感覺**，門檻見下方 |
| 🔴 高風險區（依 R1） | 對 R1 標記的高風險段落逐行檢查；對齊業務規則而非只看語法；標明哪些必須人工/cross-model 複查 |
| 架構規範 | 新增／搬移檔案的位置是否合規；載入 `fe-arch` skill 跑其 Code Review 檢查清單（見 `review-focus.md`「架構規範檢查」） |
| 討論追蹤 | 既有討論串中的修改建議是否已處理 |
| 敘述性宣稱 | 註解／JSDoc 裡的「否則會 X」「會造成 Y」逐條追控制流驗證（grep 該符號所有呼叫端、確認旗標在每個入口的狀態）；**特別查 diff 本身動過的註解**——動過就容易被當成已決議，之後只看措辭不看前提 |
| diff 外的同類寫法 | diff 裡出現的模式（三元式、錯誤處理樣板、判斷順序）拿去 grep 全 repo，報告「這次改了 N 處、repo 還有 M 處同樣寫法」。只看 diff 範圍會漏掉 reviewer 一 grep 就看到的重複 |
| 值得學習的模式 | （附屬，選用）辨識值得團隊參考的設計：資料層 fallback/正規化、防禦性工具函式、精確型別、非 happy path 測試覆蓋等 |

> **可維護性的數字門檻**：函式長度 `.ts` >50 行、`.tsx` >150 行（不含空行註解），巢狀深度 >4，單檔 >200 行，連續 ≥5 行實質重複，單一函式分支數 >15。完整依據見 [`fe-guardrails/references/thresholds.md`](../fe-guardrails/references/thresholds.md)——那是全 repo 的單一真相來源，數字有異動只改那一份。
>
> 超標的附 `檔案:行號` 與實際數字；**沒超標也要寫一句實測值**（「掃過 12 支函式，最長 43 行」），否則分不出是驗過沒事還是沒看。專案已裝對應 ESLint 規則時可直接引用 lint 輸出。

**需人工判斷的事項怎麼處理**：不另立 checklist 區塊。高風險區需人工/業務規則確認的點，寫進 Step R1「風險分流」表的「需人工確認」欄；其餘無法從 code 判定對錯的疑點，併入「合併建議」的理由（例如「待 X 確認後可合」）。

> **跨類型的優劣鏡片（共用/monorepo 尤其適用）**：技術審查時一併套用 `references/review-focus.md` 的「資深同儕的優劣鏡片」——差異/重複是成本、收斂要收對層（build-time variant 進 shared、runtime wiring 留 app）、只表達有語意的區分（`null` vs `undefined` 無語意差就用 nullish）、feature 收斂但 app page/spec 各複製一份＝收斂只做一半。

### Step R3.5: 判定 finding（fork 給 review-triage）

R3 的 finding 是自己找的，最容易一廂情願，組裝輸出前先交給乾淨上下文判定：

1. 照 review-triage「主對話的準備」存 finding 檔：來源 `others-mr`、`<key>` 用 `mr-<iid>`、R3 的 finding 原文照貼（含 R1 標的高風險區），附 MR iid、base 與 head SHA、本機能讀到 diff 的目錄
2. 呼叫 `/review-triage <finding 檔>`，等回報
3. R4 只用判定過的結果組裝，對應見 `references/output-format-review.md`：確認 → 需要修正；待驗證、質疑前提 → 想請作者確認；防禦性建議、風格 → 建議改進；撤銷 → 已檢查、不成立

R3 沒有任何 finding 就跳過這步。

### Step R4: 組裝輸出

按照下方「審查模式輸出格式」組裝 review 結果。**風險分流放最上方**，讓 reviewer 第一眼就知道注意力該放哪。

**篇幅原則（重要）**：目標是讓人 **1–2 分鐘看完、立刻知道能不能合**。只列有行動價值的項；正面確認一句帶過、不展開；同一觀點只講一次；「值得學習的模式」是附屬功能，放最後且預設折疊，不佔主要篇幅。

### Step R5: 詢問後續行動

在結尾詢問：
1. **回覆 MR comment** — 將審查建議回覆在 MR 的對應討論串下
2. **執行修復** — 依照「需要修正」項目進行程式碼修改
3. **存成 Heptabase 學習筆記** — 這張 MR 有值得記下的做法時，接 `fe-mr-read` 的學習筆記階段（Phase 3），沿用 R0 的理解，不重讀

`fe-mr-read` 關閉了模型呼叫，Skill 工具載不到；選 3 時直接 Read `~/.claude/skills/fe-mr-read/SKILL.md` 的 Phase 3 與它引用的 references 照做。

---

### 審查模式輸出格式

依 [`references/output-format-review.md`](references/output-format-review.md) 的 skeleton 組裝：**風險分流放最上方** → 技術審查結果（需要修正／建議改進／✅ 技術面 LGTM）→ 合併建議 → 值得學習的模式（附屬、折疊）→ 後續行動。

---

## 回覆評估模式 (Reply Mode)

處理自己 MR 上 reviewer 的留言。判定交給 `review-triage`（fork、乾淨上下文），這個模式只負責收留言、照判定修、逐則回覆。

### Step P1: 收集留言

從 Step 1 的 `mr_discussions` 取出所有未解決、別人留的留言。每則記下：discussion id、note id、作者、錨定的檔案與行號（DiffNote 的 `position.new_path`／`new_line`）、附件（影片、截圖）。資訊不足就請使用者貼上留言或指定要處理哪幾則。

### Step P2: 交給 review-triage 判定

照 review-triage「主對話的準備」存 finding 檔：來源 `reviewer`，留言原文照貼並附 P1 記下的欄位；不附自己的判斷。呼叫 `/review-triage <finding 檔>`，等回報。

回報裡有質疑前提或 ⚠ → 先停下來，把保留／推翻兩案交給使用者，不修也不回。

### Step P3: 照判定處理

| 判定 | 處理 |
|---|---|
| 確認 | 照回報的「修在哪裡」決定位置。在這張 MR 修：先寫跟重現層級一致、修正前會紅的測試，再修；回報標成「一類」的，照它的掃描結果一起修。commit subject 寫具體修了什麼，不寫 `address code review feedback` |
| 待驗證 | 先自己補驗證（照 reviewer 的描述用 drive 實跑）；重現不了再請使用者決定要不要向 reviewer 要步驟 |
| 撤銷、提問 | 不改程式 |
| 防禦性建議 | 照專案慣例收進追蹤票 |
| 質疑前提 | 使用者決定後才動 |

落在高風險區（身分驗證、審核狀態機、權限、個資、多步驟表單）的確認項，動手前先跟使用者對一次業務規則。

### Step P4: 逐則回覆

照 `references/reply-template.md` 在每則留言的討論串下各自回覆，不合成一筆總回覆。回覆方式（thread reply 或 individual note）與發完後的驗證見下方「Review comment 是 individual note」。

---

## 特殊情境處理

### MR 描述不完整

若 MR 描述過於簡略，在「合併建議」的原因裡點出（如「描述缺背景，建議補上目的與要解決的問題後再合」），不需另開區塊。

> 治本提醒：MR 讀起來費力，根源常在 generator 階段。可建議作者改用 `fe-mr-generator` 重產描述（含 Summary 圖與 Merge Danger），而非靠 review 端硬讀。

### 大型 MR（超過 500 行變更）

1. 先做 Step R1 風險分流，把高風險區獨立出來
2. 再產出變更摘要，列出各模組的變更重點
3. 建議拆分 MR 的方式（如果合理的話）
4. 一般區掃讀即可，火力集中在高風險區

### 討論串有未解決的 comment

在技術審查結果開頭標示：

> ⚠️ 此 MR 有 {N} 個未解決的討論，請確認是否已處理：
> - {討論內容摘要}

### Review comment 是 individual note（無法用 mr-reply 回覆）

GitLab 的 MR comment 分兩種，回覆前**務必先判斷**，用錯方式會失敗：

- **discussion thread**（`individual_note: false`）：可用 `mr-reply.sh <project> <mr_iid> <discussion_id> <body>` 回在該串下。
- **individual note**（`individual_note: true`）：**GitLab 不允許對它做 thread reply**，POST 到 `/discussions/:id/notes` 會被拒。常見於 CI bot、自動化工具貼的單則 comment（例如 automated code review bot）。

**判斷方式**——抓該 discussion 看 `individual_note` 欄位：

```bash
glab api "projects/<enc-path>/merge_requests/<iid>/discussions/<disc_id>" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('individual_note'))"
```

- `false` → 用 `mr-reply.sh` 回討論串。
- `true` → **改用 `mr-note.sh`** 貼一筆新 MR comment，並在內容開頭引用原 note（如 `> 回應 automated code review（note #NNN）`）保留脈絡。

**回覆後必做獨立驗證**：POST 後**別只信 script 回傳的成功 JSON**（可能是假成功——曾發生 `mr-reply` 回了看似成功的 note 物件，實際該 note 根本沒建）。用獨立查詢確認 note 真的出現在 MR，核對 `id` 與 `author`：

```bash
glab api "projects/<enc-path>/merge_requests/<iid>/notes?per_page=100" \
  | python3 -c "import sys,json;print([n['id'] for n in json.load(sys.stdin)][:5])"
```

---

## 語氣與表達規範

輸出遵循共用檔 [`_shared/fe-mr-common/writing-principles.md`](../_shared/fe-mr-common/writing-principles.md)「審查語氣」一節（白話先行、術語走名詞補充、不過度吹捧等）與其中的中文文案排版規範。

## Reference

- `references/high-risk-zones.md` — 申請／審核前端高風險區定義（Step R1 風險分流用）
- `references/review-focus.md` — 各類型（Feature / Bugfix / Refactor）審查焦點 + 資深同儕跨類型優劣鏡片（收斂邊界、介面複雜度、語意精準）+ 資深 reviewer 實戰關注點（跨專案蒸餾：錯誤與副作用分層、既有基建優先、state/cache 跨頁、robustness 雙面、契約與取數職責、死碼/驗證/測試品質、Next.js App Router/a11y/design token/相容性等）；Step R2 校準類型、Step R3 技術審查時參照
- `references/output-format-review.md` — 審查模式輸出格式 skeleton（Step R4 組裝輸出時參照）
- `references/reply-template.md` — 回覆評估模式逐則回覆的寫法
