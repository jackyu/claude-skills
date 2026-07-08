# Review Reply Template

產出 MR Review 回覆時依照以下結構。統一整理為一筆 Comment 貼在 MR 上。

---

```markdown
## 🔍 Code Review 回覆

**MR**: !{{ MR_ID }}
**Review 來源**: {{ reviewer 名稱或 "Code Review Bot" }}
**分析方式**: 本地 AI 結合專案完整 context 逐條評估

---

### 📊 總覽

| 分類 | 數量 |
|------|------|
| ✅ 已採納 | {{ N }} |
| ⏭️ 不採納 | {{ N }} |
| 💬 需討論 | {{ N }} |

---

### ✅ 已採納

**{{ Review Comment 1 摘要 }}**
- **建議內容**: {{ 簡述建議 }}
- **處理方式**: {{ 說明怎麼修的 }}
- **Commit**: {{ commit_hash }}

**{{ Review Comment 2 摘要 }}**
- **建議內容**: {{ 簡述 }}
- **處理方式**: {{ 說明 }}
- **Commit**: {{ commit_hash }}

---

### ⏭️ 不採納

**{{ Review Comment 3 摘要 }}**
- **建議內容**: {{ 簡述建議 }}
- **不採納原因**: {{ 具體的專案脈絡解釋 }}
<!-- 範例：
- 建議內容: 建議將 inline style 改為 CSS class
- 不採納原因: 此處為動態計算的 style，依專案 CLAUDE.md 規範，動態樣式使用 inline style 處理，靜態樣式才使用 Tailwind class
-->

---

### 💬 需討論

**{{ Review Comment 4 摘要 }}**
- **建議內容**: {{ 簡述建議 }}
- **討論原因**: {{ 為什麼需要人工判斷 }}
- **觀點 A**: {{ 採納的話會怎樣 }}
- **觀點 B**: {{ 不採納的話會怎樣 }}
- **請 @{{ reviewer }} 協助判斷**

---

### 📝 備註

<!-- 選填：如果有額外的觀察或建議，放在這裡 -->
{{ 例如：本次 review 中對 Tailwind class 排序的建議有 3 條，已統一採納並在同一個 commit 處理 }}
```
