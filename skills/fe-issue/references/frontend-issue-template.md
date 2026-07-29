# Frontend Issue Template

產出草稿時依照以下結構，`{{ }}` 的部分替換為實際內容。

分兩個層級：**Micro（< 1 天）** 用極簡三段，**標準（≥ 1 天）** 用下方完整結構。

**長度判準**：標準層級的 issue 全文 ≤ 150 行、10 分鐘內可讀完。超標先砍雜訊（重複敘述、可從 code 查到的細節、非必要的背景）再輸出。

任務拆解在開發階段（`/start` 之後）依規格書進行，issue 本身只到「實作範圍」為止。

---

## 標準（≥ 1 天）

```markdown
# 前端技術 Issue：{{ ISSUE_TITLE }}

## 關聯需求

- **PM Issue**: [{{ PM_ISSUE_ID }} — {{ PM_ISSUE_TITLE }}]({{ PM_ISSUE_URL }})
- **Figma 設計稿**: [{{ FIGMA_PAGE_NAME }}]({{ FIGMA_URL }})

> ⚠️ **注意**：開發過程中如遇到任何規格疑問、需求不明確、或與設計稿有出入的情況，請一律回到 [PM Issue {{ PM_ISSUE_ID }}]({{ PM_ISSUE_URL }}) 上提問並留下紀錄，勿在 RD Issue 或 MR 中自行決定規格，確保所有需求討論都集中在 PM Issue 上可追溯。

---

## 規格書

<!--
`/spec` 流程產出的 to-spec 規格書全文嵌入此處，作為本 issue 的規格主體
（Problem Statement / Solution / User Stories / Implementation Decisions /
Testing Decisions / Out of Scope / Further Notes）。
有規格書時，下方「功能描述」省略不寫——兩者擇一，不重複同一件事。
單獨使用 fe-issue（非 `/spec` 流程）時，省略本區塊、改寫「功能描述」。
-->

{{ SPEC_DOCUMENT }}

---

## 功能描述

<!-- 沒有規格書時才寫；有規格書則刪除本 section -->

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

## 實作範圍

1. {{ ITEM_1 }}
2. {{ ITEM_2 }}
3. {{ ITEM_3 }}

---

## 預估工時

約 **{{ MIN }}–{{ MAX }} 個工作天**

---

## 技術備註

- {{ TECH_NOTES }}

<!-- 有真實風險才寫，一項一行併入上方清單，例：影響既有 X 頁面的 Y 行為，需回歸測試 -->
```

---

## Micro（< 1 天）

錯字 / 樣式微調 / 圖片替換 / 檔案移動 — 使用此精簡格式，省略標準層級的所有 section。

```markdown
# 前端技術 Issue：{{ ISSUE_TITLE }}

**關聯**：[{{ PM_ISSUE_ID }} — {{ PM_ISSUE_TITLE }}]({{ PM_ISSUE_URL }})

## 實作範圍

1. {{ ITEM_1 }}
2. {{ ITEM_2 }}

**預估**：約 {{ DAYS }} 天
```
