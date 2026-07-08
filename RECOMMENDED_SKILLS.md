# 推薦開源 Skills

社群維護的開源 agent skills 推薦清單，可透過 `npx skills add` 安裝。

> 瀏覽更多：[skills.sh](https://skills.sh/)

## 安裝方式

```bash
# 搜尋 skills
npx skills find [query]

# 安裝指定 skill
npx skills add <owner/repo@skill> -g -y
```

---

## 前端開發

| Skill | 說明 | 安裝 |
|---|---|---|
| [vercel-react-best-practices](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) | 來自 Vercel Engineering 的 React 與 Next.js 效能最佳化指南 | `npx skills add vercel-labs/agent-skills@vercel-react-best-practices` |
| [typescript-advanced-types](https://skills.sh/wshobson/agents/typescript-advanced-types) | TypeScript 進階型別系統指南，涵蓋 generics、conditional types、mapped types 等 | `npx skills add wshobson/agents@typescript-advanced-types` |
| [react-doctor](https://skills.sh/millionco/react-doctor/react-doctor) | 掃描 React 程式碼中的安全、效能、正確性與架構問題，提供診斷評分 | `npx skills add millionco/react-doctor@react-doctor` |
| [no-useEffect](https://gist.github.com/alvinsng/5dd68c6ece355dbdbd65340ec2927b1d) | 消除不必要的 `useEffect`，改用 derived state、event handler、useQuery 等替代模式 | [Gist](https://gist.github.com/alvinsng/5dd68c6ece355dbdbd65340ec2927b1d) |

## UI / 設計

| Skill | 說明 | 安裝 |
|---|---|---|
| [frontend-design](https://skills.sh/anthropics/skills/frontend-design) | 建立獨特的 production-grade 前端介面，注重美學細節與創意設計 | `npx skills add anthropics/skills@frontend-design` |
| [ui-ux-pro-max](https://skills.sh/nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max) | 綜合設計系統：50+ 風格、97 色板、57 字型搭配、99 UX 準則 | `npx skills add nextlevelbuilder/ui-ux-pro-max-skill@ui-ux-pro-max` |
| [tailwind-design-system](https://skills.sh/wshobson/agents/tailwind-design-system) | 使用 Tailwind CSS v4 建立 production-ready 設計系統，含 design tokens 與元件變體 | `npx skills add wshobson/agents@tailwind-design-system` |
| [shadcn-ui](https://skills.sh/giuseppe-trisciuoglio/developer-kit/shadcn-ui) | 使用 shadcn/ui、Radix UI 與 Tailwind CSS 建立可存取、可客製化的 UI 元件 | `npx skills add giuseppe-trisciuoglio/developer-kit@shadcn-ui` |
| [responsive-design](https://skills.sh/wshobson/agents/responsive-design) | 現代響應式設計技術，涵蓋 container queries、fluid typography、Grid/Flexbox 佈局 | `npx skills add wshobson/agents@responsive-design` |

## 測試 / 安全

| Skill | 說明 | 安裝 |
|---|---|---|
| [e2e-testing-patterns](https://skills.sh/wshobson/agents/e2e-testing-patterns) | E2E 測試最佳實踐，支援 Playwright 與 Cypress 框架 | `npx skills add wshobson/agents@e2e-testing-patterns` |
| [audit-website](https://skills.sh/squirrelscan/skills/audit-website) | 網站綜合審計，涵蓋 230+ 規則、21 類別（SEO、效能、安全、無障礙） | `npx skills add squirrelscan/skills@audit-website` |

## 工作流程

| Skill | 說明 | 安裝 |
|---|---|---|
| [find-skills](https://skills.sh/vercel-labs/skills/find-skills) | 從開放 skills 生態系中探索與安裝 agent skills | `npx skills add vercel-labs/skills@find-skills` |
| [brainstorming](https://skills.sh/obra/superpowers/brainstorming) | 透過結構化對話將想法轉化為完整的設計與規格文件 | `npx skills add obra/superpowers@brainstorming` |
| [using-git-worktrees](https://skills.sh/obra/superpowers/using-git-worktrees) | 建立隔離的 git worktrees 進行並行開發 | `npx skills add obra/superpowers@using-git-worktrees` |
| [grill-me](https://skills.sh/mattpocock/skills/grill-me) | 逐一提問審視你的計畫與設計，系統性走過所有決策分支，找出盲點 | `npx skills add mattpocock/skills@grill-me` |

## 後端 / 資料庫

| Skill | 說明 | 安裝 |
|---|---|---|
| [backend-patterns](https://github.com/affaan-m/everything-claude-code) | API、資料庫與快取設計模式 | `npx skills add affaan-m/everything-claude-code@backend-patterns` |
| [api-design](https://github.com/affaan-m/everything-claude-code) | REST API 設計、分頁與錯誤回應規範 | `npx skills add affaan-m/everything-claude-code@api-design` |
| [postgres-patterns](https://github.com/affaan-m/everything-claude-code) | PostgreSQL 查詢最佳化模式 | `npx skills add affaan-m/everything-claude-code@postgres-patterns` |
| [database-migrations](https://github.com/affaan-m/everything-claude-code) | 資料庫遷移模式，支援 Prisma、Drizzle、Django、Go | `npx skills add affaan-m/everything-claude-code@database-migrations` |

## DevOps / 部署

| Skill | 說明 | 安裝 |
|---|---|---|
| [deployment-patterns](https://github.com/affaan-m/everything-claude-code) | CI/CD、Docker、健康檢查與回滾策略 | `npx skills add affaan-m/everything-claude-code@deployment-patterns` |
| [docker-patterns](https://github.com/affaan-m/everything-claude-code) | Docker Compose、網路、volumes 與安全配置 | `npx skills add affaan-m/everything-claude-code@docker-patterns` |

## 影片

| Skill | 說明 | 安裝 |
|---|---|---|
| [remotion-best-practices](https://skills.sh/remotion-dev/skills/remotion-best-practices) | Remotion 最佳實踐 — 使用 React 製作程式化影片 | `npx skills add remotion-dev/skills@remotion-best-practices` |

---

## Plugins

Claude Code 官方或社群維護的 plugins，提供多 agent 協作能力。

> 安裝方式：`/plugin install <name>` 或手動複製到 `~/.claude/plugins/`

### 官方 Plugins（Anthropic）

| Plugin | 說明 | 安裝 |
|---|---|---|
| [pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit) | 6 個專業 PR review agents：comment 分析、測試覆蓋、silent failure 偵測、型別設計評估、code review、程式碼簡化 | `/plugin install pr-review-toolkit` |
| [code-review](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review) | 多 agent 並行 PR 審查，含 CLAUDE.md 合規檢查、bug 掃描、git blame 歷史分析，使用 confidence scoring（≥80）過濾 false positive | `/plugin install code-review` |
| [code-simplifier](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-simplifier) | 程式碼簡化 agent，降低不必要的複雜度、改善命名與結構，保留原始功能 | `/plugin install code-simplifier` |
| [security-guidance](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/security-guidance) | 安全指引 plugin，透過 hooks 在開發流程中提供安全性檢查與建議 | `/plugin install security-guidance` |
| [skill-creator](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/skill-creator) | Skill 全生命週期管理：建立、優化、執行 evals 測試、效能基準分析 | `/plugin install skill-creator` |
| [gitlab](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/gitlab) | GitLab 整合，透過 MCP 提供 GitLab 專案、MR、Issue 操作能力 | `/plugin install gitlab` |
| [figma](https://github.com/figma/mcp-server-guide) | Figma MCP server 整合，從設計稿生成程式碼、擷取 design tokens、元件連結 | `claude mcp add --transport http figma https://mcp.figma.com/mcp` |
| [playwright](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/playwright) | Playwright 瀏覽器自動化整合，支援 E2E 測試、網頁互動與截圖 | `/plugin install playwright` |
| [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) | 迭代式開發迴圈，自動重複執行 prompt 直到任務完成，適合 TDD、greenfield 專案等有明確完成條件的任務 | `/plugin install ralph-loop` |
| [claude-md-management](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-md-management) | CLAUDE.md 維護工具：審計品質、擷取 session 學習紀錄、保持專案記憶更新 | `/plugin install claude-md-management` |

### 社群 Plugins

| Plugin | 說明 | 安裝 |
|---|---|---|
| [superpowers](https://github.com/obra/superpowers) | 完整的 agentic 開發方法論：brainstorming → worktree → planning → TDD → code review → completion | `/plugin install superpowers@claude-plugins-official` |
| [everything-claude-code](https://github.com/affaan-m/everything-claude-code) | 28 agents + 116 skills + 60 commands，涵蓋多語言開發、安全掃描、TDD 等完整工作流 | `/plugin marketplace add affaan-m/everything-claude-code` |

---

## 綜合集合

| 集合 | 說明 | 連結 |
|---|---|---|
| [everything-claude-code](https://github.com/affaan-m/everything-claude-code) | Anthropic hackathon 冠軍的完整 Claude Code 配置集合，含 40+ skills 涵蓋多語言（Python、Go、Java、Swift、C++）、TDD、安全審計、Django、Spring Boot 等 | [GitHub](https://github.com/affaan-m/everything-claude-code) |
