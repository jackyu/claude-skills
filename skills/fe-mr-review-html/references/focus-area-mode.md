# Focus Area 抽取與 Deep-Dive 產出規範

## Step 1: 抽取 focusArea

### 觸發語句樣式

| 用戶語句樣式 | 抽取結果 |
|------------|---------|
| 「I'm not very familiar with the X」 | `X` |
| 「focus on the X」「特別看 X」「重點看 X」 | `X` |
| 「我不太熟 X」「看不懂 X」「不確定 X 對不對」 | `X` |
| 「explain the X part」「講解 X」 | `X` |
| 「X 那段邏輯」 | `X` |
| 無相關語句 | `null`（跳過 deep-dive） |

### 抽取規則

1. 抽取**最具體的技術概念**，不是檔案名
   - ❌ `useViewTransitionRouter.ts`
   - ✅ `View Transitions API 與 async navigation 的時序`

2. 若用戶說多個焦點，全部記錄；deep-dive 區塊分為多個子區
   - 「streaming 和 cache invalidation」→ `[streaming, cache invalidation]`

3. 若用戶只描述了**症狀**而非概念，從 diff 反推概念
   - 「重整後資料會跑掉」+ diff 看到 hydration 相關 → `focusArea = SSR hydration mismatch`

## Step 2: Deep-Dive 五個子段落

### 1. 概念說明（80~150 字）

用**白話**解釋這個概念，假設讀者是中階前端工程師：

- 描述「它是什麼」
- 描述「在前端通常用來解決什麼問題」
- 列出 2~3 個常見實作方式

**範例（streaming/backpressure）**：

> Streaming 指資料以分批（chunk）方式從伺服器逐步傳遞給前端，前端可在收到部分資料時就開始渲染，常見於 SSE、ReadableStream、WebSocket、Suspense streaming SSR。Backpressure 則是 streaming 衍生的問題：當下游消費資料的速度跟不上上游產生的速度，buffer 會無限堆積導致記憶體爆炸。標準做法是讓下游能對上游回覆「我還沒準備好」，例如 `ReadableStream` 的 `pull()` 拉式模型、TCP 的視窗機制、RxJS 的 `throttle`/`buffer`。

### 2. 本 MR 中的實作流程（流程圖）

抽取焦點區涉及的檔案/函式，畫一張**極簡流程圖**。

優先使用 **inline SVG**（不依賴外部 mermaid runtime），結構建議：

```html
<svg viewBox="0 0 600 240" class="flow-diagram" aria-label="streaming 資料流程圖">
  <!-- nodes -->
  <g class="node">
    <rect x="10" y="20" width="140" height="50" rx="8" />
    <text x="80" y="50">API: SSE</text>
  </g>
  <!-- 更多節點 + 箭頭 -->
</svg>
```

或者用 mermaid 但**預先轉成 SVG 嵌入**（不執行 mermaid runtime）。

流程圖必須標示：

- 資料**來源** → **中介層** → **消費端**
- 每段註明檔案路徑（如 `src/api/stream.ts:42`）
- 用色標（同 severity 系統）標示有 finding 的節點

### 3. 關鍵程式片段（3~5 段）

每段格式：

```html
<figure class="code-excerpt">
  <figcaption>
    <code>src/lib/stream-reader.ts:18-32</code>
    <span class="role">資料拉取主循環</span>
  </figcaption>
  <pre><code>...實際程式碼...</code></pre>
  <p class="explanation">
    這裡用 while(true) + await reader.read() 形成 pull-based 消費，
    每次 read 才會觸發上游產生下一個 chunk，自然就有 backpressure。
  </p>
</figure>
```

- 必須包含實際程式碼（從 diff 抽取）
- 解釋 ≤ 80 字，聚焦「在做什麼」而非「為什麼這樣做」（為什麼這樣做的部分由概念說明補足）

### 4. 可能踩雷的點（3~5 個）

針對該概念列出**業界已知踩雷點**，並標註本 MR 是否處理到：

```html
<ul class="pitfalls">
  <li class="pitfall handled">
    <span class="status">✅ 有處理</span>
    <strong>Reader 未 release 導致連線洩漏</strong>
    <p>本 MR 在 finally 區塊呼叫 reader.releaseLock()（stream-reader.ts:48）</p>
  </li>
  <li class="pitfall partial">
    <span class="status">⚠️ 部分處理</span>
    <strong>消費端 unmount 後 stream 未取消</strong>
    <p>useEffect cleanup 有 abort，但 React strict mode 雙呼叫情境未測</p>
  </li>
  <li class="pitfall missing">
    <span class="status">❌ 未處理</span>
    <strong>Buffer 上限沒設</strong>
    <p>若伺服器一次推 10MB，前端會直接 OOM；建議加 highWaterMark</p>
    <a href="#f-003" class="cross-ref">→ 相關 finding #f-003 (High)</a>
  </li>
</ul>
```

| status class | 顯示 | 含義 |
|--------------|------|------|
| `handled` | ✅ 有處理 | MR 中有對應實作 |
| `partial` | ⚠️ 部分處理 | 處理了部分情境，仍有 gap |
| `missing` | ❌ 未處理 | MR 未處理（若嚴重應同時在 findings 列出，並 cross-ref） |
| `na` | ⚫ N/A | 本 MR 場景不會遇到 |

### 5. 術語表（4~8 個）

```html
<dl class="glossary">
  <dt>ReadableStream</dt>
  <dd>Web Streams API 提供的可讀串流物件，可用 `getReader()` 取得 reader 來逐塊消費。</dd>

  <dt>Backpressure</dt>
  <dd>下游消費跟不上上游產出時的回壓機制，常見實作為 pull-based 或視窗大小協議。</dd>

  <!-- 4~8 個 -->
</dl>
```

選詞原則：

- 選**該概念領域的專門術語**（讀者不熟焦點區，自然也可能不熟相關詞）
- 一句話定義（≤ 40 字），避免循環定義
- 按字母 / 出現順序排，不要隨意排

## 反模式

- ❌ 把焦點區 deep-dive 寫成「再列一次 findings」
- ❌ 解釋概念時直接複製 MDN/Wiki 文字
- ❌ 流程圖節點 > 12 個（太雜，要簡化）
- ❌ 程式片段沒有解釋，只貼 code
- ❌ 列「踩雷點」但全部是 ✅ 有處理（這代表你沒挑到真正的雷區，重挑）
