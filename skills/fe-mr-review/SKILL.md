---
name: fe-mr-review
description: AI 輔助 GitLab Merge Request 審查與 Review Comment 回覆。使用時機：(1) 用戶要求審查 MR/PR, (2) 用戶提到 merge request review、PR review, (3) 用戶要求產出 code review 並包含人工確認項目, (4) 用戶提到要讓 AI 先 review 再由人確認, (5) 用戶要求針對 GitLab MR 進行審查, (6) 用戶要求分析 review comments, (7) 用戶提到 code review 回覆、review 回應, (8) 用戶說 MR 上有 review 建議要處理, (9) 用戶說要處理 review feedback。即使用戶只是說「MR 上有 review 幫我看一下」也應觸發此 skill。
---

# MR Review

AI 輔助 GitLab Merge Request 審查工具，支援兩種模式：

| 模式 | 觸發情境 | 核心產出 |
|------|---------|---------|
| **審查模式 (Review)** | 審核成員發出的 MR | 風險分流 + 技術審查 + 合併建議 |
| **回覆評估模式 (Reply)** | MR 上有 review comments 需處理 | Accept / Dismiss / Discuss 分類回覆 |

## 審查哲學：嚴謹搬家，但有一塊不能搬

「每一行邏輯對不對、命名/格式/規範有沒有守」這類**有標準答案**的事，交給有標準答案的工具——linter、type checker，加上 AI 直接掃。人不該耗在這層。

人要看的是機器看不了的三件事：**意圖對不對、架構與 bounded context 有沒有守住、高風險區的業務規則對不對。**

**但券商情境有一塊嚴謹不能往兩頭搬**——下單、金額/股數精度、權限邊界、報價一致性、金流狀態機。所以本 skill 的第一個動作不是技術審查，而是**風險分流**：把 MR 切成「高風險區（人逐行看）」與「一般區（自動化 + agent 掃）」。99% 不看，1% 看到死。

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

一次取得 MR 基本資訊（標題、描述、來源/目標分支、作者、labels）+ 未解決討論串 + changed files + diff。

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

完成共用步驟後，執行以下步驟。**Step R1 風險分流務必最先做**，它決定後面每一段要用什麼強度審查。

### Step R1: 高風險區分流（最優先）

讀取 `references/high-risk-zones.md`，掃過完整 diff，把每一段變更分類為「高風險區」或「一般區」。

判斷依據：是否觸及下單/委託邏輯、金額與股數精度計算、權限與身份邊界、即時報價/資料一致性、金流狀態機。參考檔內有每一域的訊號關鍵字、前端常見錯法與 reviewer 確認點。

分流結果決定審查強度：

| 分類 | 審查強度 |
|------|---------|
| **高風險區** | 逐行細看；對齊 spec / PM 業務規則；建議 cross-model 複查；要求明確驗收標準 |
| **一般區** | 自動化 + AI 掃描即可，聚焦意圖與架構，不逐行 |

關鍵認知：高風險區的錯常是「業務規則錯」而非「語法錯」，linter / type checker / cross-model **都未必抓得到**，必須人看並回去對齊業務規則。

若 diff 完全未觸及任一高風險域，明確標示「本次無高風險區變更，採一般審查強度」，不要含糊帶過。

> **Cross-Context / Cross-Model 提示**：本 skill 在乾淨 session 只看最終產物（不帶產出時的對話歷史），本身即為 cross-context review。高風險區可再請不同 model 複查一次（例如 Codex 看 Claude 寫的），blind spot 不同。

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
| 可維護性 | 重複邏輯、過長函式、magic number |
| 🔴 高風險區（依 R1） | 對 R1 標記的高風險段落逐行檢查；對齊業務規則而非只看語法；標明哪些必須人工/cross-model 複查 |
| 架構規範 | 新增／搬移檔案的位置是否合規；載入 `fe-arch` skill 跑其 Code Review 檢查清單（見 `review-focus.md`「架構規範檢查」） |
| 討論追蹤 | 既有討論串中的修改建議是否已處理 |
| 值得學習的模式 | （附屬，選用）辨識值得團隊參考的設計：資料層 fallback/正規化、防禦性工具函式、精確型別、非 happy path 測試覆蓋等 |

**需人工判斷的事項怎麼處理**：不另立 checklist 區塊。高風險區需人工/業務規則確認的點，寫進 Step R1「風險分流」表的「需人工確認」欄；其餘無法從 code 判定對錯的疑點，併入「合併建議」的理由（例如「待 X 確認後可合」）。

