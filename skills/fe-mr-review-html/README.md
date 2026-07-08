# FE MR Review HTML

> 將 GitLab Merge Request 審查結果產出為**單一自包含 HTML artifact**

## Purpose

`fe-mr-review` 的 HTML 輸出變體，**完全沿用其審查邏輯與輸出結構**，只把輸出換成對人類友善的 HTML UI：

- **頂部合併建議橫幅**：一打開就知道 同意 / 有條件 / 不同意 + 原因（依結論上色）
- **review 就地內嵌 diff**：每個 finding 像 GitHub/GitLab PR 一樣嵌在對應程式碼行下方、預設展開，同時看程式碼與評論
- 嚴重程度色標 + emoji、severity 篩選與一鍵收合
- 焦點區深度說明（針對用戶不熟的技術概念加入概念說明、流程圖、踩雷點、術語表）
- 可離線、可印製、可分享

## When to Use

- 用戶要求以 HTML / 網頁形式呈現 review
- 用戶說「create an HTML artifact」「render the diff with inline annotations」「color-code findings by severity」
- 用戶想交付 review 報告給非作者（其他 reviewer、PM、QA）
- 用戶說對 PR 中某個概念（streaming、backpressure、cache、並行控制、reconnect 機制…）不熟，希望有講解
- 用戶想用視覺化方式呈現 review 結果

不適合用本 skill 的場景（改用 `fe-mr-review`）：

- 只要快速 review 結論、不需要 artifact
- MR < 30 行純文件 / 樣式
- 用戶明確說「請用文字回覆」

## Key Features

- **自包含 HTML**：所有 CSS / JS 內嵌，無外連 CDN，可直接離線開啟
- **結構對齊 fe-mr-review**：合併建議橫幅、導讀比喻、🚦 風險分流、技術審查 findings、值得學習折疊附屬、名詞補充（**無 Human Review Checklist**，人工確認併入風險分流）
- **就地內嵌 diff 註解**（PR 風格）：finding 嵌在對應行下方、預設展開；同一行多 finding 會堆疊；可 severity 篩選、一鍵收合成單行
- **頂部合併建議橫幅**：依結論上色（綠/黃/紅）+ severity 計數，一眼定生死
- **嚴重程度色標**：Critical / High / Medium / Low / Info 共 5 級
- **焦點區 Deep-Dive**（HTML 獨有）：用戶不熟的概念會多一個區塊（概念說明 + 比喻、流程圖、3-5 段程式碼引用 + 解釋、可能踩雷點、術語表）
- **支援 print**（@media print 樣式，列印自動展開內嵌註解）
- **不引入 framework**：純 HTML + CSS + vanilla JS

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Main skill instructions |
| `references/severity-system.md` | 嚴重程度分級與色碼 |
| `references/focus-area-mode.md` | 焦點區抽取與 deep-dive 五個子段落規範 |
| `references/diff-annotation.md` | 就地內嵌 diff 註解（PR 風格）的 HTML 結構與互動 |
| `references/output-html-structure.md` | 完整 HTML 區塊順序與 class 命名 |
| `assets/template.html` | HTML 模板（含完整 CSS / JS scaffold） |

## Dependency

本 skill 在 SKILL.md 中**引用 `fe-mr-review` 的審查邏輯**（風險分流、類型判定、技術審查、合併建議），請確認該 skill 也已安裝：

```bash
./scripts/install.sh -s fe-mr-review
./scripts/install.sh -s fe-mr-review-html
```

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
