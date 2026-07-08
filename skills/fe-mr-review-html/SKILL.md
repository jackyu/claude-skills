---
name: fe-mr-review-html
description: 將 GitLab Merge Request 審查結果產出為單一自包含 HTML artifact，含 inline diff 標註、嚴重程度色標、焦點區深度說明（streaming/backpressure、cache、並行控制等）。使用時機：(1) 用戶要求以 HTML/網頁形式呈現 review、產出 HTML artifact, (2) 用戶說「render the diff with inline annotations」「color-code findings by severity」, (3) 用戶想交付一份可分享、可離線、可印製的 review 報告給其他 reviewer/PM/QA, (4) 用戶說自己對 PR 中某個邏輯（streaming、backpressure、cache 策略、並行控制、reconnect 機制…）不熟，希望報告中能特別講解, (5) 用戶想用視覺化方式呈現 review 結果。即使用戶只說「幫我做一份這個 PR 的 HTML review」也應觸發。
---

# MR Review HTML

審查 GitLab Merge Request 並產出**單一自包含 HTML artifact**。

特別適合：

- 交付給非作者（其他 reviewer、PM、QA）閱讀的 review
- 用戶對 PR 中某個技術概念不熟，希望 reviewer 報告以視覺化方式講解
- 想將 review 結果存檔、分享、印製

> 本 skill **沿用 `fe-mr-review` 的審查分析邏輯**，僅替換輸出格式為 HTML 並加入「焦點區深度說明」。

> **報告撰寫風格**依 [`_shared/fe-mr-common/review-writing-principles.md`](../_shared/fe-mr-common/review-writing-principles.md)：白話先行（句子先講懂、第一次術語用「中文 (English)」）、複雜術語放該 finding 的 inline 註解「名詞補充」（HTML 折疊區塊）、不過度吹捧、商業邏輯用「就像…」比喻（與精確描述並存、限導讀/概念說明）。每個 finding **就地內嵌在對應 diff 行下方**（本 skill 的核心 UI 價值）。

---

## 與 fe-mr-review 的差異

| 面向 | fe-mr-review | fe-mr-review-html |
|------|--------------|-------------------|
| 輸出 | Markdown 文字 | 自包含 HTML 檔（CSS/JS 內嵌） |
| Diff 呈現 | 純文字描述（行號 + 建議） | 內嵌 diff blocks，**finding 就地嵌在對應行下方**（PR 風格、預設展開） |
| 合併建議 | 文字段落 | 頂部醒目橫幅（依結論上色 + severity 計數）|
| 嚴重程度 | 文字標籤 | 色標 + emoji + 邊條 + 計數 |
| 焦點區 | 一律平等審查 | 用戶指定的焦點區會多一個 deep-dive 區塊（概念說明、流程圖、術語表、踩雷點） |

> **完全採用 fe-mr-review 的審查邏輯與輸出結構，只把輸出換成 HTML UI。** 區塊順序對齊：合併建議（頂部橫幅）→ 導讀 → 🚦 風險分流 → 技術審查 findings（就地內嵌註解）→ 💡 值得學習（折疊附屬）→ 名詞補充。**無 Human Review Checklist**（人工確認併入風險分流「需人工確認」欄）、**無 TL 視角**。HTML 獨有：焦點區 deep-dive、就地內嵌 diff 註解。

---

## 流程

### Step 1: 解析「焦點區」(focusArea)

用戶通常會表達不熟悉的領域，例如：

- 「I'm not very familiar with the streaming/backpressure logic」→ `streaming/backpressure`
- 「focus on the cache invalidation」→ `cache invalidation`
- 「我看不太懂 WebSocket reconnect 的部分」→ `WebSocket reconnect`
- 「不熟 React Suspense 的行為」→ `React Suspense`

從用戶輸入抽取**焦點主題**，記為 `focusArea`。若無，`focusArea = null`，跳過 Step 6。

判定規則詳見 `references/focus-area-mode.md`。

### Step 2~5: 沿用 fe-mr-review 的分析邏輯

依序執行 `fe-mr-review` 的審查模式步驟：

1. **共用步驟** — 用 `mr-context.sh` 取得 MR meta + 未解決 discussions + diff
2. **Step R1 風險分流** — 讀 `fe-mr-review/references/high-risk-zones.md`，把變更切成高風險區 / 一般區；需人工/業務規則確認的點記下來（之後進「風險分流」表的「需人工確認」欄）
3. **Step R2 判斷 MR 類型** — 校準風險分流與合併建議理由
4. **Step R3 技術審查** — 套用審查焦點過濾原則，不列瑣碎問題；安全性逐項看過
5. **合併建議** — 收斂成 同意 / 有條件 / 不同意 + 一兩句原因（之後放頂部橫幅）

> 上述判定標準請直接讀取 `fe-mr-review/SKILL.md` 與 `fe-mr-review/references/*.md`。本 skill 不重複定義審查邏輯，**不產出 Human Review Checklist**（人工確認併入風險分流），僅替換輸出為 HTML。

### Step 6: 嚴重程度分級

將技術審查產出的問題依下表分級（詳見 `references/severity-system.md`）：

| 嚴重程度 | Emoji | 觸發條件 |
|---------|-------|---------|
| Critical | 🔴 | 會導致正式環境壞掉、資料損毀、安全漏洞 |
| High | 🟠 | 高機率出 bug、效能明顯退化、商業邏輯錯誤 |
| Medium | 🟡 | 維護性 / 可讀性問題，建議修但不擋 merge |
| Low | 🔵 | 風格 / 小重構，nice to have（技術觀察，不需動作）|
| Info | ⚪ | 觀察 / 補充說明，非問題（技術觀察，不需動作）|

