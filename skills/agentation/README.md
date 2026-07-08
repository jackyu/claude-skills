# Agentation

> 為 Next.js 專案加入 Agentation 視覺回饋工具列

## 用途

在 Next.js 專案中設定 Agentation 標註工具列，包含 React 元件與 Claude Code MCP 伺服器設定。此功能可在開發過程中啟用視覺標註，並自動同步至 Claude。

## 使用時機

- 在新建或既有 Next.js 專案中設定 Agentation
- 為 Claude Code 設定 Agentation MCP 伺服器

## 主要功能

- 自動偵測 Next.js App Router 或 Pages Router
- 安裝並設定 `<Agentation />` React 元件（僅限開發環境）
- 在 `~/.claude/claude_code_config.json` 中設定 MCP 伺服器
- 若已設定則自動跳過相關步驟

## 檔案內容

| 檔案 | 說明 |
|------|------|
| `SKILL.md` | 主要 skill 指令 |

## Language

zh-TW

---

*屬於 [claude-skills](../../README.md) 的一部分*
