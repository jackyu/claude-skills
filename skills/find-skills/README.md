# Find Skills

> 協助使用者從開放 skills 生態系中探索與安裝 agent skills

## 用途

協助使用者透過 Skills CLI（`npx skills`）尋找並安裝 skills。當使用者詢問可能已有對應 skill 的功能時，此 skill 會搜尋生態系、呈現匹配選項，並提供安裝協助。

## 使用時機

- 使用者詢問「如何做 X」，而 X 可能已有對應的 skill
- 使用者說「幫我找一個做 X 的 skill」或「有沒有做 X 的 skill」
- 使用者詢問「你能做 X 嗎」，而 X 是一項專門的功能
- 使用者想搜尋工具、模板或工作流程
- 使用者提到想要某個特定領域的協助（設計、測試、部署等）

## 主要功能

- 透過 `npx skills find [query]` 搜尋開放 skills 生態系
- 使用 `npx skills add <package> -g -y` 全域安裝 skills
- 使用 `npx skills check` 和 `npx skills update` 檢查更新
- 在 https://skills.sh/ 瀏覽 skills
- 提供常見分類建議以提高搜尋效率

## 檔案內容

| 檔案 | 說明 |
|------|------|
| `SKILL.md` | 主要 skill 指令 |

## Language

zh-TW

---

*屬於 [claude-skills](../../README.md) 的一部分*
