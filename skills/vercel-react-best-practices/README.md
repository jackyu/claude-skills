# Vercel React Best Practices

> 來自 Vercel Engineering 的 React 與 Next.js 效能最佳化指南

## 用途

由 Vercel 維護的 React 與 Next.js 效能最佳化指南。8 個分類共 70 條規則，依影響程度排序。只在有具體效能問題、或明確要做效能審查時載入，不在日常寫元件時套用。

## 使用時機

- 調查實際量到或被回報的效能問題（載入慢、bundle 大、請求瀑布、re-render 過多、hydration 閃爍、輸入卡頓）
- 專門針對效能審查程式碼
- 最佳化 bundle 大小或載入時間

使用者與專案規則優先。規則寫了「不要過度優化」時，`js-*` 和 `rerender-memo*` 這類微優化除非 profiling 證明有成本，否則不套用。依賴 React 19 API 的規則（`<Activity>`、`useEffectEvent`）只在實際執行的 React 版本支援時才適用。

## 主要功能

- 8 個優先分類共 70 條規則
- 消除瀑布式載入（CRITICAL）：Promise.all、Suspense boundaries、deferred awaits
- Bundle 大小最佳化（CRITICAL）：barrel imports、dynamic imports、可靜態分析的 import 路徑
- Server 端效能（HIGH）：React.cache、LRU cache、平行擷取、避免 module 層級的共用請求狀態
- Client 端資料擷取（MEDIUM-HIGH）：SWR dedup、passive event listeners
- 重新渲染最佳化（MEDIUM）：derived state、functional setState、transitions、不在元件內定義元件
- 每條規則檔案包含錯誤／正確程式碼範例與說明

## 檔案內容

| 檔案 | 說明 |
|------|------|
| `SKILL.md` | 主要 skill 指令，含規則索引 |
| `rules/` | 70 個獨立規則檔案（唯一的規則來源），另有 `_sections.md`、`_template.md` |
| `rules/async-parallel.md` | 對獨立操作使用 Promise.all() |
| `rules/bundle-barrel-imports.md` | 直接 import，避免 barrel files |
| `rules/bundle-dynamic-imports.md` | 對大型元件使用 next/dynamic |
| ... | （更多規則檔案） |

## 上游

[vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices)。`rules/` 照搬上游；本地刻意不收上游的 `AGENTS.md`（rules/ 的編譯副本）與 `metadata.json`，並改窄 SKILL.md 的觸發描述。

## Language

zh-TW

---

*屬於 [claude-skills](../../README.md) 的一部分*
