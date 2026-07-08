# HTML Output 結構

> 區塊順序對齊 `fe-mr-review`（**合併建議頂部 → 導讀 → 風險分流 → 技術審查 findings → 值得學習折疊 → 名詞補充**），並保留本 skill 獨有的「焦點區 deep-dive」與「就地內嵌的 diff 註解」。**無 Human Review Checklist、無 TL 視角**（人工確認併入風險分流）。

## 整體區塊順序

```
1.  <header class="mr-header">             — MR 基本資訊
2.  <section class="merge-verdict ...">    — ✅ 合併建議（頂部醒目橫幅）+ severity 計數 + 焦點徽章
3.  <section class="alert-banners">        — 未解決討論 / 大型 MR 警示（選用）
4.  <section class="mr-overview">          — 🧭 這個 MR 在做什麼（比喻 + 技術 + ⚖️ 設計判斷）
5.  <section class="risk-triage">          — 🚦 風險分流（高風險區表 + 一般區）
6.  <section class="focus-deep-dive">      — 🎯 焦點區深度說明（focusArea 不為 null 時）★本 skill 獨有
7.  <section class="consistency">          — 🔗 一致性與共用（選用）
8.  <section class="findings">             — 🔍 發現的問題：diff + 就地內嵌註解（預設展開）
9.  <section class="cross-file-findings">  — 🌐 架構性 findings（無對應行，選用）
10. <details class="learning-patterns">    — 💡 值得學習的模式（附屬，折疊，選用）
11. <section class="term-glossary">        — 📖 名詞補充
12. <footer>                               — 生成時間、skill 版本
```

> **需要修正 vs 技術觀察**：對齊 fe-mr-review 的「要動作 / 不需動作」分流——HTML 用 severity 表達：`critical`/`high`/`medium` = 需要修正、`low`/`info` = 技術觀察。**安全性問題**不另立區塊，以 `critical`/`high` severity 出現在 findings。

## 各區塊細節

### 1. MR Header

```html
<header class="mr-header">
  <div class="mr-meta">
    <span class="mr-type-badge type-feature">FEATURE</span>
    <a class="mr-link" href="{mr_url}">!{mr_iid}</a>
    <span class="mr-author">by {author}</span>
  </div>
  <h1 class="mr-title">{mr_title}</h1>
  <div class="mr-stats">
    <span>{N} files</span>
    <span class="additions">+{additions}</span>
    <span class="deletions">-{deletions}</span>
    <span>{source_branch} → {target_branch}</span>
  </div>
  <p class="mr-description-summary">{MR description 摘要，最多 200 字}</p>
</header>
```

### 2. 合併建議（頂部醒目橫幅）

一打開就在最上方看到結論——痛點是一口氣 review 多個 MR，要立刻知道能不能合。依結論上色：`verdict-approve`（綠）/ `verdict-conditional`（黃）/ `verdict-reject`（紅）。橫幅內併入 severity 計數 chips 與焦點徽章，當「一眼總覽」。

```html
<section class="merge-verdict verdict-conditional">
  <div class="verdict-line">
    <span class="verdict-chip">🟡 有條件合併</span>
  </div>
  <p class="verdict-reason">{一句原因：基於哪些 finding 或風險；有條件合併寫「補完 X / 待後端對齊 Y 即可合」；待人工確認的點也寫這裡}</p>

  <div class="severity-counts" role="group" aria-label="findings by severity">
    <button class="count severity-critical" data-filter="critical"><span aria-hidden="true">🔴</span><strong>{N}</strong><span>Critical</span></button>
    <!-- high / medium / low / info；無該級數時加 class="count ... zero" -->
  </div>

  <div class="focus-badge" data-focus="streaming/backpressure">🎯 焦點：streaming/backpressure</div>
</section>
```

> 結論用語對齊 fe-mr-review「✅ 合併建議」：同意合併 / 有條件合併 / 不同意合併 + 一兩句原因。

### 3. Alert Banners（選用）