每個 finding 標註：嚴重程度、檔案路徑、行號範圍、問題、建議、（選用）程式碼片段。`critical`/`high`/`medium` 屬「需要修正」、`low`/`info` 屬「技術觀察」；安全性問題以 `critical`/`high` 呈現。

### Step 7: 焦點區 Deep-Dive (focusArea 不為 null 時)

針對 `focusArea` 額外產出一個獨立區塊，包含：

1. **概念說明** — 80~150 字白話解釋這個概念（如 streaming = SSE/ReadableStream/...；backpressure = 下游消費跟不上時的回壓機制）。先用一句「就像…」生活化比喻建立心智模型，再接精確描述（比喻不取代精確說明）
2. **本 MR 中的實作流程** — 抽取相關檔案/函式，產出流程圖（用 inline SVG 或 mermaid，預設用 mermaid）
3. **關鍵程式片段** — 3~5 段帶 line range 的引用，每段附 80 字內白話解釋
4. **可能踩雷的點** — 列 3~5 個此概念的常見坑（buffer 溢位、未 release 資源、cancel 未處理…），並標註本 MR 是否處理到（✅ 有處理 / ⚠️ 部分處理 / ❌ 未處理 / N/A）
5. **術語表** — 4~8 個專門術語的一句話定義

> 焦點區的內容**獨立於 Step R2 的技術審查**，目的是教育與導讀。若 Step R2 的問題剛好落在焦點區範圍，在「可能踩雷的點」交叉引用該 finding。

詳細產出規範見 `references/focus-area-mode.md`。

### Step 8: 組裝 HTML

依 `assets/template.html` 的結構填入內容。HTML 必須符合：

- **單一檔案**：所有 CSS / JS 內嵌，不外連 CDN，可直接 `open` 或 attach 為 artifact
- **可離線**：不依賴網路資源（mermaid 用 inline SVG 渲染，避免外部腳本）
- **支援 print**：`@media print` 調整為 A4 可印
- **語意化 HTML**：使用 `<section>`、`<aside>`、`<details>`、`<mark>` 等正確標籤
- **可存取性**：色標不單獨傳遞資訊（同時用 emoji 或文字），所有互動元件可鍵盤操作
- **不引入 framework**：純 HTML + CSS + vanilla JS

**區塊順序**（對齊 fe-mr-review）：header → **合併建議橫幅** → alert banners → 導讀 → 🚦 風險分流 → 焦點區 deep-dive → 一致性 → findings（就地內嵌註解）→ 跨檔案 findings → 💡 值得學習（折疊）→ 名詞補充 → footer。

**篇幅原則**：頂部橫幅一眼定生死；finding 就地內嵌、預設展開；值得學習折疊不佔主要篇幅；正面確認一句帶過。痛點是一口氣 review 多個 MR，整份要能快速看完。

詳細結構、class 命名見 `references/output-html-structure.md`。

### Step 9: 輸出與後續

1. 將 HTML 寫入路徑 `/tmp/mr-review-{project_slug}-{mr_iid}.html`
2. 用 `SendUserFile` 將檔案以 `proactive` status 發送給用戶，caption 簡述焦點區與 findings 總數
3. 詢問後續行動（對齊 fe-mr-review R7）：
   1. **回覆 MR comment** — 將審查建議回覆在對應討論串
   2. **執行修復** — 依「需要修正」項目修改程式碼
   3. **Codex 作者視角回答 review 問題** — 交給本機 Codex 逐題回答，附 MR comment 草稿（需 Codex CLI；流程見 `fe-mr-review/references/codex-author-reply.md`）
   - （HTML 專屬）可將焦點區「概念說明 + 流程圖」回貼到 MR description

---

## Diff Annotation 規則

每個 finding 必須能對應到 diff 中的具體行（除非是跨檔案的架構性問題，放 `cross-file-findings` 區塊）。

HTML 結構簡述（**就地內嵌、預設展開**）：

- Diff 用 `<div class="diff">` 容器，每行為 `<span class="diff-line">`，含 `data-old-lno` / `data-new-lno`
- 有 finding 的行加 `data-finding-id="f-001"` + 左側 severity 色邊 + 行尾 `<span class="line-flag">◀ {emoji}</span>`
- **註解 row `<div class="inline-annotation">` 直接插在該行正下方**（不是右側 margin card），同一行多 finding 就堆疊多個 row
- 篩選 / 全部收合（縮成單行）/ 計數 chip 跳轉，互動已內建於 template.html

完整 HTML 結構、CSS class、JS 互動行為見 `references/diff-annotation.md`。

---

## 共用規範

- **中文文案排版**：沿用 `fe-mr-review` 規則（中英文加空格、全形標點等）
- **審查焦點過濾原則**：沿用 `fe-mr-review` Step R2 的過濾規則，不列瑣碎問題（風格、格式、命名偏好…）
- **大型 MR（>500 行）**：先輸出變更摘要區塊（modules + 各別行數），再進入 findings
- **未解決討論串**：在合併建議橫幅下方以警示 banner 標示「{N} 個未解決討論」

---

## 何時不該用本 skill（改用 fe-mr-review）

- 用戶只要快速 review 結論，不需要 artifact
- MR 變更 < 30 行純文件/樣式：HTML artifact 過重，用 fe-mr-review 即可
- 用戶明確說「請用文字回我」
