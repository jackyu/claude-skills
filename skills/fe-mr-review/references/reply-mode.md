# Reply Mode 詳細步驟

完成共用步驟（取得 MR context）後執行。

**核心價值：** 本地 AI 能讀整個專案，能判斷 review comment 在「這個專案的脈絡下」是否合理；reviewer 只看 diff，本地 AI 看全貌。

## Step P1: 收集 Review Comments

從 mr-context.sh 輸出的「Unresolved Discussions」段提取未解決 comments。若資訊不足（例如需要完整討論串），用 `mr-load-discussion.sh <project> <mr_iid> <discussion_id>` 補抓。

同時確認：
- **MR 編號**：用於回覆時標註
- **關聯 Issue**：用於理解開發目的

## Step P2: 讀取專案 Context

關鍵優勢來源。在分析前先讀取：

1. **CLAUDE.md**：取得專案 coding convention 與架構資訊
2. **本次 MR 變更檔案**：透過 mr-context.sh 已取得；若 minimal 模式，用 mr-load-file.sh 補抓
3. **相關的既有程式碼**：被變更檔案 import 的模組、共用元件、型別定義

## Step P3: 逐條分析

對每一條 review comment 分類為三種：

| 分類 | 條件 | 產出 |
|------|------|------|
| ✅ 採納 | 在專案脈絡下合理 | 為什麼合理 + 直接修正 + 記錄 commit hash |
| ⏭️ 不採納 | 通用場景可能對，但專案脈絡不適用 | 引用具體脈絡（CLAUDE.md 規範、既有 pattern、業務邏輯需求）說明不適用原因 |
| 💬 需討論 | 涉及設計決策，AI 無法單獨判斷 | 說明為何需討論 + 兩方觀點 |

**原則：** 不盲目全採納（review 有 false positive 率）；不為了省事全駁回（合理建議要接受）；拿不準就標「需討論」。

## Step P4: 執行修正

對於 ✅ 採納項目，直接修正並 commit：

```bash
git add <修改的檔案>
git commit -m "fix: address code review feedback"
```

## Step P5: 產出回覆

依 [`reply-template.md`](./reply-template.md) 產出統一一筆 MR Comment。

**規則：**

- 直接輸出 Markdown，不加 code block 包裹
- 每條 comment 都要回應，不能遺漏
- 採納項目附 commit hash
- 不採納項目附具體專案脈絡解釋（不能只說「不適用」）
- 需討論項目 @mention reviewer

**產後提醒用戶：**

1. 確認回覆內容是否合理
2. 確認修正程式碼是否正確
3. 推上去後將回覆貼到 MR
4. 「需討論」項目主動找 reviewer 對齊