> **跨類型的優劣鏡片（共用/monorepo 尤其適用）**：技術審查時一併套用 `references/review-focus.md` 的「資深同儕的優劣鏡片」——差異/重複是成本、收斂要收對層（build-time variant 進 shared、runtime wiring 留 app）、只表達有語意的區分（`null` vs `undefined` 無語意差就用 nullish）、feature 收斂但 app page/spec 各複製一份＝收斂只做一半。

### Step R4: 組裝輸出

按照下方「審查模式輸出格式」組裝 review 結果。**風險分流放最上方**，讓 reviewer 第一眼就知道注意力該放哪。

**篇幅原則（重要）**：目標是讓人 **1–2 分鐘看完、立刻知道能不能合**。只列有行動價值的項；正面確認一句帶過、不展開；同一觀點只講一次；「值得學習的模式」是附屬功能，放最後且預設折疊，不佔主要篇幅。

### Step R5: 詢問後續行動

在結尾詢問：
1. **回覆 MR comment** — 將審查建議回覆在 MR 的對應討論串下
2. **執行修復** — 依照「需要修正」項目進行程式碼修改

---

### 審查模式輸出格式

```
# MR Review: {MR 標題}

**MR 連結：** {URL}
**作者：** {作者}
**MR 類型：** {feature / bugfix / refactor / unknown}
**變更範圍：** {簡述變更了哪些模組/功能}
**檔案數：** {N} 個檔案，+{additions} / -{deletions}

---

## 🚦 風險分流

> 整份 MR 最先看這裡。決定 reviewer 注意力該放哪。

### ⚠️ 高風險區（請逐行細看 + 對齊業務規則）

| 區域 | 觸及的高風險域 | 為什麼高風險 | 需人工/cross-model 確認的點 |
|------|---------------|-------------|---------------------------|
| `{檔案}:{行數}` | {下單/精度/權限/報價/金流} | {後果} | {確認什麼業務規則} |

<!-- 若無，寫：本次無高風險區變更，採一般審查強度。 -->

### 🟢 一般區

{簡述其餘變更，這些交給自動化 + AI 掃描，不逐行}

---

## 🤖 技術審查結果

### 需要修正

#### {問題標題}
- **位置**: `{檔案路徑}:{行數}`
- **問題**: {具體描述}
- **建議**: {改進方式}

### 建議改進

- {非必要但建議優化的項目}

### ✅ 技術面 LGTM

{如果沒有問題，簡述已確認無誤的項目}

---

## ✅ 合併建議

**結論**：{同意合併 / 有條件合併 / 不同意合併}
**原因**：{一兩句講清楚——基於哪些 finding 或風險。有條件合併要寫「補完 X 即可合」；待人工/跨團隊確認的點也寫在這裡。}

---

<details>
<summary>💡 值得學習的模式（附屬功能，選用，點開看）</summary>

> 僅在真有團隊參考價值時才列；沒有就整段省略。一個模式一兩句講完，別佔篇幅。

- **{模式名稱}** `{檔案:行數}` — {白話講做了什麼、好在哪，具體不誇飾}
  - 名詞補充（選用）：{術語「中文 (English)」一句解釋}

</details>

---

## 🔜 後續行動

需要我執行以下操作嗎？
1. **回覆 MR comment** — 將審查建議回覆在 MR 的對應討論串下
2. **執行修復** — 依照「需要修正」項目進行程式碼修改（可全部或選擇性修正）
```

---

## 回覆評估模式 (Reply Mode)

完成共用步驟後，執行以下步驟。

核心價值：本地 AI 能讀整個專案，理解元件關係與 Business Logic，能判斷 review comment 在「這個專案的脈絡下」到底合不合理。Reviewer 只看 diff，本地 AI 看全貌。

### Step P1: 收集 Review Comments

從 Step 1 的 `mr_discussions` 中提取所有未解決的 review comments。

若 discussions 資訊不足，請用戶補充：
- 直接貼上 review comments 的文字內容
- 指定要處理哪些 comments

同時確認：
- **MR 編號**：用於回覆時標註
- **關聯 Issue**：用於理解這個 MR 的開發目的

### Step P2: 讀取專案 Context

這是本地 AI 的關鍵優勢。在分析 review comments 之前，先讀取：

1. **CLAUDE.md**：取得專案的 coding convention 和架構資訊
2. **本次 MR 變更的檔案**：透過 Step 2 的 diff 取得完整變更內容（不只是 diff，還要看周邊邏輯）
3. **相關的既有程式碼**：被變更檔案 import 的模組、共用元件、型別定義

