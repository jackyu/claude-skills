---
name: fe-mr-generator
description: 生成 Git Merge Request 的 Title 與 Description。使用時機：(1) 用戶要求產生 MR 描述, (2) 用戶要求整理 branch 變更內容, (3) 用戶提到 merge request、MR、pull request、PR 內容撰寫, (4) 用戶開發完成要推 MR, (5) 用戶提到要開 MR 或發 PR。即使用戶只是說「幫我產 MR 描述」也應觸發此 skill。
---

# MR Content Generator

GitLab 版的 Pocock `pr`：Summary 圖、Evidence、Merge Danger 照 `pr` 的規則寫，再套上這個 skill 自己的 GitLab 規則（標題、關聯、為什麼要這樣做、fe-arch 注意事項、驗證標記）。

MR 描述只放 reviewer 從 diff 讀不出來的東西：為什麼做、改動的形狀、證據、合併風險。逐項功能、解題過程不寫。

## Workflow

### Step 1: 收集 Context

對話中已提供的跳過：

1. **關聯 Issue**：這個 MR 對應哪張 Issue？
2. **Subtask 對應**：對應 Issue 中的哪個 Subtask？（選填）
3. **PM Issue**：上游的 PM Issue 編號（選填）
4. **驗收素材**：驗收階段的截圖、測試由紅轉綠的紀錄、blast-radius 的結論。有就拿來用，沒有不用另外補做

### Step 2: 確認分支資訊

```bash
git branch --show-current
git log --oneline origin/<target>..HEAD   # target 預設 main，使用者指定則以其為準
```

沒有差異就告知使用者後結束。

### Step 3: 蒐集變更資訊

```bash
git log --format="%h %s%n%b" origin/<target>..HEAD
git diff --stat origin/<target>...HEAD
git diff origin/<target>...HEAD
```

### Step 4: 載入 Pocock 的 pr 規則

用 Skill 工具載入 `mattpocock-skills:pr`，Summary、Evidence、Merge Danger 三段照它的規則寫。Skill 工具載不到時，改用 Read 讀 plugin cache 裡 `mattpocock-skills/<版本>/skills/engineering/pr/SKILL.md`（取最新版本號）。

pr 的段落順序是 Summary → Evidence → Merge Danger；這個 skill 刻意把 Evidence 移到最後，順序以 Step 6 為準。

### Step 5: 產生 MR Title

依照 `references/mr-title-rules.md`。格式 `[#id][前後台] 中文說明`；issue 標題是英文 conventional commit 格式時，改寫成中文說明。

### Step 6: 產生 MR Description

依照 `references/mr-description-template.md`，五段依序是：

1. **關聯**：決定 `Closes` 還是 `Related to`
2. **為什麼要這樣做**：2–3 句背景與動機
3. **Summary**：照 pr 的規則挑最小的圖
4. **Merge Danger**：Door（one-way／two-way）與 Blast Radius
5. **Evidence**：Before／After，放最後、不收合

段落標題保留這五個詞（`Summary`、`Merge Danger`、`Evidence` 用英文），mission-band 用它們檢查 MR 格式。

**素材規則**

- **Merge Danger**：有 blast-radius 的結論就直接引用、註明出處，不重新推論。沒有就從 diff 推，句首標「推測：」
- **Evidence**：只列實際存在的證據（驗收截圖、測試紅轉綠的紀錄、指令輸出）。沒有就寫「待補：缺 <什麼>」，不准編造或補寫成已驗證
- **詞彙**：專案有 `GLOSSARY.md` 就用裡面的領域詞

**其他規則**

- 新增檔案的位置若不符合 `fe-arch` skill 的規範，在「為什麼要這樣做」後面加一段「注意事項」，說明偏離原因或建議搬移（只標注、不改 code）
- 檔案路徑只能出現在 Summary 的程式碼區塊裡（pr 的 component tree、file tree 本來就帶路徑）。關聯、為什麼要這樣做、Merge Danger、Evidence 的文字段落一律用功能描述，不寫路徑
- **description 最後一行固定附隱形標記** `<!-- mr:fe-mr-generator -->`。`mr-create.sh`、`mr-update.sh` 和 PreToolUse hook 都會檢查它，缺了會擋下建立 MR

### Step 7: 輸出結果

把 Title 和 Description 用一個 markdown code block 包起來輸出：

````
```markdown
<title>

<description>

<!-- mr:fe-mr-generator -->
```
````

輸出後提醒使用者：

1. Evidence 有「待補」的話，開 MR 前補上
2. 需要閱讀地圖（diff 上的 inline 導覽註解）時另外跑閱讀地圖的 skill，這個 skill 不產

## 語氣與表達規範

這段約束「為什麼要這樣做」、Merge Danger 的說明文字。

### 語氣

- **不要過度吹捧。** 不用「教科書級」「堪稱典範」「極為優雅」這類誇飾。
- 評價要具體講「好在哪」，形容詞克制。
- 用口語的自述句，像在跟同事口頭講解。不要一句話塞滿縮寫和術語、讀起來像 commit message。

### 技術名詞的處理

- 句子**先用白話把事情講清楚**，不依賴讀者已經懂那些英文縮寫。
- 第一次出現的術語用「中文 (English)」格式，例如 `覆蓋率 (coverage)`、`統一入口 (barrel)`。
- 需要展開解釋的術語不要塞進主句，放到段落最後的「名詞補充」。
- 一句話最多一兩個術語，超過就拆句。

### 範例（同一段，改寫前後對照）

❌ 改寫前：

> DI factory 把 token 來源 per-broker 留在呼叫端、型別乾淨（readonly / 無 any）、零消費者引用 blast radius 為零。

✅ 改寫後：

> 這個工廠函式沒有把「每一家券商的 token 從哪來」寫死，而是交給呼叫的人決定，之後要換券商不用動到工廠本身。目前也沒有別的地方直接 import 它，這次改動幾乎不會波及其他檔案。
>
> **名詞補充**
> - **依賴注入工廠 (DI factory)**：負責組裝物件的函式，把「要用哪些依賴」集中在一處決定。

## 邊界情況處理

- **未提交的變更**：提醒使用者先 commit 或 stash
- **無 commit 差異**：告知使用者後結束
- **commit message 不夠清楚**：主動詢問使用者補充變更動機

## Reference

- `references/mr-title-rules.md` — MR Title 規則（含 monorepo 前綴邏輯）
- `references/mr-description-template.md` — MR Description 模板（五段）
