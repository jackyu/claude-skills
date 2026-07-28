# retro

Session 結束前的回顧：從這次 session 挖出可改進的地方，分成四類提案（改 skill 提示詞／加 hook／建 rule／寫 memory），**只提案不動手**，逐項核可後才執行。

## 用途

補上開發生命週期的最後一環——讓每次 session 的教訓真的留下來，而不是下次再踩一遍：

```
/start  →  開發  →  /push  →  finish  →  retro
建 worktree      開 MR    收尾清理    沉澱改進
```

`finish` 收完尾之後會**自動接著跑 retro，不會問你要不要跑**。retro 只產出提案，收尾結果不受它影響；不想採納就一項都不勾。

它**不做**的事：不自己改設定、不自己寫 memory、不在你沒點頭前碰任何檔案。

## 觸發詞

回顧這次 session、檢討一下、這次有什麼可以改進、沉澱教訓、強化 memory、這次做完了幫我檢討、session 總結。

## 流程摘要

| Step | 做什麼 |
|---|---|
| 1 | 界定素材：只用當前 session 的對話 context，列出做了什麼、動了哪些檔、觸發哪些 skill／hook、派了哪些 agent |
| 2 | 掃五類訊號：錯誤與修復／使用者糾正／繞路返工／重複提醒／機制缺口；每個訊號記發生什麼、根因、有無機制可預防 |
| 3 | 四路分診：(A) skill 提示詞 (B) hook (C) rule (D) memory 或學習筆記。(A)(B)(C) 動手前先做**存在性檢查**——已有機制涵蓋卻仍出事，只能提「強化既有機制」，不得提新建 |
| 4 | 產出提案報告，每項七欄（訊號＋證據、類別、落點、草稿、效益、風險、下游工具）；「不提案」區**分兩種**（純一次性意外／既有機制已涵蓋，後者附出處路徑）；**此步結束前零寫入** |
| 5 | AskUserQuestion 逐項勾選，核可哪項做哪項；動 `~/.claude/` 前先備份，執行後 read-back 驗證 |

分診 (D) 的落點分兩層：**前五類**（使用者偏好、環境陷阱、每 session 都會踩的事、派工與驗證模式、只跟單一 repo 有關的）直接引用 `~/.claude/playbooks/maintenance.md` 第二節的路由表，不在 skill 內另寫一份，避免兩邊規範打架；**`learned/` 跨 session 技術教訓**則不在該表內，是本 skill 的補充路由，格式也由本 skill 自訂（該目錄既有筆記格式不統一，不比照現況、不回溯修改）。

## 安全邊界

| 行為 | 預設 |
|---|---|
| 寫入任何檔案（含 memory） | ⛔ 未經逐項核可一律不寫；Step 4 結束前零寫入 |
| 沒有訊號時 | 明說沒有，**不硬湊提案** |
| 一項提案的範圍 | 一個焦點；不把 rule 與 hook 混在同一項 |
| 動 `~/.claude/` 下的檔案 | 先備份到 `~/.claude/backups/<用途>-<YYYYMMDD>/` |
| hook／`settings.json` 改動 | 透過 update-config skill 落地，並照 maintenance.md 第一節流程 |
| 使用者沒勾的提案 | ⛔ 不執行，也不順手多做 |
| 提案依據 | 必須有 session 內證據；沒證據的想像不列為提案 |

## 安裝方式

```bash
./scripts/install.sh -s retro
```

## 檔案結構

```
retro/
├── SKILL.md    # Agent 指令（Step 1–5 流程 + 紅線）
└── README.md   # 本檔案
```
