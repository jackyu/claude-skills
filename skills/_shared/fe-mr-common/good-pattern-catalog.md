# 好做法判準（Good Pattern Catalog）

值得標記為「好做法」的程式技巧範式，用於識別有學習價值的變更。**識別有助於彙整學習筆記，不是給作者打分數**。

## 6 種範式

### 1. 抽象化擴用（Abstraction）

**判準**：原本 inline 的邏輯被抽成函式 / Hook / 元件，且：

- 呼叫點 ≥ 2（真實的 DRY，不是預測性 DRY），**或**
- 語意完整成形（命名後讀者能直接理解這段在做什麼，例如 `useOrderTotal()`）

**範例觸發**：

- 把 `fetch + normalize + cache` 抽成 `useFetchUserProfile()`
- 把重複出現的 Toast 顯示邏輯抽成 `notifySuccess()` / `notifyError()`

**格言模板**：「`<原本散在 N 處的 X>` 抽成 `<函式名>` 後，新增同類功能只要呼叫一行。」

**反例（不算好做法）**：

- 只有一個呼叫點且語意不獨立（單純為了減少函式體長度）
- 過度泛型化導致呼叫端反而更複雜（YAGNI 違反）

---

### 2. 語法簡化（Syntactic Simplification）

**判準**：

- 行數 ↓ ≥ 40%，**且**
- 可讀性未降（讀者第一遍能讀懂）

**範例觸發**：

- 連續的 `if` 鏈 → `Map` / `Record` 查表
- 巢狀三元 → optional chaining + nullish coalescing
- `for + push` → `map` / `filter` / `reduce`
- 多行 prop spreading → 物件展開 + 解構

**格言模板**：「`<舊語法 N 行>` → `<新語法 M 行>`，少一層 indentation 就少一份心智負擔。」

**反例（不算好做法）**：

- 縮減語法但需要讀三遍才懂（炫技）
- 用了不熟的 array method 反而讓 reviewer 卡住

---

### 3. 型別精緻化（Type Refinement）

**判準**：

- `any` → 具名型別 / 泛型
- 鬆散字串 → discriminated union（`'idle' | 'loading' | 'success' | 'error'`）
- 善用 utility types（`Pick`、`Omit`、`Partial`、`ReturnType`、`Parameters`）
- 改善後 IDE 在錯誤呼叫處能立刻紅線

**範例觸發**：

- `status: string` → `status: OrderStatus`（union）
- `props: any` → `props: ComponentProps<typeof Button>`
- `(data: unknown) => void` 加上 type guard 後安全縮窄

**格言模板**：「把 `<原始型別>` 換成 `<精緻型別>`，編譯器就替你把 `<某類 bug>` 擋掉了。」

**反例（不算好做法）**：

- 用了 `as` 強制斷言繞過編譯器（型別欺騙）
- 把簡單的 string 包成 branded type 卻沒帶來實質保護

---

### 4. 邊界處理收斂（Boundary Consolidation）

**判準**：

- 把分散在多處的 null / error / loading 處理收斂到單一節點
- 用 Error Boundary、Suspense、統一的 ApiError class 取代到處 try-catch
- 讀者只需要看一個地方就理解整個錯誤策略

**範例觸發**：

- 多個元件各自 `if (loading) return <Spinner />` → 父層用 `<Suspense>` 包起
- 各 API hook 各自處理 401 → 統一在 axios interceptor 重新導向
- 多處 `if (!data) return null` → 抽到資料層保證 data 非空

**格言模板**：「把 `<分散的處理>` 收到 `<單一節點>`，新增頁面不再需要重新發明錯誤處理。」

**反例（不算好做法）**：

- 收斂後變成過於通用的「萬用錯誤處理」，反而吃掉了需要特殊處理的場景
- 把不同性質的錯誤（網路 vs 業務邏輯）混在同一處理

---

### 5. 效能優化（Performance, with Evidence）

**判準**：

- 採用 memo / lazy / cache / virtualization 等手段，**且**
- 伴隨明確的瓶頸證據（profiler 截圖、效能指標、註解說明 N 次重渲染等）

**範例觸發**：

- 對昂貴的列表加 `React.memo`，註解寫「ProductCard 在父層每次輸入都重渲染，加 memo 後 keystroke 從 80ms 降到 12ms」
- Promise-level cache 避免短時間內重複呼叫同一 API
- 大量資料用 `react-window` 虛擬化

**格言模板**：「`<具體瓶頸>` 用 `<手段>` 之後，`<可量化的改善>`。」

**反例（不算好做法）**：

- 「先 memo 起來以防萬一」（未驗證的優化）
- `useMemo` 包了一個極輕的計算（成本高於節省）

---

### 6. 模式套用（Pattern Application）

**判準**：

- 明確採用具名的設計模式：Compound Component、State Machine、Strategy、Builder、Adapter 等
- 套用後解決了原本零散邏輯的耦合問題

**範例觸發**：

- 多步驟流程改用 XState / `useReducer` + discriminated union（State Machine）
- `<Tabs>` 改成 Compound Component（`<Tabs.List>`、`<Tabs.Panel>`）
- 多種付款流程用 Strategy 模式取代 switch

**格言模板**：「`<原本零散邏輯>` 套用 `<模式名稱>` 後，新增 `<新需求>` 從修 N 處變成擴充 1 處。」

**反例（不算好做法）**：

- 強行套用模式但實際只有一種變體（設計過度）
- 套用後讀者要先學會模式才看懂程式碼（學習成本 > 收益）

---

## 識別流程

1. 對 diff 的每個變更區塊問：「這段比舊版好在哪？」
2. 若答案能對應到上述 6 種範式之一 → 標記為好做法
3. 寫一句格言（套用模板），讓讀者一句話帶走重點
4. 標註位置（`path:line`）方便回查
5. 不確定是不是「好」就先列出，由 reviewer 決定是否值得寫成 digest 筆記

## 標記輸出格式

```
✨ {範式名稱} | 位置 `path/to/file.tsx:42` | 「{一句格言}」
[ ] 值得存成 digest 筆記？ → /fe-mr-digest <MR_URL>
```
