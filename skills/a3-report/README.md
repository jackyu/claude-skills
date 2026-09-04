# A3 Report

> 給主管的週報與 A3 提案：把散亂素材整理成一頁看得懂、能拍板的文件

## Purpose

工程師兼 PM 每週要跟主管報「做了什麼」加「需要你決定什麼」。素材散在手打筆記、PM issue、GitLab 的 MR 與 issue 裡，整理起來費時，而且常常寫成流水帳，主管讀完還是不知道要簽什麼。

這支 skill 收攏三個來源，產出兩種文件。靈感來自豐田的 A3 報告：一頁八格，左半抓問題、右半解問題。

## When to Use

- 要寫週報、跟主管報這週進度
- 有事情需要主管拍板、簽核、下決定
- 要寫提案說服主管做一件事：清技術債、導入工具、投資重構
- 提到 A3、一頁報告
- 要把報告做成簡報或網頁交出去

**不要用在**：MR 的程式碼審查（用 `fe-mr-review`）、從 MR 萃取學習筆記（用 `fe-mr-digest`）、把 PM 需求拆成開發任務（用 `fe-issue`）。

## 兩種模式

| 模式 | 場合 | 骨架 |
|---|---|---|
| `weekly` | 每週進度同步 | 進度／風險與 blocker／需要拍板的事／下週 |
| `proposal` | 推動一件還沒開始的事 | 完整八格 A3 |

`weekly` 的每個拍板事項用縮小版 A3：問題→現況→方案比較→建議→要主管決定什麼。八格不當週報骨架，週報是進度同步，硬套八格會變成填表格。

## 三個素材來源

| 來源 | 怎麼拿 |
|---|---|
| 手打筆記 | 使用者貼進對話或給檔案路徑 |
| PM issue | `_shared/fe-mr-common/scripts/issue-get.sh`，失敗就請使用者貼 |
| GitLab 本期活動 | `scripts/gitlab-activity.sh`：本期合併的 MR、關閉的 issue、進行中的 issue |

三者匯成一份事實清單，每條標來源（`[筆記]`／`[issue #N]`／`[MR !N]`）。清單裡沒有的事不准寫進報告。

## 三種輸出格式

| 格式 | 產出 |
|---|---|
| `md`（預設） | 直接輸出到對話 |
| `ppt` | `.claude/tmp/a3-report-<slug>.pptx`，走 `document-skills:pptx` |
| `html` | `.claude/tmp/a3-report-<slug>.html`，套 `assets/a3-onepage.html`，A3 橫向可列印 |

## 參數

參數沒有獨立入口，一律從使用者訊息偵測（`--flag`、`key=value` 或中文口語都認）：

| 參數 | 值 | 預設 |
|---|---|---|
| `--mode` | `weekly`／`proposal` | 依訊號判斷，判不出來就問 |
| `--format` | `md`／`ppt`／`html` | `md` |
| `--since` / `--until` | `YYYY-MM-DD` | 本週一至今日，`--until` 含當日 |
| `--project` | `a/b` 或 `a/b,c/d` | 從 `git remote get-url origin` 推算 |

## 依賴

| 依賴 | 用途 |
|---|---|
| `~/.claude/scripts/gitlab/_config.sh` | GitLab token 與 API helper，`gitlab-activity.sh` 會 source |
| `jq` | 解析 GitLab API 回應 |
| `curl` | 打 GitLab API |
| `document-skills:pptx` | `--format ppt` 時產投影片；被拒絕呼叫時退回 pptxgenjs |

GitLab token 從 `~/.claude/scripts/gitlab/.env` 或 `~/.claude.json` 讀。

## Contents

| File | Description | 對應步驟 |
|---|---|---|
| `SKILL.md` | 主流程 Step 0–7 | 全部 |
| `references/source-collection.md` | 三來源蒐集、事實清單格式、期間計算、腳本失敗 fallback | Step 3 |
| `references/a3-grid.md` | 八格定義、數字硬規則、信心標記、八格縮成五項的對應 | Step 4 |
| `references/checklist.md` | 八點自檢、各模式套哪幾點、閘門表格式、⚠️ 處置 | Step 5 |
| `references/output-formats.md` | md／ppt／html 分流細節 | Step 6 |
| `assets/weekly-template.md` | 週報模板 | Step 4 |
| `assets/decision-item-template.md` | 拍板事項模板（縮小版 A3） | Step 4 |
| `assets/proposal-a3-template.md` | 完整八格 A3 模板 | Step 4 |
| `assets/a3-onepage.html` | HTML 外殼，A3 橫向、樣式全 inline | Step 6 |
| `scripts/gitlab-activity.sh` | 抓本期合併的 MR、關閉的 issue、進行中的 issue | Step 3 |

## 跟其他 skill 的分工

| Skill | 它回答的問題 | 差在哪 |
|---|---|---|
| `fe-mr-review` | 這個 MR 能不能合 | 對象是程式碼，讀者是工程師 |
| `fe-mr-digest` | 這個 MR 有什麼值得學 | 產出是學習筆記，不做決定 |
| `fe-issue` | 這個需求怎麼拆成開發任務 | 產出往下給開發，不往上給主管 |
| `retro` | 這次 session 有什麼可以改進 | 對象是工作流程，不是專案進度 |
| `a3-report` | 主管要簽什麼、憑什麼簽 | 唯一一支產出「給主管做決定」的文件 |

事實清單約束借自 `retro`，信心三級借自 `fe-mr-walkthrough`，HTML 規則借自 `fe-show-me`。

## 安全邊界

- **不腦補。** 事實清單沒有的數字不准寫。缺的一律標 `🔴 待確認：<缺什麼>，去哪拿：<…>`，「去哪拿」不准留空。
- **不偽造引用。** 不寫「PM 說」「主管說」，除非素材裡有原文。
- **HTML 不放個資。** 專案進度、MR 編號照實寫，但不放客戶姓名、帳號、金額明細、API 原始回應。
- **不主動開檔。** 產出後印路徑，不執行 `open`。
- **自檢閘門不准略過。** 表格固定放輸出末尾，⚠️ 要指向對應的待確認項。

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
