# Vercel React Best Practices

> 來自 Vercel Engineering 的 React 與 Next.js 效能最佳化指南

## 用途

由 Vercel 維護的 React 與 Next.js 應用程式全面效能最佳化指南。包含 8 個分類共 57 條規則，依影響程度排序，用於指導自動化重構、程式碼生成與 code review 以達成最佳效能模式。

## 使用時機

- 撰寫新的 React 元件或 Next.js 頁面
- 審查或重構 React/Next.js 程式碼以提升效能
- 實作資料擷取（client 端或 server 端）
- 最佳化 bundle 大小或載入時間
- 在程式碼生成過程中套用最佳實踐

## 主要功能

- 8 個優先分類共 57 條規則
- 消除瀑布式載入（CRITICAL）：Promise.all、Suspense boundaries、deferred awaits
- Bundle 大小最佳化（CRITICAL）：barrel imports、dynamic imports、第三方套件延遲載入
- Server 端效能（HIGH）：React.cache、LRU cache、平行擷取
- Client 端資料擷取（MEDIUM-HIGH）：SWR dedup、passive event listeners
- 重新渲染最佳化（MEDIUM）：derived state、functional setState、transitions
- 每條規則檔案包含錯誤/正確程式碼範例與說明

## 檔案內容

| 檔案 | 說明 |
|------|------|
| `SKILL.md` | 主要 skill 指令，含規則索引 |
| `AGENTS.md` | 完整編譯文件，展開所有規則 |
| `rules/` | 包含 57 個獨立規則檔案的目錄 |
| `rules/async-parallel.md` | 對獨立操作使用 Promise.all() |
| `rules/bundle-barrel-imports.md` | 直接 import，避免 barrel files |
| `rules/bundle-dynamic-imports.md` | 對大型元件使用 next/dynamic |
| ... | （更多規則檔案） |

## Language

zh-TW

---

*屬於 [claude-skills](../../README.md) 的一部分*
