# 學習標籤

從以下 12 個標籤中選擇 1-3 個最相關的，保持精簡。可以新增專案專屬標籤，但避免氾濫。

| 標籤 | 涵蓋範圍 |
|---|---|
| `設計模式` | Compound Component、HOC、Render Props、Observer、State Machine 等 |
| `效能優化` | memo、lazy loading、虛擬捲動、bundle 優化、快取策略 |
| `狀態管理` | useState、useReducer、Context、Zustand、狀態機 |
| `元件抽象` | 可複用元件設計、API 設計、props 介面 |
| `TypeScript` | 型別設計、泛型、utility types、type guard、discriminated union |
| `API 串接` | 資料 fetching、快取、錯誤處理、loading 狀態、React Query |
| `測試` | 單元測試、整合測試、E2E、測試策略、MSW |
| `CSS/樣式` | Tailwind、CSS-in-JS、RWD、動畫、Design Token |
| `工程實踐` | 程式碼組織、命名慣例、文件結構、CI/CD |
| `錯誤處理` | Error Boundary、try-catch 策略、fallback UI、Sentry |
| `重構` | 程式碼改善、技術債清理、漸進式重構 |
| `無障礙` | a11y、ARIA、鍵盤導航、螢幕閱讀器、WCAG |

## 使用準則

- **不貪多**：3 個以內。若覺得要 4 個，通常表示 MR 範圍過大，可以拆成多份筆記。
- **不取「程式語言」標籤**：`TypeScript` 標籤只在「型別技巧」是學習重點時才用，不是「這個 MR 用 TS 寫」就標。
- **新增專案標籤的命名**：與既有標籤同樣短、可單獨理解，避免 `frontend-auth-flow` 這種冗長組合。
