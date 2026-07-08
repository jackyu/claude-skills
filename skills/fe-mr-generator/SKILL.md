---
name: fe-mr-generator
description: 生成 Git Merge Request 的 Title 與 Description。使用時機：(1) 用戶要求產生 MR 描述, (2) 用戶要求整理 branch 變更內容, (3) 用戶提到 merge request、MR、pull request、PR 內容撰寫, (4) 用戶開發完成要推 MR, (5) 用戶提到要開 MR 或發 PR。即使用戶只是說「幫我產 MR 描述」也應觸發此 skill。
---

# MR Content Generator

根據 Git branch 的 commit 與 diff，產出結構化的 MR Title 與 Description。

核心原則：MR 是知識載體，不只是變更清單。讓 reviewer 不只知道改了什麼，還能學到為什麼這樣改。

**送到 review 桌上時，MR 就該是 review-ready 的。** 「讀起來費力」不是 reviewer 該自己克服的問題，是 MR 在產出階段就沒長好。一份好的 MR 描述聚焦在 reviewer 難以自行從 code 還原的核心：用一張純文字概念地圖讓人 30 秒掌握全貌、講清楚為何而做、做了什麼。其餘「diff 看得出來」的資訊（逐項功能、架構選擇、一般 review 重點、學習點）不重複描述，留給程式碼本身與 reviewer 端的審查工具；開發過程的解題思維也不需要向 reviewer 完整交代。

## Workflow

### Step 1: 收集 Context

在分析 commit 之前，先確認以下資訊（對話中已提供的跳過）：

1. **關聯 Issue**：這個 MR 對應哪張 Issue？（必要，用於 `Closes #xxx`）
2. **Subtask 對應**：對應 Issue 中的哪個 Subtask？（選填）
3. **PM Issue**：上游的 PM Issue 編號（選填）

### Step 2: 確認分支資訊

```bash
# 取得當前 branch
git branch --show-current

# 確認有 commit 差異（預設目標 branch 為 main，使用者指定則以其為準）
git log --oneline main..HEAD
```

若無差異，告知使用者後結束。

### Step 3: 蒐集變更資訊

```bash
# commit 摘要
git log --oneline main..HEAD

# 詳細 commit 訊息
git log --format="%h %s%n%b" main..HEAD

# 變更檔案統計
git diff --stat main..HEAD

# 完整 diff
git diff main..HEAD
```

也可使用 `scripts/get_commits.sh`：

```bash
./scripts/get_commits.sh           # 預設比對 origin/main
./scripts/get_commits.sh -b rc/1.9.3  # 指定 base branch
./scripts/get_commits.sh -v        # 含檔案統計
```

### Step 4: 分析變更內容

從 commit 和 diff 中識別（只取進描述會用到的核心，diff 看得出來的不另外整理）：

- **變更動機**：這個 branch 要解決什麼問題
- **概念地圖元素**：哪些模組動了、資料怎麼流、bounded context 的邊界畫在哪。這是 reviewer「看圖不看 code」的依據，務必在 diff 裡釐清「本次動了什麼、刻意不碰什麼」
- **功能分組**：將變更按功能/需求分組，用功能描述不用檔案路徑（只點核心意圖，逐項列舉交給 diff）
- **測試變更**：新增或修改的測試檔案；風險較高的變更，驗收標準要寫清楚

### Step 5: 判斷複雜度

根據變更內容判斷 MR 複雜度，決定哪些區塊要寫：

**簡單**（單一元件調整、樣式修改、文案更新、設定檔變更）
→ 只寫：關聯、為什麼、做了什麼、測試說明

**一般**（新增頁面/元件、API 串接、既有功能修改）
→ 加上概念地圖

**複雜**（架構重構、跨模組影響、效能優化、新技術導入）
→ 概念地圖必寫

### Step 6: 產生 MR Title

依照 `references/mr-title-rules.md` 產生 Title。要點：

- **通用**：沿用 Issue 原 title 不改寫、Subtask 加 ` - <subtask title>`、`[#xxx]` 前綴
- **monorepo 專案**：依變更路徑補前綴 — `apps/client` → `前台`、`apps/admin` → `後台`、兩者都動 → `前/後台`、只動 `packages/*` → `共用`
- **其他專案**：有 issue id 一律加 `[#xxx]`，無則可省略

先判斷專案，monorepo 需再判斷變更目錄：

```bash
basename "$(git rev-parse --show-toplevel)"   # 判斷是否為 monorepo
git diff --name-only main..HEAD               # monorepo 用於判斷 client / admin 前綴
```

完整格式與範例見 `references/mr-title-rules.md`。

### Step 7: 產生 MR Description

依照 `references/mr-description-template.md` 的結構，根據 Step 5 判斷的複雜度決定填寫哪些區塊。

