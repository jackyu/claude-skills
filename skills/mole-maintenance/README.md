# mole-maintenance

用 [Mole](https://github.com/tw93/Mole)（命令 `mo`）對 macOS 做安裝與**非破壞性**維護檢查的 Claude Code skill。Mole 是 tw93 的終端機系統維護 CLI，號稱把 CleanMyMac、AppCleaner、DaisyDisk、iStat Menus 整合進單一 binary。

## 用途

- 偵測這台 Mac 是否已安裝 `mo`，未安裝則自動安裝（Homebrew 優先）。
- 已安裝則跑健康檢查、磁碟用量分析、清理**預覽**，產出繁體中文報告。

## 觸發詞

Mole、mo、mac 清理 / 清快取 / 清垃圾、磁碟分析、磁碟空間被什麼佔用、系統健康狀態、維護這台 Mac、釋放空間。

## 用法

直接呼叫 skill 即可。預設行為：

1. 跑 `scripts/mole-setup.sh` 偵測 / 安裝。
2. 已安裝 → 跑 `mo --version`、`mo status --json`、`mo analyze --json ~`、`mo clean --dry-run --debug`（**只預覽不刪**）。
3. 輸出繁體中文系統狀態與建議報告。

**要真正清除**：呼叫時明確說「執行清除 / apply / 真的刪」，才會跑 `mo clean`。

## 安全邊界

| 行為 | 預設 |
|---|---|
| `mo clean` 真實刪除 | ❌ 預設只 `--dry-run`，需明確指示 |
| sudo / Touch ID / 授權互動 | ⛔ 偵測到即停止回報 |
| `uninstall` / `optimize` / `purge` / `installer` / `remove` / `touchid` | ⛔ 不在範圍，不執行 |
| `curl … install.sh \| bash` | 不自動執行，只印出指令請使用者確認 |

## 安裝方式（本 repo）

```bash
# symlink 部署到 ~/.claude/skills/
./scripts/install.sh -s mole-maintenance
```

## 檔案結構

```
mole-maintenance/
├── SKILL.md              # Agent 指令（流程 + 安全邊界）
├── README.md             # 本檔案
└── scripts/
    └── mole-setup.sh     # 偵測 + brew 安裝 helper（純偵測/安裝，無刪除邏輯）
```

## Mole 指令對照（參考）

| 指令 | 用途 | 破壞性 | 本 skill |
|---|---|---|---|
| `mo status` | 系統健康儀表板 | 否 | ✅ 跑 |
| `mo analyze ~` | 磁碟用量分析 | 否（互動模式移垃圾桶；`--json` 純輸出） | ✅ 跑 `--json` |
| `mo clean` | 清快取/log/孤兒資料 | 是 | ✅ 預設 `--dry-run`；真刪需明確指示 |
| `mo uninstall` / `optimize` / `purge` / `installer` / `remove` / `touchid` | 移除 App / 優化 / 清建置產物 / 移除安裝檔 / 解除 Mole / Touch ID | 多為是 | ⛔ 不在範圍 |
| `mo completion` | shell 自動補全 | 否 | 留給使用者自行決定 |

官方 repo：https://github.com/tw93/Mole
