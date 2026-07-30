# Inline 自註解清單指南

供 fe-mr-generator Step 8 使用：從 diff 中挑出 reviewer 難以自行還原的行，產生 inline 自註解清單。這份清單獨立於 description，由 `/push` 建 MR 後自動發佈成 positioned discussion。

清單同時是 reviewer 的**導覽動線**：`/push` 會依 `order` 幫每則加上順序標記、串上「接著看 → 下一則」的跳轉連結，並在 description 插一份閱讀地圖。所以挑行時不只挑「哪裡值得講」，還要想「該用什麼順序讀」。

## 1. 輸出格式

在 description 的 markdown code block 之後，另外用**獨立的 json code block** 輸出：

```json
[
  { "file": "apps/client/src/features/orders/components/order-list.tsx", "new_line": 24, "order": "1", "title": "清單頁怎麼接上新篩選", "body": "..." },
  { "file": "apps/client/src/features/orders/hooks/use-order-filter.ts", "new_line": 42, "order": "2", "title": "篩選條件組裝", "body": "..." },
  { "file": "apps/client/src/features/orders/hooks/use-order-filter.ts", "new_line": 58, "order": "2.1", "title": "快取鍵設計", "body": "..." },
  { "file": "apps/client/src/features/orders/api/get-orders.ts", "old_line": 18, "body": "..." }
]
```

| 欄位 | 必填 | 說明 |
|------|------|------|
| `file` | ✅ | 真實 repo 相對路徑（這裡不受「禁路徑」規則約束，因為要讓發佈 script 定位到正確檔案） |
| `new_line` / `old_line` | ✅ 擇一 | 不可同時給 |
| `order` | 選填 | 導覽順序，字串。見 §2 |
| `title` | 有 `order` 則必填 | ≤16 全形字、**禁出現路徑**。會變成「接著看」的連結文字與閱讀地圖的項目名 |
| `body` | ✅ | 繁體中文 1-3 句，口語自述，**禁止出現任何檔案路徑** |

- `body` 只寫**純內容**：不要自己加 `🤖💬`、`[2/5]` 這類編號、「接著看」尾行，也不要加 `<!-- mr:self-annotation -->` 標記。這些裝飾一律由 `/push` 發佈時組裝——skill 自己寫進去，重推時的汰換比對就會全部對不上，既有 thread 會被誤收掉
- 0 則是合法輸出（用 `[]`）

## 2. 導覽順序規則

`order` 決定 reviewer 的閱讀動線：

- **主要點**：`"1"`、`"2"`、`"3"`… 連續字串，不跳號
- **次要點**：`"2.1"`、`"2.2"`（掛在主要點 `"2"` 底下）。**最多兩層**，每個主要點下最多 3 個。次要點是**獨立的一則 note**，不是塞進主要點 body 的附註
- **補充項**：省略 `order`（也可省 `title`）。用於機械性但值得一提的改動，不佔動線順位、`/push` 會排到最後才發，也不會掛「接著看」

排法：

```
第 1 則 ── 入口點定位（誰呼叫了這次的核心，讓 reviewer 知道從哪讀進來）
第 2 則起 ── 核心由內而外（核心邏輯 → 外圈呼叫端）
機械性改動 ── 不發，或省略 order 標成補充項排最後
```

- 主要點建議 3–7 則
- `order` 只表達**相對順序**。實際顯示的 `[i/M]` 編號由 `/push` 依最終發佈清單重算，**分母 M ＝主要點總數**（次要點與補充項不計入）
- 導引項只有 1 則時，`/push` 會保留 `[1/1]`、不加「接著看」尾行、也不插閱讀地圖

## 3. 挑行原則

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

## 4. 密度上限

| 複雜度 | 則數區間 |
|--------|---------|
| 簡單 | 0–3 |
| 一般 | 3–6 |
| 複雜 | 5–10 |

- 硬上限：整份清單最多 10 則（不論複雜度）
- 同一個檔案最多 3 則
- **次要點與補充項都計入上限**——次要點是獨立的一則 note，不要因為它「只是附註」就不算進去
- 寧可少註解，也不要為了湊數硬寫

## 5. 行號規則

- 行號基準一律是 `git diff origin/<target>...HEAD`（three-dot diff），與 GitLab MR 顯示的 diff 一致
- **只能對 `+` 行（用 `new_line`）或 `-` 行（用 `old_line`）註解**，不可對 context 行（沒有 `+`/`-` 前綴的行）註解——GitLab positioned discussion API 不接受 context 行，會回 400
- 行號從 diff 的 hunk header（`@@ -old_start,old_count +new_start,new_count @@`）往下數：
  - `+` 行對應 `new_line`，從 `new_start` 開始，每一個 `+` 或 context 行遞增
  - `-` 行對應 `old_line`，從 `old_start` 開始，每一個 `-` 或 context 行遞增
- 若不確定某行的正確行號，寧可跳過該則註解，不要猜——猜錯會在發佈時觸發 400，最終被彙整成整體留言 fallback，反而降低精準度

## 6. 發佈後長相（供對照，非 skill 輸出）

以下是 `/push` 組裝完、貼在 GitLab diff 上的樣子。**首行、尾行、標記都不是 skill 產出的**，skill 只負責 `body` 那段純內容與 `order` / `title` 欄位。

一般的主要點：

```
🤖💬 [2/5] 篩選條件組裝

這裡的預設區間是跟 PM 對過的：後台報表只看近 90 天，再往前的資料要走匯出流程。
所以這邊寫死 90，不是隨手挑的數字。

接著看 → [[2.1] 快取鍵設計](https://git.example.com/g/p/-/merge_requests/109#note_10234)
```

導覽的最後一則（尾行換成結束標記）：

```
🤖💬 [5/5] 錯誤分流

後端這支只會回 409，不會回 400，所以這裡只擋重複送出這一種情況。

🏁 導覽結束（共 5 個重點）
```

補充項（沒有編號、永不掛「接著看」）：

```
🤖💬 [補充] 呼叫端跟著改名

這幾行只是跟著上面 rename，邏輯沒動。
```

description 裡的閱讀地圖（`/push` 插在「為什麼要這樣做」標題後）：

```markdown
<!-- mr:reading-map:start -->
**閱讀地圖**

1. [清單頁怎麼接上新篩選](https://git.example.com/g/p/-/merge_requests/109#note_10231)
2. [篩選條件組裝](https://git.example.com/g/p/-/merge_requests/109#note_10233)
   - [快取鍵設計](https://git.example.com/g/p/-/merge_requests/109#note_10234)
3. [錯誤分流](https://git.example.com/g/p/-/merge_requests/109#note_10236)
<!-- mr:reading-map:end -->
```

模板**不預埋**這組標記——沒有它 `/push` 會自己找位置插入，有它就整塊替換。
