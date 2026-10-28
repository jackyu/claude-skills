# mission-band

Claude Code 的 mod：在輸入框上方顯示開發任務走到哪一步（開始 → 實作 → 驗收 → 審查 → 收尾），並提醒下一步。進度從實際發生的事推算（打過的指令、讀過的檔案、git／glab 查詢），不靠 AI 自己回報。

怎麼用見 [docs/guide.html](docs/guide.html)（裝好後在 band 按 `h`，或打 `/mission-help` 開啟）。這份 README 只講安裝、升級、移除和開發。

## 前置條件

| 需要什麼 | 用在哪 | 沒有會怎樣 |
|---|---|---|
| Claude Code 2.1.310 以上（以這版實測） | mod 引擎 | 舊版可能缺 API，mod 載入失敗 |
| [mattpocock-skills](https://github.com/mattpocock/skills)，並在專案跑過 `/setup-matt-pocock-skills` | 開始、實作階段的 grill、to-spec、tdd 等步驟；`/mission-start` 會檢查專案 `CLAUDE.md` 有 `## Agent skills`、`docs/agents/issue-tracker.md` 存在 | `/mission-start` 列出缺項，不建任務 |
| pstack，並跑過 `/setup-pstack` | no-comments、blast-radius、interrogate 節點；`/mission-start` 會檢查 `~/.claude/rules/pstack-models.md` | 同上 |
| 本 repo 的 skill：`approach`、`to-acceptance`、`verify-acceptance`、`mr-reading-map`、`cleanup`（`./scripts/install.sh` 安裝） | 對應的流程節點；驗收清單格式定義在 `skills/_shared/acceptance/format.md` | 節點的提示指令打不出來 |
| `orca` CLI | `/mission-go` 在 worktree 開新的 Claude 分頁 | `/mission-go` 失敗，要自己開 Claude 再打 `/mission-restore` |
| `glab`（已登入 GitLab） | `/mission-review` 同步 MR 狀態、偵測 MR | 審查階段的節點不會更新 |
| `python3` | `/mission-cost` 解析 transcript 算 token 用量 | 量不到用量，`/mission-finish` 照常完成 |

流程目前寫死給 GitLab＋前端 repo 用（`flows/new-feature.ts`），換專案類型要改這份流程定義。

## 安裝

1. 複製到 mods 目錄（排除引擎產生的型別）：

   ```bash
   rsync -a --delete --exclude node_modules --exclude .claude-plugin/types \
     mods/mission-band/ ~/.claude/mods/mission-band/
   ```

2. 把路徑加進 `~/.claude/settings.json` 的 `env.CLAUDE_CODE_PLUGIN_DIRS`（冒號分隔，跟其他 mod 並列）：

   ```json
   { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/<你>/.claude/mods/mission-band/" } }
   ```

   只放進 `~/.claude/mods/` 不會載入，一定要列進這個變數。

3. 開一個新的 Claude Code session。mod 只在 session 啟動時載入，已開著的 session 看不到改動。

4. 確認：在專案的主 checkout 打 `/mission-start`，band 出現在輸入框上方就是裝好了。

## 升級

改完 repo 裡的檔案，重跑安裝第 1 步的 rsync，再開新 session。任務資料存在 Claude Code 的跨 session store，升級不會清掉進行中的任務。

## 移除

從 `CLAUDE_CODE_PLUGIN_DIRS` 拿掉這個路徑，刪掉 `~/.claude/mods/mission-band/`，開新 session。

## 開發

原始碼以本目錄為準；`~/.claude/mods/mission-band/` 只是安裝出去的副本，不要直接改那份。

```bash
cd mods/mission-band
claude plugin test .        # 單元與 hook 測試
claude plugin validate .    # 引擎會拒絕的寫法
tsc -p .                    # 型別檢查；要先載入過一次 mod，.claude-plugin/types/ 才會產生
```

- `.claude-plugin/types/` 是引擎產生的型別，不進版控
- 改流程或指令時，同步改 `docs/guide.html`
- `hooks/register.tsx` 已接近 400 行上限，新邏輯放別的檔
