#!/usr/bin/env bash
set -euo pipefail

# mole-setup.sh — 偵測 Mole (mo) 是否安裝，未安裝則用 Homebrew 安裝。
# ponytail: 純偵測 + brew 安裝，無任何刪除邏輯；curl|bash fallback 只「印出」不自動執行。
#
# Exit codes:
#   0  mo 已安裝（或本次 brew 安裝成功）
#   2  未安裝且無法自動安裝 — 需使用者手動確認 install.sh
#   3  偵測到需要 sudo / 互動授權 — 已停止，等使用者處理

INSTALL_SH_CMD='curl -fsSL https://raw.githubusercontent.com/tw93/mole/main/install.sh | bash'

if command -v mo >/dev/null 2>&1; then
  echo "STATUS=installed"
  echo "PATH=$(command -v mo)"
  # 版本字串可能含換行，壓成單行
  echo "VERSION=$(mo --version 2>/dev/null | head -1)"
  exit 0
fi

echo "STATUS=missing"

if ! command -v brew >/dev/null 2>&1; then
  echo "BREW=absent"
  echo "ACTION=manual_confirm_required"
  echo "請使用者確認後手動執行（未驗證腳本，故不自動代跑）："
  echo "  $INSTALL_SH_CMD"
  exit 2
fi

echo "BREW=present"
echo "INSTALLING=brew install mole"
# brew install 一般不需 sudo；若失敗則回退到手動 install.sh 提示。
if brew install mole; then
  if command -v mo >/dev/null 2>&1; then
    echo "STATUS=installed"
    echo "VERSION=$(mo --version 2>/dev/null | head -1)"
    exit 0
  fi
  echo "ACTION=installed_but_not_on_path"
  echo "brew 回報成功但 PATH 找不到 mo，請檢查 brew 環境。"
  exit 2
fi

echo "ACTION=manual_confirm_required"
echo "brew install mole 失敗。請使用者確認後手動執行 install.sh（支援較舊 macOS）："
echo "  $INSTALL_SH_CMD"
exit 2
