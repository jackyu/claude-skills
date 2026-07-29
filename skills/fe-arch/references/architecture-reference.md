# Architecture Reference

fe-arch skill 的完整參考文件。SKILL.md 是決策流程（procedural），本文件是參考資料（reference）：完整目錄地圖、程式碼範例、工具強制設定、決策依據出處。

上游依據：[bulletproof-react — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)。本規範定位為其 **Next.js App Router + TanStack Query + Zod 裁剪版**，團隊有疑義時以本文件為準，原典作為背景參考。

---

## 1. 完整目錄地圖（Directory Map）

```
(專案根目錄)
  e2e/                          ← E2E 測試（Playwright），唯一不跟著原始碼走的測試
  src/
    app/                        ← Next.js routes，只放薄殼
      (dashboard)/
        branches/
          page.tsx              ← 組裝 feature + Server Component 預取，不寫邏輯
          layout.tsx
    components/
      ui/                       ← shadcn 元件與延伸，純視覺、無業務語意
        button.tsx
        dialog.tsx
      layout/                   ← header、sidebar、footer 等版面骨架
    features/
      branch-management/        ← 功能 feature（對應使用者操作）
        api/
          get-branches.ts       ← 一操作一檔：fetch + queryOptions + hook
          create-branch.ts
          keys.ts               ← key factory（branchKeys）
          __mocks__/
            handlers.ts         ← 僅此 feature 使用的 MSW handler
        components/
          __tests__/
            branch-table.test.tsx      ← 單檔元件的測試放同層 __tests__/
          branch-filter/
            __tests__/
              branch-filter.test.tsx   ← 每層一個 __tests__/
            index.ts            ← 只 re-export
            branch-filter.tsx
          branch-table.tsx      ← 尚未長大的元件維持單檔
        hooks/
          use-branch-filter-state.ts   ← 純 client 邏輯 hook
        types/
          branch.ts             ← Zod schema + z.infer type
        __tests__/
          utils.test.ts         ← feature 層檔案的測試
        utils.ts
      instrument/               ← 領域 feature（entity）：共用業務資料
        api/
          get-instrument.ts
          keys.ts
        types/
          instrument.ts
    hooks/                      ← 跨 feature 的純 client hooks
      use-disclosure.ts
      use-debounce.ts
    stores/                     ← 跨 feature 全域狀態（Zustand 等）；單一 feature 用的留在該 feature 內
    constants/                  ← 跨 feature 常數；單一 feature 用的留在該 feature 內
    lib/                        ← 基礎設施（拔掉整個 app 不能動）
      api-client.ts             ← axios/ky instance：baseURL、auth header、錯誤攔截
      react-query.ts            ← QueryClient 預設值：staleTime、retry 策略
      auth.tsx                  ← user-info fetch + schema + useUser + 登入登出
      utils.ts                  ← cn() 等真正通用的工具
    testing/                    ← 測試基礎設施
      setup.ts                  ← vitest setup（jest-dom、MSW server 啟動）
      test-utils.tsx            ← 自訂 render（包 Providers），re-export RTL
      mocks/
        server.ts
        handlers/               ← 全域共用 handler（auth、user-info）
      data-generators.ts        ← 假資料 factory
```

### 各層職責一句話

| 目錄 | 職責 | 判斷標準 |
|------|------|----------|
| `app/` | 路由薄殼 | 需要寫測試 = 邏輯漏進來了 |
| `components/ui` | 純視覺元件 | 不知道任何業務名詞 |
| `components/layout` | 版面骨架 | 全站共用的頁面框架 |
| `features/{功能}` | 使用者操作 | 有明確的業務動詞（篩選、下單、管理） |
| `features/{領域}` | 共用業務資料 | 名詞型、被多個功能 feature 依賴 |
| `hooks/` | 跨 feature 純 client hook | 兩個以上 feature 使用且不碰 server state |
| `stores/` / `constants/` | 跨 feature 全域狀態與常數 | 第二個使用者出現才提升到這裡 |
| `lib/` | 基礎設施 | 拔掉整個 app 不能動 |
| `testing/` | 測試基礎設施 | 測試共用的 setup 與工具 |

---

## 2. API 層標準範例

### 2.1 Query：`features/branch-management/api/get-branches.ts`

```ts
import { queryOptions, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api-client';
import { branchSchema } from '../types/branch';
import { branchKeys } from './keys';

// 1. 回應 schema：在 fetch 邊界驗證（boundary validation）
const getBranchesResponseSchema = z.object({
  data: z.array(branchSchema),
  total: z.number(),
});

export type GetBranchesParams = { keyword?: string };

// 2. fetch 函式：回應必經 parse，驗證失敗直接 throw
export const getBranches = async (params: GetBranchesParams) => {
  const res = await api.get('/branches', { params });
  return getBranchesResponseSchema.parse(res.data);
};

// 3. queryOptions：key 與 fetch 綁定，可被 Server Component 預取共用
export const getBranchesQueryOptions = (params: GetBranchesParams) =>
  queryOptions({
    queryKey: branchKeys.list(params),
    queryFn: () => getBranches(params),
  });

// 4. hook：元件使用的唯一入口
export const useBranches = (params: GetBranchesParams) =>
  useQuery(getBranchesQueryOptions(params));
```

### 2.2 Mutation：`features/branch-management/api/create-branch.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api-client';
import { branchSchema } from '../types/branch';
import { branchKeys } from './keys';

// 輸入 schema：與 react-hook-form 的 zodResolver 共用同一份
export const createBranchInputSchema = z.object({
  name: z.string().min(1, '名稱必填'),
  region: z.enum(['north', 'central', 'south']),
});
export type CreateBranchInput = z.infer<typeof createBranchInputSchema>;

