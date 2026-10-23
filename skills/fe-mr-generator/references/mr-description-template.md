# MR Description Template

五段依序：關聯 → 為什麼要這樣做 → Summary → Merge Danger → Evidence。每個 MR 五段都要有。Summary、Evidence、Merge Danger 的寫法以 Pocock `pr` skill 為準，這裡只補 GitLab 與本專案的規則。

段落標題要包含這五個詞（emoji 可有可無）：`關聯`、`為什麼要這樣做`、`Summary`、`Merge Danger`、`Evidence`。mission-band 會比對這些詞，判斷 MR 格式是否完整。

## Template

````markdown
## 🔗 關聯

- **Issue**: Closes #{{ ISSUE_ID }}
- **Subtask**: {{ SUBTASK_NAME }}
- **PM Issue**: {{ PM_ISSUE_ID }}

---

## 💡 為什麼要這樣做

{{ 2–3 句背景與動機。不是「做了什麼」，是「為什麼要做」。 }}

{{ 選填：新增檔案位置不符合 fe-arch 時，加一段「**注意事項**」說明偏離原因或建議搬移 }}

---

## 🗺️ Summary

{{ 照 pr 的規則挑最小的圖：pseudocode、call tree、component tree、file tree、Mermaid 或 diff。
   每張圖旁邊配一兩句說明，只留回答「改了什麼形狀」需要的節點。 }}

<!-- 閱讀地圖（選用）由另外的 skill 插在這裡 -->

---

## ⚠️ Merge Danger

**Door:** {{ one-way 或 two-way }}

{{ 選填：為什麼是這種門 }}

**Blast Radius:** {{ 一個詞 }}

{{ 選填：合併後可能波及哪些地方。引用 blast-radius 結論時註明出處；從 diff 推的句首標「推測：」 }}

---

## ✅ Evidence

- **Before:** {{ 截圖／輸出／失敗的測試 }}
  **After:** {{ 截圖／輸出／通過的測試 }}

{{ 沒有實際證據就寫「待補：缺 <什麼>」 }}

<!-- mr:fe-mr-generator -->
````

## 段落規則

| 段落 | 規則 |
|------|------|
| 關聯 | 這個 MR 做完就能關票才寫 `Closes #id`；只做一部分、或關聯的是追蹤票，寫 `Related to #id`。Subtask、PM Issue 沒有就整行刪掉 |
| 為什麼要這樣做 | 讓不了解需求背景的人也能看懂 context。不寫解題過程 |
| Summary | 一張圖講清楚就不要放兩張。前端 UI 改動優先用 component tree 或 diff 形式的 component tree |
| Merge Danger | one-way door＝難以回退（刪資料、改對外契約、資料遷移）；two-way door＝revert 就能回復 |
| Evidence | 截圖最好，其次是測試紅轉綠、指令輸出。前端 UI 改動要附前後對比截圖。不收合、放最後 |

## 格式規範

- 檔案路徑只能出現在 Summary 的程式碼區塊裡；文字段落用功能描述
- Markdown 連結不帶 repo 內路徑
- 使用繁體中文；`Summary`、`Merge Danger`、`Evidence`、`Door`、`Blast Radius` 維持英文
- 最後一行固定是 `<!-- mr:fe-mr-generator -->`，`mr-create.sh`／`mr-update.sh` 會檢查，缺了擋下
- MR Title 見 `references/mr-title-rules.md`
