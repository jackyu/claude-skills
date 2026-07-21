---
name: fe-issue
description: 將 PM 需求 Issue 轉換為前端技術 Issue 草稿。使用時機：(1) 用戶要求將 PM issue 轉為 RD/前端 issue, (2) 用戶提到需求拆解、技術拆解、issue 拆解, (3) 用戶要求分析 PM 需求並產出開發任務, (4) 用戶提到 subtask 拆解、開發任務規劃, (5) 用戶貼上 PM issue 內容要求轉成技術 issue。即使用戶只是提到「幫我看一下這個需求怎麼拆」也應觸發此 skill。
---

# PM to Frontend Issue

將 PM/PD 的需求 Issue 轉化為前端技術 Issue 草稿，包含技術描述、驗收條件、API 依賴、Subtask 拆解。

整個流程分為三個階段：先收集必要資訊，再產出草稿，最後可選擇自動建立 GitLab Issue。

## Phase 1：收集資訊

透過互動問答收集以下五項必要資訊。逐項確認，不要一次問完所有問題。如果用戶已經在對話中提供了部分資訊，直接跳過該項。

### 1.1 PM Issue 內容

接受以下任一方式取得 PM Issue 內容：
- 提供 GitLab Issue URL → 執行 `~/.claude/skills/_shared/fe-mr-common/scripts/issue-get.sh <issue_url>` 自動取得內容（也可傳 `<project_path> <issue_iid>`）
- 直接貼上 Issue 的 Markdown 內容
- 若 script 呼叫失敗，請用戶直接貼上內容作為 fallback

需要取得的資訊：
- Issue 連結 / ID
- Issue 標題
- 需求描述（User Story 或功能說明）
- 驗收條件（AC）
- 相關連結（Epic、設計稿等）

如果 PM Issue 內容有模糊之處，在此步驟就提出來跟用戶確認，不要帶著疑問進入拆解階段。

### 1.1.5 複雜度預判（Micro fast-path）

讀完 PM Issue 後立即評估是否符合 micro 條件（< 1 天的微型改動）：

- **關鍵字命中**：
  - 文字：錯字、typo、文案修正、拼字、用字
  - 樣式：顏色、色碼、色票、主題色、Dark mode、間距、padding、margin、字型、字體、邊框、圓角、陰影
  - 資源：圖片、icon、替換、更新圖、刪圖、新增圖
  - 檔案：移動、重命名、搬檔案、整理目錄
- **規模提示**：PM 描述 < 150 字、未提及新頁面 / 新 API / 新功能 / 新元件、無設計稿連結或僅單張截圖。

若符合，主動詢問用戶：
> 「看起來這是 <1 天的微型改動（{原因：錯字修正 / 色碼調整 / 圖片替換 …}），使用極簡模式可以加速產出，要切換嗎？」

- **用戶確認** → 進入 Micro fast-path：
  - 跳過 1.2 Figma（若涉及視覺，僅請用戶提供色碼 / 圖片路徑一行即可）
  - 1.3 簡化為 Grep 關鍵字定位到要改的檔案即止，不讀內部實作
  - 跳過 1.4 API 狀態（預設無 API 依賴）
  - 1.5 Labels 照舊自動擷取
- **用戶拒絕** → 維持完整 Phase 1 流程（依常規判斷落到 Small 或 Medium-Large）。

### 1.2 Figma 設計稿

詢問用戶如何提供設計稿資訊，支援三種方式：

**方式 A — Figma MCP（優先）**
請用戶提供 Figma 連結，透過 Figma MCP 的 `get_design_context` 工具分析設計稿。每個頁面 / 狀態各一個連結。

**方式 B — 截圖**
請用戶貼入設計稿截圖，標明每張對應的頁面。

**方式 C — 文字描述**
請用戶描述畫面結構、Tab 分類、欄位配置等。

分析設計稿後，整理出：
- 頁面 / Tab 結構樹
- 各頁面的主要 UI 元素
- 與現有頁面的差異點

將整理結果回饋給用戶確認，確保理解正確。

### 1.3 現有架構（AI 主動探索）

根據 1.1 的需求內容，主動探索 codebase（使用 Glob、Grep、Read）：

1. 找出與需求相關的現有頁面、元件、路由結構
2. 讀取相關檔案了解現有實作模式（如既有 Dialog、表單元件、mutation hook pattern）
3. 找出可複用的既有元件或模組

將探索結果整理後回饋用戶確認。如有不確定之處再向用戶補充詢問。

### 1.4 API 狀態