export const createBranch = async (input: CreateBranchInput) => {
  const res = await api.post('/branches', input);
  return branchSchema.parse(res.data);
};

export const useCreateBranch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBranch,
    onSuccess: () => {
      // 禁止手拼 ['branches'] 字串，一律走 key factory
      queryClient.invalidateQueries({ queryKey: branchKeys.lists() });
    },
  });
};
```

### 2.3 Key Factory：`features/branch-management/api/keys.ts`

```ts
export const branchKeys = {
  all: ['branches'] as const,
  lists: () => [...branchKeys.all, 'list'] as const,
  list: (params: { keyword?: string }) => [...branchKeys.lists(), params] as const,
  details: () => [...branchKeys.all, 'detail'] as const,
  detail: (id: string) => [...branchKeys.details(), id] as const,
};
```

跨 feature invalidate 時 import owner 的 factory：

```ts
// features/order/api/place-order.ts
import { instrumentKeys } from '@/features/instrument/api/keys';
// onSuccess 內：
queryClient.invalidateQueries({ queryKey: instrumentKeys.detail(symbol) });
```

### 2.4 Types：`features/branch-management/types/branch.ts`

```ts
import { z } from 'zod';

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.enum(['north', 'central', 'south']),
  createdAt: z.string().datetime(),
});

// type 一律推導，禁止手寫重複 interface
export type Branch = z.infer<typeof branchSchema>;
```

---

## 3. 高風險域強制規則（Broker-Specific）

以下領域的 API 回應**必須**在 fetch 邊界 `parse()`，禁止 `as` 型別斷言跳過、禁止 `z.any()`：

| 高風險域 | 範例欄位 | 風險 |
|----------|----------|------|
| 委託 / 成交邏輯 | 委託狀態、成交回報 | 狀態誤判導致重複下單 |
| 金額精度 | 價格、股數、手續費 | 浮點誤差、單位錯置 |
| 權限邊界 | 帳戶權限、功能開關 | 越權操作 |
| 即時報價 | 買賣五檔、成交價 | 顯示錯價 |
| 付款狀態機 | 扣款 / 圈存狀態 | 狀態不一致 |

數值欄位建議加上 refinement（如 `z.number().nonnegative()`、精度檢查），讓後端異常資料在邊界爆出明確錯誤，而非滲透到元件層變成 `NaN`。

---

## 4. 測試基礎設施範例

### 4.1 自訂 render：`src/testing/test-utils.tsx`

```tsx
import { render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },   // 測試中關閉 retry，避免 timeout
      mutations: { retry: false },
    },
  });

export const render = (ui: ReactElement) => {
  const queryClient = createTestQueryClient();
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
};

// re-export，測試檔一律從 @/testing/test-utils import
export * from '@testing-library/react';
```

### 4.2 Feature 專屬 MSW handler 疊加

```ts
// features/branch-management/components/branch-filter/__tests__/branch-filter.test.tsx
import { server } from '@/testing/mocks/server';
import { branchHandlers } from '@/features/branch-management/api/__mocks__/handlers';

beforeEach(() => server.use(...branchHandlers));
```

> 測試檔在 `__tests__/` 內，相對路徑會多一層（`../../branch-filter`）。跨目錄引用（MSW handler、testing utils）一律走 `@/` alias，別堆 `../../../`。

---

## 5. ESLint 邊界強制（硬約束）

規範不能只靠 prose，以下規則寫進 flat config，讓人與 AI 都繞不過：

```js
// eslint.config.mjs（節錄）
import importPlugin from 'eslint-plugin-import';

export default [
  {
    plugins: { import: importPlugin },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // 功能 feature 之間禁止互相 import
            // （領域 feature 白名單：instrument、branch 等可被 import）
            {
              target: './src/features/order',
              from: './src/features',
              except: ['./order', './instrument', './branch'],
            },
            {
              target: './src/features/watchlist',
              from: './src/features',
              except: ['./watchlist', './instrument'],
            },
            // 共用層禁止 import feature（依賴單向：共用層在下，feature 在上）
            {
              target: [
                './src/components',
                './src/hooks',
                './src/lib',
                './src/testing',
              ],
              from: './src/features',
            },
            // feature 禁止 import app（app 在最上層）
            {
              target: './src/features',
              from: './src/app',
            },
          ],
        },
      ],
    },
  },
];
```

維護方式：新增功能 feature 時，在對應 zone 的 `except` 加入它依賴的領域 feature。若發現需要把某 feature 加進多個 `except` 白名單，代表它已是領域 feature，應正式歸類。

---

## 6. 決策依據與延伸閱讀

| 主題 | 出處 |
|------|------|
| Feature-based 架構原典 | [bulletproof-react / project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) |
| Colocation 原則 | Kent C. Dodds — *Colocation* |
| 檔案 vs 目錄、index.ts 策略 | Josh Comeau — *Delightful React File/Directory Structure* |
| queryOptions 模式 | TkDodo — *The Query Options API* |
| Key factory 模式 | TkDodo — *Effective React Query Keys* |
| 領域層（entities）概念 | [Feature-Sliced Design — Layers](https://feature-sliced.github.io/) |
| App Router colocation 官方立場 | Next.js Docs — *Project Organization* |

## 變更紀錄

| 日期 | 變更 |
|------|------|
| 2026-07-21 | 初版：目錄地圖、API 三層結構、共用歸屬決策、測試就近放置、ESLint 邊界 |
| 2026-07-21 | 測試改為每層一個 `__tests__/` 目錄（bulletproof-react 風格），取代原本的並排 colocation |
