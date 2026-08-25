---
name: fe-arch
description: 前端專案架構規範（Frontend Architecture Convention），定義檔案與目錄的放置規則。使用時機：(1) 建立新元件、新檔案、新目錄時, (2) 新增 API 呼叫、query、mutation、hook 時, (3) 用戶詢問「這個檔案該放哪」「要不要抽共用」「該不該建目錄」, (4) 建立新 feature、新頁面時, (5) 撰寫測試檔決定放置位置時, (6) 重構或搬移檔案時, (7) Code review 檢查檔案位置是否符合規範時。即使用戶只是說「幫我加一個 XX 元件」「加一支 API」，也應先載入此 skill 確認檔案位置後再動工。
---

# Frontend Architecture Convention

前端專案的目錄架構規範，基於 bulletproof-react 的 feature-based 架構，針對 Next.js App Router + TanStack Query + Zod 技術棧裁剪。

此 skill 的目標：讓「檔案該放哪」不需要討論。任何建檔決策都應能透過以下決策流程在 30 秒內得到唯一答案。

適用範圍：採 Next.js App Router + TanStack Query + Zod 的前端專案。

## 使用方式

**建立任何新檔案前**，依序執行：

1. 判斷檔案類型，走對應的決策流程（Phase 1-6）
2. 不確定時，查閱 `references/architecture-reference.md` 的完整目錄地圖與範例
3. 產出檔案後，在回覆中簡短說明放置位置的判斷依據（一句話即可）

**禁止事項**：

- 禁止建立 `features/common`、`features/shared` 這類目錄——共用需求依 Phase 3 決策流程處理
- 禁止在全域 `utils/`、`lib/` 直接新增只有單一 feature 使用的函式
- 禁止 feature 之間互相 import（領域 feature 例外，見 Phase 3）
- 禁止建立內容只有轉出（re-export）以外邏輯的 `index.tsx` 作為元件主檔

---

## Phase 1：新元件（Component）

```
這個元件有業務語意嗎？（它知道什麼是 branch / order / instrument 嗎？）
├─ 沒有（純視覺、可出現在任何產品）
│    → src/components/ui/（shadcn primitives 及其延伸）
│    → 版面骨架（header、sidebar）→ src/components/layout/
└─ 有
     → src/features/{feature}/components/
```

**單檔 vs 目錄**：

- 預設建立單一檔案：`branch-filter.tsx`
- 出現以下任一情況時，升級為目錄：
  - 需要拆出子元件
  - 需要專屬 hook
  - （加測試檔**不需要**升級為目錄——測試放同層的 `__tests__/` 即可，見 Phase 5）
- 目錄結構固定為：
  ```
  branch-filter/
    __tests__/
      branch-filter.test.tsx
    index.ts               ← 只做 re-export：export * from './branch-filter'
    branch-filter.tsx      ← 實際邏輯，禁止命名為 index.tsx
    use-branch-filter.ts   ← 若有專屬 hook
  ```

**命名規則**：kebab-case 檔名，PascalCase 元件名。

## Phase 2：新 API 呼叫（Query / Mutation）

所有 server state 相關程式碼放在 feature 的 `api/` 目錄，**以「操作」為單位切檔**，一個操作一個檔案：

```
src/features/{feature}/api/
  get-branches.ts      ← 查列表
  get-branch.ts        ← 查單筆
  create-branch.ts     ← 新增
  update-branch.ts     ← 更新
```

每個檔案內部固定三層結構（完整範例見 `references/architecture-reference.md`）：

1. **fetch 函式**：呼叫 `@/lib/api-client`，回應必須經過 Zod `schema.parse()` 驗證
2. **queryOptions**（query 類）：queryKey 與 queryFn 綁定，供 prefetch 與 useQuery 共用
3. **hook**：`useXxx` 作為元件使用的唯一入口

**Mutation 額外規則**：

- 輸入 schema（`xxxInputSchema`）定義在 mutation 檔案內，與 react-hook-form 的 zodResolver 共用同一份
- `onSuccess` 中的 invalidation 必須使用 key factory，禁止手拼字串

**queryKey 管理**：每個 feature 在 `api/` 內維護 key factory（如 `branchKeys`），跨 feature invalidate 時 import owner feature 的 factory。

## Phase 3：共用程式碼的歸屬

```
這段程式碼 / 這支 API 是什麼性質？
├─ 基礎設施：拔掉整個 app 不能動（auth、user-info、api-client、feature flags）
│    → src/lib/
├─ 領域資料：有業務語意、被多個 feature 依賴（instrument、branch、account）
│    → 自己成為一個 feature（領域 feature）
│    → 依賴方向單向：功能 feature 可以 import 領域 feature，反向禁止
└─ 只是恰好被兩個地方用到、沒有領域地位
     → 放在主要使用者的 feature 內，等第三個使用者出現再依上面兩條升級
```