詢問：
- 既有 API 的比例（多少可以沿用）
- 哪些功能需要後端新 API
- 後端 Issue 是否已開（有的話提供連結）

### 1.5 Labels（自動擷取）

從 Phase 1.1 取得的 PM Issue 資料中自動擷取 labels：
- 從 API 回應的 `labels` 欄位解析 `# type::*`、`product::*`、`$ priority::*`
- 若 1.1 是用戶直接貼上文字且無法識別 labels，才詢問用戶

擷取結果回饋用戶確認即可。各 Label 類別的完整定義請參考：`references/gitlab-label-definition.md`

---

## Phase 2：產出草稿

收集完畢後，依照 `references/frontend-issue-template.md` 的結構產出草稿。

### 產出規則

**功能描述**
- 用前端技術語言重新描述需求，不要複製 PM 原文
- 如果有結構性變更，用樹狀圖呈現
- 標注平台限制

**驗收條件**
- 從 PM 的 AC 展開，補充前端技術層面的驗收項目
- 分為四個區塊：功能面、資料顯示、既有功能、測試品質
- 測試品質固定包含：
  - 所有新增/修改元件附帶單元測試
  - Coverage ≥ 80%（Statements & Branches）
  - API 串接層有 mock 測試

**API 依賴表**
- 表格格式，列出每個功能項目
- 標明：✅ 既有 API / ⚠️ 需新 API
- 需新 API 的附上後端 Issue 連結或標 TBD

**拆解策略（依複雜度決定）**

依 Phase 1.1.5 與 Phase 1 收集結果決定層級：

- **Micro Issue（< 1 天）**：使用「極簡三段」模式 — 關聯 + 實作範圍 + 預估一行。
  - 實作範圍用白話、動詞開頭（如「將 X 改為 Y」「替換 Z 圖片」），盡可能附上檔案路徑與行數
  - AC 與功能描述合併進實作範圍內，以一句話帶過
  - **不產出**：功能描述、驗收條件、API 依賴、技術備註、預估工時（獨立 section）、Subtask 拆解、影響範圍 / 風險、規格疑問警語

- **小型 Issue（1-3 天）**：使用「實作範圍」模式 — 扁平編號清單，搭配完整模版（含 AC、API 依賴、影響範圍等）。

- **中大型 Issue（4+ 天、多頁面 / 結構變更 / 多個新 API）**：使用「Subtask 拆解」模式 — 每個 Subtask 不超過 1-2 天，對應獨立 MR，包含：複雜度、說明、產出、測試、依賴、預估。

用戶可隨時要求切換層級。

**檔案路徑（架構規範）**

- Subtask 的「產出」欄列出的檔案路徑，必須符合 `fe-arch` skill 的架構規範——先載入 fe-arch，依其決策流程決定位置，不要憑印象寫路徑
- 從 issue 拆解階段就把正確路徑寫進 Subtask，開發者照著建檔，從源頭對齊

### 產出格式

直接輸出 Markdown 格式的草稿內容，不加外層 code block 包裹。在草稿頂部加上 PM Issue 關聯連結和規格疑問警語。

輸出完成後，進入 Phase 3 詢問是否自動建立 GitLab Issue。

---

## Phase 3：發佈至 GitLab

草稿產出後，詢問用戶是否需要協助將 Issue 建立到 GitLab 專案中。

### 不需要建立

提醒用戶：
1. 這是草稿，請審核拆解合理性並補充 AI 遺漏的專案脈絡
2. 確認後手動至 GitLab 建立 Issue
3. 建立 Related Link 關聯回 PM Issue
4. 設定 Labels

### 需要建立

1. 確認前端 GitLab 專案路徑（若 Phase 1.1 已取得 PM Issue 的專案路徑，可推算；否則詢問用戶）
2. 組合 Issue 內容：
   - **Title**：Phase 2 草稿標題，去掉 Markdown `#` 前綴
   - **Description**：Phase 2 完整草稿
   - **Labels**：Phase 1.5 擷取的 labels + `FE` + `workflow::Ready To Develop`
3. 使用 `~/.claude/scripts/gitlab/issue-create.sh` 建立 Issue：
   ```bash
   ~/.claude/scripts/gitlab/issue-create.sh "<project-path>" "<title>" \
     --description "<description>" \
     --labels "FE,workflow::Ready To Develop,..."
   ```
4. 建立成功後從 JSON 回應取得 `web_url` 回報用戶
5. 提醒用戶至 Issue 頁面確認內容，並手動建立 Related Link 關聯回 PM Issue

## Reference

完整的 Frontend Issue Template 結構請參考：`references/frontend-issue-template.md`
