# preview

> 把提案 / 計畫 / 想法變成互動式 HTML 頁面，部署到 Vercel 取得可分享連結，並內嵌註解 overlay 收集回饋

## Purpose

將任何提案、計畫、規格或點子轉成可點擊試用的互動 HTML，部署到 Vercel 後給出一個分享連結。頁面內建註解 overlay，讓檢視者可以反白文字、留言，並一鍵把回饋匯出成 markdown 回傳給 agent。比起一大段 markdown，連結更容易讓人快速理解並具體回饋。

## When to Use

- 用戶想把東西視覺化、做成網頁、做成可互動的形式
- 用戶要分享 work-in-progress 給人 review
- 用戶要求圖表 / 流程圖 / 可試算的計算器頁面
- 用戶說「make a preview」「turn this into a webpage」「visualize this」「render as HTML」「make this reviewable」等

## Key Features

- **互動 HTML 產出**：依內容套用 `assets/template.html`，必要時搭配 `references/libs.md` 列出的前端 library
- **一鍵部署 Vercel**：`scripts/deploy.sh` 推導專案名後 `vercel link` + `vercel deploy`，回傳 preview URL
- **部署前 preflight**：`scripts/preflight.sh` 先確認 Vercel CLI 已安裝、已登入、token 有效，失敗時給明確修復指令
- **註解 overlay**：`assets/comment-overlay.js` 注入頁面，支援反白標註與匯出回饋 markdown
- **本機 fallback**：未設定 Vercel 時可改用 `open` 在本機開啟 HTML
- **路徑偏好持久化**：以 `~/.claude/solopreneur.json` 記住每個 repo 的提案存放路徑（helper 已 inline 於 SKILL.md，無外部相依）

## Dependencies

- **Vercel CLI**（部署所需）：`npm i -g vercel` 或 `brew install vercel-cli`，並 `vercel login`。未安裝則只能本機預覽。
- **jq**：config helper 讀寫 `solopreneur.json` 時使用。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Main skill instructions |
| `scripts/preflight.sh` | Vercel CLI 安裝 / 登入 / token 檢查 |
| `scripts/deploy.sh` | 部署目錄到 Vercel 並回傳 URL |
| `assets/template.html` | 互動頁面 HTML 範本 |
| `assets/comment-overlay.js` | 頁內註解 overlay（反白 + 匯出回饋） |
| `references/libs.md` | 可選用的前端 library 清單與用法 |

## Source

引入自上游 [hanamizuki/solopreneur](https://github.com/hanamizuki/solopreneur/tree/main/plugins/solopreneur/skills/preview)（`plugins/solopreneur/skills/preview`）。

## Language

en

---

*Part of [claude-skills](../../README.md)*