### Step P3: 逐條分析

對每一條 review comment 進行分析，分類為三種：

**✅ 採納（Accept）**
建議在專案脈絡下是合理的，應該修正。
- 說明為什麼合理
- 直接修正程式碼
- 記錄修正的 commit hash

**⏭️ 不採納（Dismiss）**
建議在通用場景可能對，但在這個專案的脈絡下不適用。
- 說明不適用的原因（引用具體的專案脈絡，例如：coding convention 規定、既有 pattern、業務邏輯需求）
- 這是本地 AI 最有價值的判斷

**💬 需討論（Discuss）**
建議涉及設計決策或架構層面，AI 無法單獨判斷，需要人工 reviewer 介入。
- 說明為什麼需要討論
- 提供兩方觀點讓 reviewer 參考

分析原則：
- 不要盲目全部採納，review comments 有一定的 false positive 率
- 不要為了省事全部不採納，確實有道理的建議要接受
- 拿不準的就標為「需討論」，寧可多討論也不要自己亂判斷
- 若 comment 涉及高風險區（下單/精度/權限/報價/金流），即使看起來可採納，也傾向標為「需討論」並對齊業務規則後再動

### Step P4: 執行修正

對於標記為「✅ 採納」的項目，直接在本地修正程式碼，commit 後記錄 hash。

```bash
# 修正完成後
git add <修改的檔案>
git commit -m "fix: address code review feedback"
```

### Step P5: 產出回覆

依照 `references/reply-template.md` 的格式，產出統一的一筆 MR Comment。

產出規則：
- 直接輸出 Markdown，不加 code block 包裹
- 每條 review comment 都要有對應的回覆，不能遺漏
- 採納的項目要附上 commit hash
- 不採納的項目要有具體的專案脈絡解釋，不能只說「不適用」
- 需討論的項目要 @mention reviewer

產出後提醒用戶：
1. 確認回覆內容是否合理
2. 確認修正的程式碼是否正確
3. 推上去後將回覆貼到 MR Comment
4. 如果有「需討論」的項目，主動找 reviewer 對齊

---

## 特殊情境處理

### MR 描述不完整

若 MR 描述過於簡略，在「合併建議」的原因裡點出（如「描述缺背景，建議補上目的與要解決的問題後再合」），不需另開區塊。

> 治本提醒：MR 讀起來費力，根源常在 generator 階段。可建議作者改用 `fe-mr-generator` 重產描述（含概念地圖與風險分流），而非靠 review 端硬讀。

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

review 的唯一目的是讓人**快速看懂這個 MR 在幹嘛**，不是寫技術論文，也不是給作者頒獎。完整規範（語氣不過度吹捧、白話先行、第一次術語用「中文 (English)」、複雜術語放段落末「名詞補充」、改寫前後對照範例）見共用檔 [`_shared/fe-mr-common/review-writing-principles.md`](../_shared/fe-mr-common/review-writing-principles.md) §1。重點：

- **語氣**：不過度吹捧、形容詞克制、用口語自述句，像在跟同事口頭講解。
- **術語**：句子先用白話講懂、能獨立讀懂；第一次術語標「中文 (English)」；需展開的複雜術語（DI factory、blast radius 之類）不塞主句，放段落末「名詞補充」當學習素材；一句最多一兩個術語。

## 中文文案排版規範

依循 [中文文案排版指北](https://github.com/sparanoid/chinese-copywriting-guidelines)：

- 中英文之間加空格：`使用 React 開發`
- 中文與數字之間加空格：`共 5 個檔案`
- 使用全形標點：，、。；：「」
- 專有名詞使用官方大小寫：`GitHub`、`JavaScript`、`TypeScript`

## Reference

- `references/high-risk-zones.md` — 券商前端高風險區定義（Step R1 風險分流用）
- `references/review-focus.md` — 各類型（Feature / Bugfix / Refactor）審查焦點 + 資深同儕跨類型優劣鏡片（收斂邊界、介面複雜度、語意精準）+ 資深 reviewer 實戰關注點（跨專案蒸餾：錯誤與副作用分層、既有基建優先、state/cache 跨頁、robustness 雙面、契約與取數職責、死碼/驗證/測試品質、Next.js App Router/a11y/design token/相容性等）；Step R2 校準類型、Step R3 技術審查時參照
- `references/reply-template.md` — 回覆評估模式輸出範本