**Hook 的歸屬**：

```
這個 hook 有碰 useQuery / useMutation 嗎？
├─ 有 → features/{feature}/api/（見 Phase 2）
└─ 沒有（純 client 邏輯：useDisclosure、useDebounce…）
     ├─ 只有一個 feature 用 → features/{feature}/hooks/
     └─ 兩個以上 feature 用 → src/hooks/
```

**Pure function / utils**：

- 只有一個 feature 用 → `features/{feature}/utils.ts`
- 第二個使用者出現 → 搬到 `src/lib/`，搬移時重新檢視是否真的通用
- 原則：**就近放置，直到第二個使用者出現才提升**。禁止「先放全域以備共用」

## Phase 4：Type 與 Zod Schema

- **Schema 為單一真相來源，type 一律用 `z.infer` 推導**，禁止手寫與 schema 重複的 interface
- Schema 跟著它描述的資料走：
  - API 回應的 schema → `features/{feature}/types/`
  - Mutation 輸入的 schema → 直接放在該 mutation 檔案內（與 form 綁定）
  - 跨 feature 的領域 schema → 領域 feature 的 `types/`
- **高風險域強制驗證**：涉及身分驗證/KYC、審核狀態機、權限邊界、個資欄位的 API 回應，必須在 fetch 邊界 `parse()`，不允許 `as` 斷言跳過（域定義見 `fe-mr-review/references/high-risk-zones.md`）

## Phase 5：測試檔

- **Unit / component test 放在被測檔案所在層的 `__tests__/` 目錄**（bulletproof-react 風格的就近放置）：
  ```
  components/
    branch-filter/
      __tests__/
        branch-filter.test.tsx
      branch-filter.tsx
      index.ts
  ```
  - 測試檔名與被測檔同名 + `.test.tsx`：`branch-filter.tsx` → `__tests__/branch-filter.test.tsx`
  - 規則：「在找某個檔案的測試？看它同層的 `__tests__/`。那裡沒有，就是還沒寫。」
  - 尚未升級成目錄的單檔元件也一樣：`components/branch-table.tsx` → `components/__tests__/branch-table.test.tsx`
  - `api/`、`hooks/`、`utils.ts` 同理：`api/__tests__/get-branches.test.ts`、`features/{feature}/__tests__/utils.test.ts`
- 共用測試基礎設施 → `src/testing/`（setup、自訂 render、MSW server、data generators）
- 只有單一 feature 用的 MSW handler → 該 feature 的 `api/__mocks__/handlers.ts`
- **E2E 是唯一例外** → 專案根目錄 `e2e/`，不跟著原始碼走

## Phase 6：app/ 目錄（Next.js App Router）

- `app/` 只放 route 薄殼：`page.tsx`、`layout.tsx`、`loading.tsx`、`error.tsx`、`route.ts`
- `page.tsx` 只負責組裝 feature 元件與 Server Component 資料預取（`ensureQueryData` + queryOptions），**不寫業務邏輯**
- 判斷訊號：如果 `page.tsx` 需要寫測試，代表邏輯漏到 page 層，應下放至 feature

---

## Code Review 檢查清單

在 `fe:mr-review` / `fe:code-review` 流程中，對每個新增檔案檢查：

- [ ] 元件位置符合 Phase 1（業務語意 → feature；純視覺 → ui）
- [ ] API 檔案一操作一檔，含 fetch + parse + queryOptions + hook 三層
- [ ] 沒有出現 `features/common` 或往全域 utils 塞單一使用者函式
- [ ] 沒有 feature 互相 import（領域 feature 單向依賴除外）
- [ ] type 來自 `z.infer`，高風險域 API 回應有 `parse()`
- [ ] 測試檔放在被測檔案同層的 `__tests__/` 目錄
- [ ] `page.tsx` 內無業務邏輯

## Reference

完整目錄地圖、程式碼範例、ESLint 邊界規則設定、決策依據原文出處，請參考：`references/architecture-reference.md`

## Glossary（詞彙表）

| 中文 | English | 說明 |
|------|---------|------|
| 就近放置 | Colocation | 相關程式碼放在一起，維護性與距離成正比 |
| 領域 feature | Domain feature / Entity | 承載共用業務資料的 feature，僅被單向依賴 |
| 功能 feature | Feature | 對應使用者操作的功能模組 |
| 薄殼 | Thin shell | app/ route 檔案只做組裝，不含邏輯 |
| 單一真相來源 | Single source of truth | Zod schema 定義一次，type 推導取得 |
| 提升 | Promote / Lift | 將程式碼從 feature 層搬到共用層 |
| 邊界驗證 | Boundary validation | 在 fetch 邊界以 schema.parse 驗證外部資料 |
