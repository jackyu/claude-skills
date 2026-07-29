# GitLab Label 定義規範（前端）

> 本文件定義前端團隊在 GitLab Issue 和 MR 中使用的 Label 規範。
> 目的是統一命名、明確每個 Label 的用途和轉換時機，支援 Board 視覺化和流程自動化。

---

## Label 類別總覽

| 類別 | 前綴 | 性質 | 來源 | 說明 |
|------|------|------|------|------|
| Type | `#` | Scoped | PM Issue 帶回 | Issue 的類型 |
| Priority | `$` | Scoped | PM Issue 帶回 | 優先級 |
| Product | `product` | 一般 | PM Issue 帶回 | 所屬產品線 |
| Team | — | 一般 | RD Issue 固定 | 前後端分類 |
| Workflow | `workflow::` | Scoped | RD Issue 管理 | 開發流程狀態 |

> **Scoped Label**：同一類別只能有一個值（例如不能同時是 `# feature` 和 `# bug`），GitLab 會自動替換。

---

## 1. Type（`#`）

Issue 的類型，從 PM Issue 帶回。

| Label | 說明 | 使用場景 |
|-------|------|---------|
| `# type::feature` | 新功能 | 新增頁面、元件、功能 |
| `# type::bug` | 缺陷修復 | 修復已知問題 |

---

## 2. Priority（`$`）

優先級，從 PM Issue 帶回（若有）。數字越小優先級越高。

| Label | 說明 | 回應時間建議 |
|-------|------|-------------|
| `$ priority::0` | 最高優先 | 立即處理，中斷當前工作 |
| `$ priority::1` | 高優先 | 當日內開始處理 |
| `$ priority::2` | 中優先 | 當前 Sprint 內處理 |
| `$ priority::3` | 低優先 | 排入 Backlog，有空再處理 |

---

## 3. Product

所屬產品線，從 PM Issue 帶回。視團隊產品線定義而定，例如：

- `product::會員系統`
- `product::後台管理`

> 具體值依團隊實際產品線設定，此處不窮舉。

---

## 4. Team

前後端分類，RD Issue 建立時固定標上。

| Label | 說明 |
|-------|------|
| `FE` | 前端 Issue |

> 後端使用 `BE`，但不在本規範範圍內。

---

## 5. Workflow（`workflow::`）

開發流程狀態，用於 Board 視覺化和追蹤進度。Scoped Label，同一時間只會有一個 workflow 狀態。

| Label | 說明 | 進入條件 | 離開條件 |
|-------|------|---------|---------|
| `workflow::Build Spec` | 規格制定中 | PM Issue 進入技術拆解階段 | 技術 Issue 建立完成 |
| `workflow::Ready To Develop` | 待開發 | 技術 Issue 建立，需求已釐清 | RD 開始開發 |
| `workflow::Developing` | 開發中 | RD 開始寫 code | 開發完成，推 MR |
| `workflow::Review` | 代碼審查中 | MR 已發佈，等待 review | Review 通過，MR merged |
| `workflow::On Dev` | 已部署至 Dev 環境 | MR merged，CI 部署至 dev | QA 驗證通過，準備上 beta |
| `workflow::On Beta` | 已部署至 Beta 環境 | 部署至 beta 環境 | QA 驗證通過，準備上 staging |
| `workflow::On Staging` | 已部署至 Staging 環境 | 部署至 staging 環境 | 確認可上線 |
| `workflow::To Be Released` | 待上線 | Staging 驗證通過，等待上線排程 | 正式上線 |
| `workflow::On Prod` | 已上線 | 正式部署至 production | Issue 關閉 |
| `workflow::Suspended` | 暫停中 | 因故暫停（需求變更、阻塞、等待外部依賴） | 阻塞解除，恢復至暫停前狀態 |

### Workflow 流程圖

```
Build Spec → Ready To Develop → Developing → Review → On Dev
                                                        ↓
                                              On Beta → On Staging → To Be Released → On Prod

任何階段 ←→ Suspended（可雙向切換）
```

### 正常流程的 Label 轉換

以一張前端技術 Issue 為例：

| 步驟 | 動作 | Label 變化 |
|------|------|-----------|
| 1 | PM Issue 進入拆解，RD 用 `fe-issue` Skill 產出草稿 | `workflow::Build Spec` |
| 2 | 技術 Issue 建立完成，需求確認無疑義 | → `workflow::Ready To Develop` |
| 3 | RD 開始實作 | → `workflow::Developing` |
| 4 | 一段實作範圍完成，用 `fe-mr-generator` 開 MR | → `workflow::Review` |
| 5 | MR 通過 review 並 merged | → `workflow::On Dev` |
| 6 | 部署至 beta | → `workflow::On Beta` |
| 7 | 部署至 staging | → `workflow::On Staging` |
| 8 | 排定上線 | → `workflow::To Be Released` |
| 9 | 正式上線 | → `workflow::On Prod` |

> 注意：如果一張 Issue 拆成多個 MR，workflow 狀態以「整張 Issue 的進度」為準。
> 例如第一個 MR 已 merged 但還有其他實作範圍在開發中，Issue 維持 `workflow::Developing`。
> 所有 MR 都 merged 後才轉為 `workflow::On Dev`。

---

## 前端 RD Issue 建立時的 Label Checklist

建立前端技術 Issue 時，確認以下 Label 都有標上：

- [ ] `FE` — 固定標籤
- [ ] `workflow::Ready To Develop` — 固定初始狀態
- [ ] `# type` — 從 PM Issue 帶回（`# type::feature` 或 `# type::bug`）
- [ ] `product` — 從 PM Issue 帶回
- [ ] `$ priority` — 從 PM Issue 帶回（若有）
