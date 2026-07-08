# Frontend Issue Template

產出草稿時依照以下結構，`{{ }}` 的部分替換為實際內容。

---

```markdown
# 前端技術 Issue：{{ ISSUE_TITLE }}

## 關聯需求

- **PM Issue**: [{{ PM_ISSUE_ID }} — {{ PM_ISSUE_TITLE }}]({{ PM_ISSUE_URL }})
- **Figma 設計稿**: [{{ FIGMA_PAGE_NAME }}]({{ FIGMA_URL }})

> ⚠️ **注意**：開發過程中如遇到任何規格疑問、需求不明確、或與設計稿有出入的情況，請一律回到 [PM Issue {{ PM_ISSUE_ID }}]({{ PM_ISSUE_URL }}) 上提問並留下紀錄，勿在 RD Issue 或 MR 中自行決定規格，確保所有需求討論都集中在 PM Issue 上可追溯。

---

## 功能描述

{{ TECHNICAL_DESCRIPTION }}

### 結構概覽

<!-- 如果有結構性變更（Tab、路由、頁面架構），用樹狀圖呈現 -->

---

## 驗收條件（AC）

### 功能面

- [ ] {{ AC_FUNCTIONAL }}

### 資料顯示

- [ ] {{ AC_DATA }}

### 既有功能

- [ ] {{ AC_REGRESSION }}

### 測試品質

- [ ] 所有新增/修改的元件皆附帶單元測試
- [ ] 測試覆蓋率（Coverage）達到 80% 以上（Statements & Branches）
- [ ] {{ AC_TEST_SPECIFIC }}
- [ ] API 串接層有 mock 測試，涵蓋正常回應與錯誤處理

---

## API 依賴

| 功能項目 | API 狀態 | 後端 Issue | 備註 |
|---------|---------|-----------|------|
| {{ FEATURE }} | ✅ 既有 API / ⚠️ 需新 API | {{ LINK / — }} | {{ NOTE }} |

---

## 技術備註

- {{ TECH_NOTES }}

---

<!-- Micro Issue（<1 天）：錯字 / 樣式微調 / 圖片 / 檔案移動 — 使用此精簡格式，省略上方所有 section -->

# 前端技術 Issue：{{ ISSUE_TITLE }}

**關聯**：[{{ PM_ISSUE_ID }} — {{ PM_ISSUE_TITLE }}]({{ PM_ISSUE_URL }})

## 實作範圍

1. {{ ITEM_1 }}
2. {{ ITEM_2 }}

**預估**：約 {{ DAYS }} 天

---

<!-- 小型 Issue（1-3 天）使用此模式 -->

## 實作範圍

1. {{ ITEM_1 }}
2. {{ ITEM_2 }}
3. {{ ITEM_3 }}

---

## 預估工時

約 **{{ MIN }}–{{ MAX }} 個工作天**

<!-- 中大型 Issue（4+ 天）使用此模式 -->

## Subtask 拆解

### Subtask N：{{ SUBTASK_TITLE }}
- **複雜度**: 低 / 中 / 中高 / 高
- **說明**: {{ DESCRIPTION }}
- **產出**: {{ OUTPUT }}
- **測試**: {{ TEST_SCOPE }}
- **依賴**: 無 / Subtask N / 後端 API
- **預估**: {{ DAYS }} 天

---

## Subtask 總覽 Checklist

- [ ] Subtask 1: {{ TITLE }}
- [ ] Subtask 2: {{ TITLE }}

---

## 預估總工時

約 **{{ MIN }}–{{ MAX }} 個工作天**（{{ NOTE }}）

---

## 影響範圍 / 風險

- **高影響**: {{ HIGH_IMPACT }}
- **中風險**: {{ MEDIUM_RISK }}
- **低風險**: {{ LOW_RISK }}
- **建議**: {{ SUGGESTION }}

```
