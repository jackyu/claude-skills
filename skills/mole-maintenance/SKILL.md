---
name: mole-maintenance
description: 安裝並用 Mole (mo) 做 macOS 系統維護 — 先偵測是否安裝，未安裝則自動安裝，已安裝則執行健康檢查、磁碟分析與清理「預覽」。使用時機：(1) 用戶提到 Mole、mo、mac 清理、清快取、清垃圾, (2) 用戶要看磁碟空間被什麼佔用、做磁碟分析, (3) 用戶要看系統健康狀態 / status, (4) 用戶要維護這台 Mac、釋放空間。即使只是說「幫我清一下 Mac」也應觸發。
---

# mole-maintenance

用 [Mole](https://github.com/tw93/Mole)（命令 `mo`）對這台 macOS 做安裝與**非破壞性**維護檢查。清理預設**只預覽**，需使用者明確指示才真正刪除。

## 安全邊界（硬性）

- 預設**不刪檔**。`mo clean` 只在使用者明確說「執行清除 / 真的刪 / apply」時才跑真實版。
- 遇到 **sudo / Touch ID / 任何授權互動 / 不確定操作 → 立刻停止並回報**，不自行繼續。
- 不在本 skill 範圍、**不要執行**：`mo uninstall`、`mo optimize`、`mo purge`、`mo installer`、`mo remove`、`mo touchid`。
- 不自動跑 `curl ... | bash`（未驗證腳本）；只在 brew 不可行時，**印出**指令請使用者自行確認。

## 流程

### 1. 偵測 + 安裝
執行（路徑相對本 skill 目錄）：
```bash
bash scripts/mole-setup.sh
```
依輸出的 `STATUS=` 判斷：
- `installed` → 跳到步驟 2。
- `missing` 且腳本已成功 `brew install mole` → 視為已安裝，進步驟 2。
- `ACTION=manual_confirm_required`（brew 缺失或安裝失敗）→ **停下來**，把腳本印出的 `install.sh` 指令交給使用者確認，不自動執行。

### 2. 非破壞性檢查（已安裝才跑）
依序執行並彙整輸出：
```bash
mo --version
mo status --json
mo analyze --json ~
mo clean --dry-run --debug
```
- `status` — 系統健康儀表板（唯讀）。
- `analyze --json ~` — 家目錄磁碟用量分析（唯讀；掃描大目錄可能較久）。
- `clean --dry-run --debug` — 清理**預覽**，列出會清什麼但不刪。

### 3. 真正清除（僅在明確要求時）
只有使用者本次明確要求「執行清除 / apply / 真的刪」才執行：
```bash
mo clean
```
若 `mo clean` 要求 sudo → **停止並回報**，讓使用者決定。其餘破壞性子命令一律不碰。

### 4. 報告（繁體中文）
彙整輸出一份報告：系統狀態重點、磁碟空間主要來源（前幾大目錄/類別）、最值得優先處理的項目、`clean --dry-run` 預覽可釋放的空間、下一步最安全建議、風險與注意事項。

## 參考

- 指令對照與安全模型見本 skill 的 `README.md`。
- 官方 repo：https://github.com/tw93/Mole
