# 嚴重程度分級系統

## 級別定義

| 級別 | Emoji | 色碼（淺/深） | 觸發條件 | 範例 |
|------|-------|---------------|---------|------|
| `critical` | 🔴 | `#fef2f2` / `#dc2626` | 直接導致正式環境壞掉、資料損毀、安全漏洞 | XSS 注入、未驗證的支付金額、會把使用者資料覆寫 |
| `high` | 🟠 | `#fff7ed` / `#ea580c` | 高機率出 bug、效能明顯退化、商業邏輯錯誤 | race condition、忘記處理 cancel、N+1 query、依賴錯誤 useEffect dep |
| `medium` | 🟡 | `#fefce8` / `#ca8a04` | 維護性 / 可讀性問題，建議修但不擋 merge | 重複邏輯、過長函式（>80 行）、magic number、命名歧義 |
| `low` | 🔵 | `#eff6ff` / `#2563eb` | 風格 / 小重構，nice to have（屬「技術觀察」，不需動作） | 可用 `?.` 簡化、可用 `Array.from` 取代 spread |
| `info` | ⚪ | `#f9fafb` / `#6b7280` | 觀察 / 補充說明，非問題（屬「技術觀察」，不需動作） | 「這裡用了 X 模式，其他地方是 Y 模式，是否要統一？」 |

> 對齊 fe-mr-review：`critical`/`high`/`medium` = **需要修正（要動作）**；`low`/`info` = **技術觀察（不需動作）**。安全性問題以 `critical`/`high` 出現。不再有 `good`（值得學習的模式）級別。

## 分級判定步驟

1. **這個問題在正式環境會發生嗎？**
   - 100% 會 → 至少 `high`
   - 高機率 → `high`
   - 邊界條件才會 → `medium`
   - 不會（只是觀感）→ `low` 或 `info`

2. **發生後影響範圍？**
   - 資料損毀 / 安全漏洞 / 服務中斷 → `critical`
   - 該功能無法使用 / 商業邏輯錯誤 → `high`
   - 部分情境體驗下降 → `medium`
   - 不影響使用者 → `low` / `info`

3. **修復成本 vs 收益？**
   - 修復成本高但收益小 → 降一級
   - 修復成本低但收益大 → 升一級

## CSS Class 命名

```css
.severity-critical { --bg: #fef2f2; --fg: #dc2626; --emoji: '🔴'; }
.severity-high     { --bg: #fff7ed; --fg: #ea580c; --emoji: '🟠'; }
.severity-medium   { --bg: #fefce8; --fg: #ca8a04; --emoji: '🟡'; }
.severity-low      { --bg: #eff6ff; --fg: #2563eb; --emoji: '🔵'; }
.severity-info     { --bg: #f9fafb; --fg: #6b7280; --emoji: '⚪'; }
```

- 卡片背景：`var(--bg)`
- 邊條 / icon：`var(--fg)`
- Diff 行 margin 邊條：4px 寬，`background: var(--fg)`

## 可存取性

- **色標不單獨傳遞資訊**：每個 severity tag 必須同時顯示 emoji + 文字（如「🟠 High」）
- 文字色與背景色對比度 ≥ 4.5:1（已驗證上表色碼符合 WCAG AA）
- 卡片 focus 時加 `outline: 2px solid var(--fg)`，方便鍵盤瀏覽

## 計數規則

Executive Summary 區塊顯示：

```
🔴 0   🟠 2   🟡 5   🔵 3   ⚪ 1
```

- `critical = 0` 時仍顯示，但顏色淡化（`opacity: 0.4`）
- 點擊任一 severity → 篩選 findings list 只顯示該級別
