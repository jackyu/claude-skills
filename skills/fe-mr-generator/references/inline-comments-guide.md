# Inline 自註解清單指南

供 fe-mr-generator Step 8 使用：從 diff 中挑出 reviewer 難以自行還原的行，產生 inline 自註解清單。這份清單獨立於 description，由 `/push` 建 MR 後自動發佈成 positioned discussion。

## 1. 輸出格式

在 description 的 markdown code block 之後，另外用**獨立的 json code block** 輸出：

```json
[
  { "file": "apps/client/src/features/orders/hooks/use-order-filter.ts", "new_line": 42, "body": "..." },
  { "file": "apps/client/src/features/orders/api/get-orders.ts", "old_line": 18, "body": "..." }
]
```

- 每則物件只含三個欄位：`file`、`new_line` 或 `old_line`（擇一，不可同時給）、`body`
- `file`：真實 repo 相對路徑（這裡不受「禁路徑」規則約束，因為要讓發佈 script 定位到正確檔案）
- `body`：繁體中文 1-3 句，口語自述，**禁止出現任何檔案路徑**；只寫純內容，不加「📝 作者註：」前綴、不加 `<!-- mr:self-annotation -->` 標記——這兩者由 `/push` 呼叫的發佈 script 統一加工，skill 產出階段不用管
- 0 則是合法輸出（用 `[]`）

## 2. 挑行原則

只註解 reviewer 無法從 code 本身還原的資訊：

- 商業決策（為什麼選這個規則、這個邊界值）
- 非顯然的技術取捨（為什麼不用另一種寫法）
- 魔法數字／常數的來源（例如某個 timeout、某個 threshold 從哪來）
- 外部系統的約定（第三方 API 的怪癖、後端契約的隱含假設）
- 刻意不處理的邊界情況（並說明為什麼可以不處理）

**不要**註解：

- code 自己講得清楚的內容（變數命名、簡單邏輯）
- 純風格選擇
- import 語句
- 單純搬移／重新命名，沒有邏輯變化的行

一個概念只註解一次，不要在多個相關行重複同一件事。

## 3. 密度上限

| 複雜度 | 則數區間 |
|--------|---------|
| 簡單 | 0–3 |
| 一般 | 3–6 |
| 複雜 | 5–10 |

- 硬上限：整份清單最多 10 則（不論複雜度）
- 同一個檔案最多 3 則
- 寧可少註解，也不要為了湊數硬寫

## 4. 行號規則

- 行號基準一律是 `git diff origin/<target>...HEAD`（three-dot diff），與 GitLab MR 顯示的 diff 一致
- **只能對 `+` 行（用 `new_line`）或 `-` 行（用 `old_line`）註解**，不可對 context 行（沒有 `+`/`-` 前綴的行）註解——GitLab positioned discussion API 不接受 context 行，會回 400
- 行號從 diff 的 hunk header（`@@ -old_start,old_count +new_start,new_count @@`）往下數：
  - `+` 行對應 `new_line`，從 `new_start` 開始，每一個 `+` 或 context 行遞增
  - `-` 行對應 `old_line`，從 `old_start` 開始，每一個 `-` 或 context 行遞增
- 若不確定某行的正確行號，寧可跳過該則註解，不要猜——猜錯會在發佈時觸發 400，最終被彙整成整體留言 fallback，反而降低精準度
