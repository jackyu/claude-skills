# fe-arch

前端專案的目錄架構規範。基於 bulletproof-react 的 feature-based 架構，針對 **Next.js App Router + TanStack Query + Zod** 技術棧裁剪。

目標只有一個：**讓「這個檔案該放哪」不需要討論**。任何建檔決策都能在 30 秒內走完決策流程得到唯一答案。

適用範圍：採 Next.js App Router + TanStack Query + Zod 的前端專案。

## 解決什麼問題

沒有共同架構規範時，同一個團隊會長出三種結構：

1. **同類檔案散在不同層**：有人把 API 放 `services/`、有人放 `features/*/api/`，找東西要猜
2. **共用層變垃圾場**：「以後可能會用到」就先丟全域 `utils/`，最後沒人敢刪
3. **每次都重新討論**：加一個元件先開會決定放哪，決策成本比實作還高

fe-arch 把這些變成查表題：走 Phase 1–6 的決策樹，出來就是唯一位置。

## 觸發方式

建立任何新檔案前都應該先載入，不必等使用者明講。典型觸發：

- 「幫我加一個 branch-filter 元件」
- 「加一支查詢分公司列表的 API」
- 「這個 formatAmount 要不要抽到共用？」
- 「幫 branch-table 補測試」
- 「這個檔案該放哪？」「要不要建目錄？」
- Code review 時檢查新增檔案位置是否合規

## 六個 Phase（一句話摘要）

| Phase | 主題 | 一句話 |
|---|---|---|
| 1 | 新元件 | 有業務語意 → `features/{feature}/components/`；純視覺 → `components/ui/`。預設單檔，要拆子元件／專屬 hook／測試才升級為目錄 |
| 2 | API 呼叫 | 全進 `features/{feature}/api/`，**一操作一檔**，每檔固定三層：fetch（含 `schema.parse()`）→ `queryOptions` → hook |
| 3 | 共用歸屬 | 基礎設施進 `lib/`；有業務語意且被多方依賴 → 自成領域 feature；其餘就近放置，**第二個使用者出現才提升** |
| 4 | Type 與 Schema | Zod schema 是單一真相來源，type 一律 `z.infer` 推導；高風險域 API 回應強制邊界 `parse()` |
| 5 | 測試檔 | 放被測檔案同層的 `__tests__/` 目錄（bulletproof-react 風格）；E2E 是唯一例外，放專案根 `e2e/` |
| 6 | `app/` 目錄 | 只放 route 薄殼；`page.tsx` 需要寫測試＝邏輯漏出來了 |

## 硬性禁止

- 建立 `features/common`、`features/shared` 這類目錄
- 往全域 `utils/`、`lib/` 塞只有單一 feature 用的函式
- feature 之間互相 import（領域 feature 單向依賴除外）
- 用 `index.tsx` 當元件主檔（`index.ts` 只做 re-export）

## 與其他 fe-\* skill 的分工

| 階段 | Skill | fe-arch 在其中的角色 |
|---|---|---|
| 需求拆解 | `fe-issue` | Subtask 的「產出」欄要寫出符合 fe-arch 的檔案路徑 |
| **建檔／實作** | **`fe-arch`** | **決定檔案位置的唯一來源** |
| 推送前預審 | `fe-code-review` | 跑 fe-arch 的 Code Review 檢查清單 |
| MR 描述 | `fe-mr-generator` | 位置不符時在「注意事項」標注 |
| MR 審查 | `fe-mr-review` | 架構違規分級：位置錯 → Minor；高風險域缺 `parse()` → Critical |
| 合併後 | `fe-mr-digest` | 結構決策列為「架構決策」類學習點 |

規範只在 fe-arch 維護，其他 skill 一律引用不複製——改規範只改一處。

## 最後防線：ESLint

Prose 規範人和 AI 都可能漏，lint error 誰都繞不過。各專案的 flat config 應加上 `import/no-restricted-paths`，強制：

- 功能 feature 之間禁止互相 import（領域 feature 白名單例外）
- 共用層（`components`/`hooks`/`lib`/`testing`）禁止 import `features`
- `features` 禁止 import `app`

完整設定見 [`references/architecture-reference.md`](references/architecture-reference.md) 第 5 節。

## Reference

[`references/architecture-reference.md`](references/architecture-reference.md) — 完整目錄地圖、API 三層結構程式碼範例、高風險域強制規則、測試基礎設施範例、ESLint 邊界設定、決策依據出處。