產出規則：
- 用功能描述，禁止出現任何檔案路徑
- 「為什麼」放在「做了什麼」前面，動機先行
- **概念地圖用純文字 ASCII 箭頭表達流向**，在 MR 中用程式碼區塊（```）包住以保留排版；只畫模組與資料流，禁止檔案路徑。目標是讓 reviewer 不讀 code 也能看懂架構長相
- 做了什麼只點核心意圖，逐項功能交給 diff，不逐條複述
- 測試步驟跟修改內容一一對應；風險較高的變更，驗收標準寫明確
- **不寫**架構決策、Review 重點/風險分流、學習重點、解題過程的思考脈絡——前三者 reviewer 從 diff 與審查工具即可獲得，解題思維則不是 MR 該交代的內容
- **description 最後一行固定附隱形標記** `<!-- mr:fe-mr-generator -->`（HTML comment，GitLab 渲染後不顯示）。此標記供 `/push` 的 PreToolUse hook 驗證「描述確實由本 skill 產生」；缺少標記會被擋下建立 MR，**務必保留**

### Step 8: 輸出結果

將 MR Title + Description 用 markdown code block 包裹輸出，讓使用者可以直接複製貼上。

````
```markdown
<title>

<description>

<!-- mr:fe-mr-generator -->
```
````

`<!-- mr:fe-mr-generator -->` 是隱形驗證標記（見 Step 7），渲染後不顯示，但**必須**留在 description 內，否則 `/push` 建立 MR 時會被 hook 擋下。

輸出後提醒用戶：
1. 確認內容後複製貼到 GitLab MR
2. 補上截圖（前端 UI 變更必附前後對比）

## 格式嚴格規範

- **禁止出現任何檔案路徑**（包含相對路徑），一律用功能描述取代
- **禁止 Markdown 連結格式中包含路徑**
- **禁止任何 URI / scheme**

## 語氣與表達規範

MR 描述的目的是讓 reviewer **快速看懂這個 MR 在幹嘛**，不是寫技術論文，也不是給自己頒獎。寫的時候想像你在跟同事口頭講解這次改了什麼。

這條規範約束「為什麼要這樣做」「做了什麼」等帶有技術敘述的內容。

### 語氣

- **不要過度吹捧。** 不用「教科書級」「堪稱典範」「極為優雅」這類誇飾。做得好就簡單講「這裡這樣處理比較好」就夠了。
- 評價要具體講「好在哪」，但形容詞克制。重點放在做了什麼、帶來什麼好處。
- 用口語的自述句，像在跟人說話。不要一句話塞滿縮寫和術語、讀起來像 commit message。

### 技術名詞的處理（最重要）

- 句子**先用白話把事情講清楚**——發生什麼、為什麼好——而且要能獨立讀懂，不依賴讀者已經懂那些英文縮寫。
- 第一次出現的術語用「中文 (English)」格式，例如 `覆蓋率 (coverage)`、`統一入口 (barrel)`。
- 真正需要展開解釋的術語（像 DI factory、blast radius 這種），**不要塞進主句**。主句先講懂，術語放到段落最後的「名詞補充」當作學習素材。
- 一句話最多一兩個術語，超過就拆句。

### 範例（同一段，改寫前後對照）

❌ 改寫前——全是縮寫，不懂這些詞就完全讀不下去：

> DI factory 把 token 來源 per-broker 留在呼叫端、型別乾淨（readonly / 無 any）、零消費者引用 blast radius 為零、coverage 靠「改從 barrel 入口 import = 貼近真實用法」自然補滿而非硬寫。

✅ 改寫後——先讀懂，術語放最後：

> 這個工廠函式的設計不錯：它沒有把「每一家券商的 token 從哪來」寫死，而是交給呼叫的人決定，所以之後要換券商，不用動到工廠本身。型別也寫得乾淨，該唯讀的有標 `readonly`、全程沒有用 `any` 帶過。另外目前沒有別的地方直接 import 它，所以這次改動影響範圍很小，幾乎不會波及其他檔案。測試覆蓋率 (coverage) 也不是硬湊的——把 import 改成從統一入口進來，順帶就貼近真實使用方式，覆蓋率自然就補上了。
>
> **名詞補充**（給想深入了解的人）
> - **工廠函式 / 依賴注入工廠 (DI factory)**：專門負責「產生並組裝好一個物件」的函式，把「要用哪些依賴」的決定集中在一處，方便日後抽換。
> - **影響範圍 (blast radius)**：改一段 code 會波及到的範圍；範圍越小越安全。
> - **統一入口 (barrel)**：用一個 index 檔把多個模組集中 re-export，外部只從這個入口 import。

## 邊界情況處理

- **未提交的變更**：提醒使用者先 commit 或 stash
- **無 commit 差異**：告知使用者後結束
- **commit message 不夠清楚**：主動詢問使用者補充變更動機

## Reference

- `references/mr-title-rules.md` — MR Title 規則（含 monorepo 前綴邏輯）
- `references/mr-description-template.md` — MR Description 完整模板
