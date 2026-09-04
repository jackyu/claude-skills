# 輸出格式分流

三種格式共用同一份最終 markdown。先把內容寫定、跑完自檢閘門，再轉格式。**轉格式階段不准新增或改寫內容**，只做版面搬運。

## md（預設）

直接輸出到對話，不寫檔。閘門表放最末尾。

## ppt

### 主路徑：呼叫 pptx skill

用 `Skill` tool 呼叫 `document-skills:pptx`，把三樣東西一起傳進去：

1. 最終 markdown 全文。
2. 投影片對應表（見下）。
3. 約束條款（見下）。

**weekly 的投影片對應：**

| 頁 | 內容 |
|---|---|
| 1 | 封面：標題、期間、專案、受眾、一句話總結 |
| 2 | 進度 |
| 3 | 風險與 blocker |
| 4…n | 每個拍板事項一頁 |
| n+1 | 下週 |
| n+2 | 附錄 |
| 末頁 | 自檢閘門表 |

**proposal 的投影片對應：**

| 頁 | 內容 |
|---|---|
| 1 | 一頁八格，用 `LAYOUT_WIDE`，2 欄 × 4 列 |
| 2 | 附錄 |
| 3 | 自檢閘門表 |

**約束（逐字傳給 pptx skill）：**

- 「待確認」項目用醒目色（紅字或紅底），一眼看得到。
- 不要新增投影片沒有的內容，也不要改寫措辭。
- 內容放不下就縮短條列、移到附錄頁，不准縮字級硬塞。
- 產出後跑 pptx skill 附的 `validate.py`，通過才回報。

輸出路徑：`.claude/tmp/a3-report-<slug>.pptx`。`<slug>` 用專案名加期間，例如 `shop-web-2026-w36`。

### 備援：pptx skill 拒絕被程式呼叫

`Skill` tool 回 `disable-model-invocation` 錯誤時（`../fe-code-review/SKILL.md` 的工具清單一節記錄過同類問題），不要重試。改成直接照 `~/.claude/plugins/marketplaces/anthropic-agent-skills/skills/pptx/SKILL.md` 的做法，用 pptxgenjs 自己產，投影片對應與約束照上表。

找不到那份 SKILL.md 就停下來，請使用者確認 pptx skill 的位置，不要自己亂猜路徑。

不論走 `document-skills:pptx` 還是 fallback，先跑 `node -e "require('pptxgenjs')"`。失敗就在 scratchpad 建臨時目錄 `npm install pptxgenjs` 再產，**不要裝進使用者專案**，產完把臨時 node_modules 刪掉。

## html

套 `assets/a3-onepage.html` 當外殼，把最終 markdown 的內容填進去。

兩種模式共用同一個外殼檔（A3 橫向、print CSS、樣式全 inline）。`proposal` 用它原本的 2 欄 × 4 格；`weekly` 把 `.a3-grid` 改成單欄、依序放進進度、風險與 blocker、需要拍板的事、下週四個 `.cell`，`.header` 與 `.checklist` 不動，不使用 `.decision-banner`。`a3-onepage.html` `<body>` 開頭的註解寫的是同一套對應，不要另建第二個 HTML 檔。

遵守 `../fe-show-me/SKILL.md` 的 HTML 規則第 2、3、4 條：

- **self-contained**：CSS 全部 inline 或 `<style>` 內嵌，禁止任何外部 CDN，不發外部請求。
- **路徑固定** `.claude/tmp/a3-report-<slug>.html`。動手前檢查專案 `.gitignore` 有沒有 `.claude/tmp/`，沒有就補一行。絕不寫進 `src/`、`app/` 這些原始碼路徑。
- **不主動執行 `open`**，產出後印絕對路徑讓使用者自己開。

**規則 1「一律假資料」在這裡縮限：** 週報本來就是報真實進度，MR 編號、issue 標題、完成票數照實寫。但不准放客戶個資、帳號密碼、金額明細、API 原始回應內容。要示範資料形狀就編一組明顯是假的。

cwd 不是 git repo 時沒有 `.claude/tmp/` 可落，改落 scratchpad 目錄，並在收尾時告訴使用者檔案在哪、為什麼不在專案裡。
