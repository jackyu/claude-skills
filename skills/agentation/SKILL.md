---
name: agentation
description: 在 Next.js 專案中安裝並設定 Agentation 視覺回饋工具列，讓非工程背景的人可直接在畫面上標註意見再回饋給開發者。使用時機：(1) 用戶要求加入 Agentation 或視覺回饋工具列, (2) 用戶想讓 PM、QA、設計師能直接在畫面上點選並留言, (3) 用戶提到要整合 annotation toolbar、feedback widget 進 Next.js 專案, (4) 專案尚未安裝 agentation 套件、用戶想快速導入。即使用戶只說「幫我裝一下標註工具」也應觸發此 skill。
---

# Agentation Setup

Set up the Agentation annotation toolbar in this project.

## Steps

1. **Check if already installed**
   - Look for `agentation` in package.json dependencies
   - If not found, run `npm install agentation` (or pnpm/yarn based on lockfile)

2. **Check if already configured**
   - Search for `<Agentation` or `import { Agentation }` in src/ or app/
   - If found, report that Agentation is already set up and exit

3. **Detect framework**
   - Next.js App Router: has `app/layout.tsx` or `app/layout.js`
   - Next.js Pages Router: has `pages/_app.tsx` or `pages/_app.js`

4. **Add the component**

   For Next.js App Router, add to the root layout:
   ```tsx
   import { Agentation } from "agentation";

   // Add inside the body, after children:
   {process.env.NODE_ENV === "development" && <Agentation />}
   ```

   For Next.js Pages Router, add to _app:
   ```tsx
   import { Agentation } from "agentation";

   // Add after Component:
   {process.env.NODE_ENV === "development" && <Agentation />}
   ```

5. **Confirm component setup**
   - Tell the user the Agentation toolbar component is configured

6. **Check if MCP server already configured**
   - Read `~/.claude/claude_code_config.json` if it exists
   - Check if `mcpServers.agentation` entry exists
   - If yes, skip to final confirmation step

7. **Configure Claude Code MCP server**
   - Create `~/.claude/` directory if it doesn't exist
   - Read existing `claude_code_config.json` if present (preserve other MCP servers)
   - Add or merge the `mcpServers.agentation` entry:
     ```json
     {
       "mcpServers": {
         "agentation": {
           "command": "npx",
           "args": ["agentation-mcp", "server"]
         }
       }
     }
     ```
   - Write updated config back to file

8. **Confirm full setup**
   - Tell the user both components are set up:
     - React component for the toolbar (`<Agentation />`)
     - MCP server configured to auto-start with Claude Code
   - Tell user to restart Claude Code to load the MCP server
   - Explain that annotations will now sync to Claude automatically

## Notes

- The `NODE_ENV` check ensures Agentation only loads in development
- Agentation requires React 18
- The MCP server auto-starts when Claude Code launches (uses npx, no global install needed)
- Port 4747 is used by default for the HTTP server
- Run `npx agentation-mcp doctor` to verify setup