```html
<section class="alert-banners">
  <div class="banner banner-warning">
    ⚠️ 此 MR 有 3 個未解決的討論串，請確認是否已處理
    <ul><li>...</li></ul>
  </div>
  <div class="banner banner-info">
    ℹ️ 大型 MR（547 行變更），建議拆分為 2~3 個獨立 MR
  </div>
</section>
```

### 4. MR Overview（導讀）

開頭導讀，比喻版與技術版並存（比喻只在此區，不取代精確描述）。

```html
<section class="mr-overview">
  <h2>🧭 這個 MR 在做什麼</h2>
  <p class="analogy"><strong>比喻：</strong>{用「就像…」一句話建立心智模型}</p>
  <p class="technical"><strong>技術：</strong>{一句精確描述實際做了什麼}</p>
  <p class="design-judgment">⚖️ 設計判斷（有疑慮才列）：{值不值得做 / 有沒有更簡單做法 / 什麼會被影響}</p>
</section>
```

### 5. 🚦 風險分流

對齊 fe-mr-review 的高風險區分流（不是舊的「拉低/拉高」表）。掃過 diff，把觸及下單/精度/權限/報價/金流的段落列成高風險區表，**人工確認的點寫在「需人工確認」欄**（取代被移除的 Human Review Checklist）；其餘為一般區。

```html
<section class="risk-triage">
  <h2>🚦 風險分流</h2>

  <h3 class="high-risk">⚠️ 高風險區（逐行細看 + 對齊業務規則）</h3>
  <table class="risk-table">
    <thead><tr><th>區域</th><th>觸及高風險域</th><th>為什麼高風險</th><th>需人工確認</th></tr></thead>
    <tbody>
      <tr><td><code>{檔案:行數}</code></td><td>{下單/精度/權限/報價/金流}</td><td>{後果}</td><td>{確認什麼業務規則 / 跨團隊契約}</td></tr>
    </tbody>
  </table>
  <!-- 若無高風險：用一句「本次無高風險區變更，採一般審查強度」取代上表 -->

  <p class="general-zone">🟢 一般區：{簡述其餘變更，交給自動化 + AI 掃描，不逐行}</p>
</section>
```

### 6. Focus Deep-Dive（僅當 focusArea 存在）★本 skill 獨有

依 `focus-area-mode.md` 規範產出，5 個子段落（概念說明、流程圖、關鍵程式片段、踩雷點、術語表）：

```html
<section class="focus-deep-dive" id="focus">
  <h2>🎯 焦點區深度說明：{focusArea}</h2>
  <article class="concept-explainer">...</article>
  <article class="implementation-flow"><h3>本 MR 中的實作流程</h3><svg class="flow-diagram" ...>...</svg></article>
  <article class="key-excerpts"><h3>關鍵程式片段</h3><figure class="code-excerpt">...</figure></article>
  <article class="pitfalls"><h3>可能踩雷的點</h3><ul class="pitfalls-list">...</ul></article>
  <article class="glossary-block"><h3>術語表</h3><dl class="glossary">...</dl></article>
</section>
```

### 7. 一致性與共用（選用）

```html
<section class="consistency">
  <h2>🔗 一致性與共用</h2>
  <dl>
    <dt>既有類似做法</dt>
    <dd><a href="{blob_url}#L{line}"><code>{file}:{line}</code></a> — {專案裡已有的 function/component/pattern}</dd>
    <dt>差異</dt><dd>{這次寫法和既有差在哪，差異是否有意義}</dd>
    <dt>建議</dt><dd>{可否共用既有的；或命名/資料流/檔案位置如何向慣例對齊}</dd>
  </dl>
</section>
```

> 無一致性問題時整段省略。

### 8. Findings（Diff + 就地內嵌註解）

依 `diff-annotation.md` 規範：每個變更檔案一個 `<section class="file-diff">`，單欄佈局，**finding 註解就地嵌在對應 diff 行正下方、預設展開**（不再有右側 margin 卡片）。預設按嚴重程度排序檔案：含 critical/high 的排前面。

篩選 / 收合 toolbar：

