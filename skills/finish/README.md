# finish

開發分支的收尾流程：判斷分支是否已合併，提供對應選項（開 MR／保留／丟棄／清理），執行後驗證清理結果。

## 用途

補上開發流程最後一段沒人管的空白：

```
/start      →  開發  →  /push  →  (GitLab 上 review、merge)  →  finish       →  retro
建 worktree                開 MR                              清 worktree      沉澱改進
＋拆票                                                        與分支、歸檔票目錄
```

`/start` 建 worktree 開工、`/push` 跑品質閘並開 MR，但 MR 合併後的 worktree 移除、本地分支刪除、以及決定要不要丟棄未推的工作，過去都靠手動。這支 skill 負責的就是這一段，收完尾再自動接 `retro` 做回顧。

它**不做**本地 merge 回主線——合併一律走 GitLab MR 流程。

## 觸發詞

做完了、這個分支搞定了、幫我收一下、分支開發完成、清理 worktree、MR 合併了要收尾、丟棄這個分支的工作。

## 流程摘要

| Step | 做什麼 |
|---|---|
| 1 | 前置檢查：有未 commit 變更或身在 `main`／`rc/*` 就中止並詢問；偵測是否位於 worktree 並記下路徑 |
| 2 | 確認基底分支（推不出來就問，不假設 main），`git fetch --prune` 後判斷已合併或未合併；沒推過的分支直接算未合併，不查遠端 |
| 3 | 依情境呈現菜單，逐字照列、等使用者回答 |
| 4 | 執行選擇：委派 `/push`／保留／丟棄（需 `discard`）／清理已合併分支；走清理的情境順帶把 `/start` 拆的票目錄歸檔到 `.claude/tickets/archive/` |
| 5 | worktree 清理，只限指定路徑範圍 |
| 6 | 跑 `git worktree list`、`git branch --list` 為證，再回報完成 |
| 7 | 收尾完成後直接執行 `retro` 做 session 回顧，不詢問；中止收場（Step 1／2）則不跑 |

菜單內容：

- **未合併**：1 推送並建立 MR、2 保留現狀、3 丟棄此分支
- **已合併**：1 清理（移除 worktree + 刪本地分支 + prune）、2 保留現狀

## 安全邊界

| 行為 | 預設 |
|---|---|
| 丟棄分支 | ⛔ 使用者必須親自輸入 `discard`；「刪掉吧」「不要了」一律不算 |
| worktree 清理範圍 | 僅 `.claude/worktrees/`、`.worktrees/`、`worktrees/` 之下；其他路徑保留原位並告知 |
| 票目錄（`.claude/tickets/<分支>/`） | 只在 A3 丟棄與 B1 清理時移到 `.claude/tickets/archive/` 留痕，不刪除；A1／A2／B2 不動它 |
| 有未 commit 變更 | ⛔ 中止並詢問，不代為 commit 或 stash |
| 位於 `main`／`master`／`rc/*` | ⛔ 中止（與上一項同時成立時，先報這項） |
| 遠端連不上（`fetch` 失敗、`ls-remote` 回非 0 非 2） | ⛔ 停下回報連線問題，不猜測合併狀態 |
| 品質閘（lint／type-check／test） | 由 `/push` 負責，本 skill 不重跑、也不繞過 |
| force-push | ⛔ 絕不執行 |
| `git worktree remove --force` | ⛔ 不用，移除失敗就回報實際錯誤 |
| 已合併分支用 `git branch -D` | ⛔ 先用 `-d`；被拒時附證據詢問，不自行升級 |

`-d` 被拒不等於沒合併：`-d` 比對的是分支 upstream，沒有就拿主 repo 的本地基底比，而本地基底常態落後於 `origin`，所以真的合併了也可能被擋。

## 安裝方式

```bash
./scripts/install.sh -s finish
```

## 檔案結構

```
finish/
├── SKILL.md    # Agent 指令（Step 1–7 流程 + 紅線）
└── README.md   # 本檔案
```
