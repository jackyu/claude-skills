# Diff Annotation 規範（就地內嵌）

## 目標

每個 finding 對應到 diff 中的具體行（除非為跨檔案架構問題），像 GitHub/GitLab PR 一樣**把註解就地嵌在那行程式碼正下方、預設展開**，讓 reviewer 同時看到「程式碼」與「評論」，不必左右對照、不必點擊跳轉。

## HTML 結構

### Diff Block 容器

每個變更檔案一個 `<section class="file-diff">`，單欄佈局（diff 與註解同欄交錯）：

```html
<section class="file-diff" data-file="src/lib/stream-reader.ts">
  <header class="file-diff-header">
    <h3>
      <span class="file-path">src/lib/stream-reader.ts</span>
      <span class="file-stats">+42 / -8</span>
    </h3>
    <span class="file-badge has-findings severity-high">3 findings</span>
  </header>

  <div class="file-diff-body">
    <div class="diff">
      <!-- diff 行與 inline 註解交錯 -->
    </div>
  </div>
</section>
```

> 不再有右側 `annotation-pane`（margin 卡片）。`.file-diff-body` 單欄，`.diff` 內直接交錯排 `.diff-line` 與 `.inline-annotation`。

### Diff 行

每行為 `<span class="diff-line">`；有 finding 的行加 `data-finding-id` 與行尾 `.line-flag` 標記：

```html
<span class="diff-line context" data-old-lno="14" data-new-lno="14">  const reader = stream.getReader();</span>
<span class="diff-line removed" data-old-lno="15" data-new-lno="">-  while (true) {</span>
<span class="diff-line added"   data-old-lno="" data-new-lno="15" data-finding-id="f-002">+  while (!signal.aborted) {<span class="line-flag">◀ 🟠</span></span>
<span class="diff-line added"   data-old-lno="" data-new-lno="16">+    const { value, done } = await reader.read();</span>
```

- `class="diff-line context|added|removed|hunk-header"`
- 有 finding 的行：`data-finding-id="f-NNN"` + 左側 severity 色邊（CSS）+ 行尾 `<span class="line-flag">◀ {emoji}</span>`

### 就地註解 row（核心）

緊接在「有 finding 的那行」**正下方**插入一個 `<div class="inline-annotation">`，預設展開：

```html
<span class="diff-line added" data-new-lno="15" data-finding-id="f-002">+  while (!signal.aborted) {<span class="line-flag">◀ 🟠</span></span>

<div class="inline-annotation severity-high" id="f-002">
  <div class="ia-head">
    <span class="severity-tag">🟠 High</span>
    <span class="finding-id">#f-002</span>
  </div>
  <h4>串流取消訊號沒接到（reader.read() 已 pending 時無法中斷）</h4>
  <p class="issue">原本 <code>while(true)</code> 改成 <code>while(!signal.aborted)</code>，但 <code>reader.read()</code> 已經在等資料時，旗標翻成 true 也叫不醒它，要等下一筆資料進來才會跳出。</p>
  <p class="suggestion"><strong>建議：</strong>在 abort handler 內額外呼叫 <code>reader.cancel()</code>，強制喚醒 pending 的 read。</p>
  <p class="term-note">名詞補充：<strong>回壓 (backpressure)</strong> — 下游消費跟不上時的回壓機制。</p>
  <details>
    <summary>程式碼片段</summary>
    <pre><code>signal.addEventListener('abort', () =&gt; reader.cancel());</code></pre>
  </details>
</div>

<span class="diff-line added" data-new-lno="16">+    const { value, done } = await reader.read();</span>
```

規則：
- 卡片 `id="f-NNN"` 與該行的 `data-finding-id` 相同（供 severity 篩選與計數 chip 捲動定位）。
- 內容用[共用撰寫原則](../../_shared/fe-mr-common/review-writing-principles.md) §1：白話先行、第一次術語標「中文 (English)」、複雜術語放 `.term-note`「名詞補充」（沒有就省略）。
- **同一行多個 finding** → 在該行下方堆疊多個 `.inline-annotation` row。
- 深入的程式碼示範放 `<details>程式碼片段`，避免主文膨脹。
- 不用「跳至 line N」連結（已就地，不需跳轉）。

## 互動（已在 template.html 內建）

- **預設展開**：`.inline-annotation` 直接顯示完整內容。
- **全部收合**：toolbar「全部收合」加 `.findings.collapsed`，inline 註解縮成單行（只剩 `.ia-head` 的 severity + 標題）；「全部展開」移除。
- **severity 篩選**：toolbar 勾選 → 隱藏/顯示對應 `.inline-annotation` 與其行邊條 / `.line-flag`。
- **頂部 severity 計數 chip** → 捲到第一個該 severity 的 finding + flash。
- `sticky-left`：`.inline-annotation` 在 `.diff` 橫向捲動時靠左固定，不隨程式碼跑掉。

## 跨檔案 finding 處理

若 finding 不對應特定行（如「整體架構不適合」），放獨立區塊，卡片改為靜態（非 sticky）：

```html
<section class="cross-file-findings">
  <h2>🌐 跨檔案 / 架構性 Findings</h2>
  <div class="inline-annotation severity-medium" id="f-007">
    <div class="ia-head"><span class="severity-tag">🟡 Medium</span><span class="finding-id">#f-007</span></div>
    <h4>{標題}</h4>
    <p class="issue">{問題}</p>
    <p class="suggestion"><strong>建議：</strong>{建議}</p>
  </div>
</section>
```

## Diff 取得方式

從 `mr-context.sh` 輸出的 diff（或 `git diff origin/<target>...origin/<source>`）抽取，保留：

- Hunk header（`@@ -10,7 +10,8 @@`）→ `<span class="diff-line hunk-header">`
- 上下文 context（unchanged 行）、變更行（added / removed）

> 對大型 diff（>500 行）：每檔案先顯示折疊的 hunk 摘要，點擊展開完整 diff；finding 所在的 hunk 預設展開。