```html
<div class="findings-toolbar">
  <label><input type="checkbox" checked data-filter="critical"> 🔴 Critical</label>
  <label><input type="checkbox" checked data-filter="high"> 🟠 High</label>
  <!-- medium / low / info -->
  <button class="expand-all">全部展開</button>
  <button class="collapse-all">全部收合</button>
</div>
<section class="findings">
  <!-- file-diff（diff 行與 inline-annotation 交錯，見 diff-annotation.md） -->
</section>
```

### 9. Cross-File Findings（選用）

無對應行的架構性 finding，卡片改靜態（非 sticky）：

```html
<section class="cross-file-findings">
  <h2>🌐 跨檔案 / 架構性 Findings</h2>
  <div class="inline-annotation severity-medium" id="f-007">
    <div class="ia-head"><span class="severity-tag">🟡 Medium</span><span class="finding-id">#f-007</span></div>
    <h4>{標題}</h4><p class="issue">{問題}</p><p class="suggestion"><strong>建議：</strong>{建議}</p>
  </div>
</section>
```

### 10. 💡 值得學習的模式（附屬，折疊，選用）

鏡像 fe-mr-review 的折疊附屬段——預設折疊、不佔主要篇幅，只在真有團隊參考價值時才列；沒有就整段省略。

```html
<details class="learning-patterns">
  <summary>💡 值得學習的模式（附屬，點開看）</summary>
  <ul>
    <li><strong>{模式名稱}</strong> <code>{檔案:行數}</code> — {白話講做了什麼、好在哪，具體不誇飾}
      <div class="term-note">名詞補充（選用）：{術語「中文 (English)」一句解釋}</div>
    </li>
  </ul>
</details>
```

### 11. 名詞補充

術語處理走**白話先行**：prose 句子先把事情講懂，第一次出現的術語用「中文 (English)」格式（如 `覆蓋率 (coverage)`）。需要展開解釋的複雜術語不塞進主句，就近放在該 finding 的 inline 註解 `.term-note`。此 `term-glossary` 為**全報告彙整**（選用）：把散落各處的複雜術語集中一份，一句話解釋（一般常識字不收）。與焦點區「術語表」可並存（焦點區聚焦該概念領域；此處涵蓋全報告）。

```html
<section class="term-glossary">
  <h2>📖 名詞補充</h2>
  <dl class="glossary">
    <dt>{術語 (English)}</dt><dd>{一句話：是什麼、為什麼重要}</dd>
  </dl>
</section>
```

### 12. Footer

```html
<footer>
  <p>Generated by fe-mr-review-html on {date}</p>
  <p>MR snapshot: {commit_sha_short}</p>
</footer>
```

## CSS 設計原則

- **字型**：`font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans TC", sans-serif;`
- **Code**：`font-family: ui-monospace, "JetBrains Mono", Menlo, monospace;`
- **最大寬度**：`max-width: 1280px; margin: 0 auto;`
- **間距**：使用 8px 倍數刻度（8 / 16 / 24 / 32 / 48）
- **深色模式**：用 `prefers-color-scheme: dark` 提供 dark token

## Print 樣式（已內建於 template.html）

- 隱藏 toolbar / 按鈕；inline 註解改 `position: static`、強制展開（含 `.findings.collapsed`）。
- `section / .file-diff / .inline-annotation` 加 `break-inside: avoid`，避免跨頁切斷。
- `@page { size: A4; margin: 16mm; }`。

## JS 行為清單（已內建於 template.html）

| 行為 | 觸發 | 動作 |
|------|------|------|
| Severity 篩選 | 點 toolbar checkbox | 隱藏/顯示對應 `.inline-annotation` + 行邊條 / `.line-flag` |
| 全部展開 / 收合 | 點 toolbar 按鈕 | toggle `.findings.collapsed`（收合 = inline 註解縮成單行）|
| 計數 chip 跳轉 | 點頂部 severity 計數 | 捲到第一個該 severity 的 finding + flash |
| 焦點區快速跳轉 | 點 focus badge | scroll to `#focus` |

所有 JS 寫在單一 `<script>` 區塊，不依賴外部 library。
