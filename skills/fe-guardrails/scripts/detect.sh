#!/usr/bin/env bash
#
# detect.sh -- 純唯讀掃描：偵測前端專案有沒有裝「程式碼品質護欄」設定
#
# 用法：
#   detect.sh [專案路徑]     # 省略則用 cwd
#
# 旗標：
#   --json      只輸出機器可讀 JSON，不印表格
#   -h, --help  印使用說明
#
# 這支腳本不寫入、不修改、不刪除任何檔案，也不跑 npm install。
# 相容 macOS 內建的 bash 3.2：不用 associative array、不用 ${var,,}，
# 也不用 set -e（偵測腳本大量使用會失敗的探測指令，中途死掉沒意義）。
#
# JSON 解析一律丟給 node -e，不依賴 jq。

# ─── 說明文字 ────────────────────────────────────────────────────────────────

print_help() {
  cat <<'EOF'
用法：detect.sh [專案路徑] [--json] [-h|--help]

掃描指定的前端專案（省略路徑則用目前目錄），檢查以下七大項有沒有設定：
  1. ESLint complexity / max-lines-per-function / max-depth / max-lines
  2. 重複程式碼偵測（jscpd）
  3. pre-commit hook（husky / simple-git-hooks / git hooksPath）
  4. lint-staged
  5. 測試 coverage 門檻（vitest / jest）
  6. TypeScript strict / noUncheckedIndexedAccess

純唯讀，不會修改、刪除任何檔案，也不會跑 npm install。

選項：
  --json      只印機器可讀 JSON，不印表格
  -h, --help  印這段說明
EOF
}

# ─── 參數解析 ────────────────────────────────────────────────────────────────

PROJECT_DIR_ARG="."
JSON_MODE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --json)
      JSON_MODE=true
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      PROJECT_DIR_ARG="$1"
      shift
      ;;
  esac
done

if [ ! -d "$PROJECT_DIR_ARG" ]; then
  echo "錯誤：路徑不存在：$PROJECT_DIR_ARG" >&2
  exit 1
fi
PROJECT_DIR="$(cd "$PROJECT_DIR_ARG" && pwd)"

# ─── 暫存檔清理（讀 eslint --print-config 輸出用，不落地在專案內） ──────────

ESLINT_CFG_TMP=""
cleanup() {
  if [ -n "$ESLINT_CFG_TMP" ] && [ -f "$ESLINT_CFG_TMP" ]; then
    rm -f "$ESLINT_CFG_TMP"
  fi
}
trap cleanup EXIT

# ─── 不是 Node 專案就早退 ────────────────────────────────────────────────────

PKG_JSON="$PROJECT_DIR/package.json"

if [ ! -f "$PKG_JSON" ]; then
  if $JSON_MODE; then
    PROJECT_PATH="$PROJECT_DIR" node -e '
      console.log(JSON.stringify({
        projectPath: process.env.PROJECT_PATH,
        isNodeProject: false
      }, null, 2));
    '
  else
    echo "專案：$PROJECT_DIR"
    echo "不是 Node.js 專案（找不到 package.json），略過偵測。"
  fi
  exit 0
fi

# ─── package.json 查詢 helper（一律用 node -e，不用 jq） ────────────────────

# 依賴（含 dependencies/devDependencies/peerDependencies/optionalDependencies）裡有沒有這個套件
has_dep() {
  DEP_NAME="$1" PKG_PATH="$PKG_JSON" node -e '
    const fs = require("fs");
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(process.env.PKG_PATH, "utf8"));
    } catch (e) {
      process.exit(1);
    }
    const deps = Object.assign(
      {},
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies
    );
    process.exit(Object.prototype.hasOwnProperty.call(deps, process.env.DEP_NAME) ? 0 : 1);
  ' 2>/dev/null
}

# 依賴裡有沒有 jscpd 或任何 @jscpd/* scoped 套件
has_jscpd_dep() {
  PKG_PATH="$PKG_JSON" node -e '
    const fs = require("fs");
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(process.env.PKG_PATH, "utf8"));
    } catch (e) {
      process.exit(1);
    }
    const deps = Object.assign(
      {},
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies
    );
    const found = Object.keys(deps).some((k) => k === "jscpd" || k.indexOf("@jscpd/") === 0);
    process.exit(found ? 0 : 1);
  ' 2>/dev/null
}

# package.json 頂層有沒有這個欄位（如 eslintConfig、lint-staged、simple-git-hooks）
has_pkg_field() {
  FIELD_NAME="$1" PKG_PATH="$PKG_JSON" node -e '
    const fs = require("fs");
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(process.env.PKG_PATH, "utf8"));
    } catch (e) {
      process.exit(1);
    }
    process.exit(Object.prototype.hasOwnProperty.call(pkg, process.env.FIELD_NAME) ? 0 : 1);
  ' 2>/dev/null
}

# ─── 環境資訊：框架、測試框架 ────────────────────────────────────────────────

FRAMEWORK="未知"
if has_dep "next"; then
  FRAMEWORK="Next.js"
elif has_dep "vite"; then
  FRAMEWORK="Vite"
elif has_dep "react-scripts"; then
  FRAMEWORK="CRA"
fi

TEST_FRAMEWORK="無"
if has_dep "vitest"; then
  TEST_FRAMEWORK="vitest"
elif has_dep "jest"; then
  TEST_FRAMEWORK="jest"
fi

# ─── 1. ESLint config 格式 ───────────────────────────────────────────────────

ESLINT_FLAT_FOUND=false
ESLINT_FLAT_FILE=""
for f in eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts eslint.config.mts eslint.config.cts; do
  if [ -f "$PROJECT_DIR/$f" ]; then
    ESLINT_FLAT_FOUND=true
    ESLINT_FLAT_FILE="$f"
    break
  fi
done

ESLINT_RC_FOUND=false
ESLINT_RC_FILE=""
for f in .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml; do
  if [ -f "$PROJECT_DIR/$f" ]; then
    ESLINT_RC_FOUND=true
    ESLINT_RC_FILE="$f"
    break
  fi
done
if ! $ESLINT_RC_FOUND && has_pkg_field "eslintConfig"; then
  ESLINT_RC_FOUND=true
  ESLINT_RC_FILE="package.json"
fi

if $ESLINT_FLAT_FOUND && $ESLINT_RC_FOUND; then
  ESLINT_FORMAT="both"
elif $ESLINT_FLAT_FOUND; then
  ESLINT_FORMAT="flat"
elif $ESLINT_RC_FOUND; then
  ESLINT_FORMAT="eslintrc"
else
  ESLINT_FORMAT="none"
fi

# ─── 2. 四條規則：complexity / max-lines-per-function / max-depth / max-lines ─
#
# 兩段式偵測：
#   優先：node_modules/.bin/eslint 存在時，用 --print-config 拿 resolved config
#   fallback：grep config 檔內容，只能做淺層偵測，會漏掉 import 進來的規則

find_target_file() {
  # 依序找一個專案裡真實存在的檔給 --print-config 用，找不到就回空字串
  local f
  f=$(find "$PROJECT_DIR/src" -type f -name "*.ts" 2>/dev/null | head -n 1)
  if [ -n "$f" ]; then
    echo "$f"
    return 0
  fi
  f=$(find "$PROJECT_DIR/app" -type f -name "*.tsx" 2>/dev/null | head -n 1)
  if [ -n "$f" ]; then
    echo "$f"
    return 0
  fi
  f=$(find "$PROJECT_DIR" -maxdepth 1 -type f -name "*.config.*" 2>/dev/null | head -n 1)
  if [ -n "$f" ]; then
    echo "$f"
    return 0
  fi
  return 1
}

RULE_METHOD="grep-fallback"

if [ -x "$PROJECT_DIR/node_modules/.bin/eslint" ]; then
  TARGET_FILE="$(find_target_file)"
  if [ -n "$TARGET_FILE" ]; then
    ESLINT_CFG_TMP="$(mktemp)"
    if (cd "$PROJECT_DIR" && npx --no-install eslint --print-config "$TARGET_FILE" >"$ESLINT_CFG_TMP" 2>/dev/null); then
      if [ -s "$ESLINT_CFG_TMP" ]; then
        RULE_METHOD="print-config"
      fi
    fi
  fi
fi

export ESLINT_CFG_FILE="$ESLINT_CFG_TMP"

# grep-fallback 要掃的檔案清單（flat + rc，兩者都存在就都掃）
ESLINT_GREP_TARGETS=""
if $ESLINT_FLAT_FOUND; then
  ESLINT_GREP_TARGETS="$ESLINT_GREP_TARGETS $PROJECT_DIR/$ESLINT_FLAT_FILE"
fi
if $ESLINT_RC_FOUND; then
  if [ "$ESLINT_RC_FILE" = "package.json" ]; then
    ESLINT_GREP_TARGETS="$ESLINT_GREP_TARGETS $PKG_JSON"
  else
    ESLINT_GREP_TARGETS="$ESLINT_GREP_TARGETS $PROJECT_DIR/$ESLINT_RC_FILE"
  fi
fi

# 回傳 on / off
check_rule() {
  local rule_name="$1"
  if [ "$RULE_METHOD" = "print-config" ]; then
    RULE_NAME="$rule_name" node -e '
      const fs = require("fs");
      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(process.env.ESLINT_CFG_FILE, "utf8"));
      } catch (e) {
        console.log("off");
        process.exit(0);
      }
      const rule = cfg.rules ? cfg.rules[process.env.RULE_NAME] : undefined;
      if (rule === undefined || rule === null) {
        console.log("off");
        process.exit(0);
      }
      const sev = Array.isArray(rule) ? rule[0] : rule;
      if (sev === 0 || sev === "off") {
        console.log("off");
      } else {
        console.log("on");
      }
    ' 2>/dev/null
  else
    local found=false
    local target
    for target in $ESLINT_GREP_TARGETS; do
      if [ -f "$target" ] && grep -Eq "[\"'\`]?${rule_name}[\"'\`]?[[:space:]]*:" "$target" 2>/dev/null; then
        found=true
      fi
    done
    if $found; then
      echo "on"
    else
      echo "off"
    fi
  fi
}

build_rule_status_and_note() {
  # $1 = on/off, $2 = 建議文字 -> 用全域變數 R_STATUS / R_NOTE 回傳
  local on_off="$1"
  local suggestion="$2"
  local note=""
  if [ "$on_off" = "on" ]; then
    R_STATUS="已有"
  else
    R_STATUS="缺"
    note="$suggestion"
  fi
  if [ "$RULE_METHOD" = "grep-fallback" ]; then
    if [ -n "$note" ]; then
      note="${note}；淺層偵測，可能不準"
    else
      note="淺層偵測，可能不準"
    fi
  fi
  R_NOTE="$note"
}

RESULT_COMPLEXITY="$(check_rule "complexity")"
build_rule_status_and_note "$RESULT_COMPLEXITY" "建議 complexity: 15"
STATUS_COMPLEXITY="$R_STATUS"
NOTE_COMPLEXITY="$R_NOTE"

RESULT_MAXLINESFUNC="$(check_rule "max-lines-per-function")"
build_rule_status_and_note "$RESULT_MAXLINESFUNC" "建議 .ts 50 / .tsx 150"
STATUS_MAXLINESFUNC="$R_STATUS"
NOTE_MAXLINESFUNC="$R_NOTE"

RESULT_MAXDEPTH="$(check_rule "max-depth")"
build_rule_status_and_note "$RESULT_MAXDEPTH" "建議 max-depth: 4"
STATUS_MAXDEPTH="$R_STATUS"
NOTE_MAXDEPTH="$R_NOTE"

RESULT_MAXLINES="$(check_rule "max-lines")"
build_rule_status_and_note "$RESULT_MAXLINES" "建議 max-lines: 200"
STATUS_MAXLINES="$R_STATUS"
NOTE_MAXLINES="$R_NOTE"

# ─── 3. 重複偵測（jscpd） ────────────────────────────────────────────────────

STATUS_JSCPD="缺"
if has_jscpd_dep; then
  STATUS_JSCPD="已有"
elif [ -f "$PROJECT_DIR/.jscpd.json" ] || [ -f "$PROJECT_DIR/jscpd.json" ]; then
  STATUS_JSCPD="已有"
elif has_pkg_field "jscpd"; then
  STATUS_JSCPD="已有"
fi
NOTE_JSCPD=""
if [ "$STATUS_JSCPD" = "缺" ]; then
  NOTE_JSCPD="建議接 jscpd"
fi

# ─── 4. pre-commit hook ─────────────────────────────────────────────────────

STATUS_PRECOMMIT="缺"
NOTE_PRECOMMIT="建議 husky + lint-staged"

GIT_HOOKS_PATH="$(git -C "$PROJECT_DIR" config --get core.hooksPath 2>/dev/null)"

# hooksPath 可能是相對 repo root 的路徑，補成絕對路徑才判得到檔案
GIT_HOOKS_DIR=""
if [ -n "$GIT_HOOKS_PATH" ]; then
  case "$GIT_HOOKS_PATH" in
    /*) GIT_HOOKS_DIR="$GIT_HOOKS_PATH" ;;
    *)  GIT_HOOKS_DIR="$PROJECT_DIR/$GIT_HOOKS_PATH" ;;
  esac
fi

if [ -f "$PROJECT_DIR/.husky/pre-commit" ]; then
  STATUS_PRECOMMIT="已有"
  NOTE_PRECOMMIT="husky"
elif [ -n "$GIT_HOOKS_DIR" ] && [ -f "$GIT_HOOKS_DIR/pre-commit" ]; then
  STATUS_PRECOMMIT="已有"
  NOTE_PRECOMMIT="git config core.hooksPath=${GIT_HOOKS_PATH}"
elif has_pkg_field "simple-git-hooks" || has_dep "simple-git-hooks"; then
  STATUS_PRECOMMIT="已有"
  NOTE_PRECOMMIT="simple-git-hooks"
elif [ -f "$PROJECT_DIR/.git/hooks/pre-commit" ]; then
  STATUS_PRECOMMIT="已有"
  NOTE_PRECOMMIT=".git/hooks/pre-commit"
elif [ -d "$PROJECT_DIR/.husky" ] || has_dep "husky" || [ -n "$GIT_HOOKS_DIR" ]; then
  # 裝了 husky 或設了 hooksPath，但就是沒有 pre-commit 這個檔。
  # 跟「完全沒裝」要分開講——修法不同：這裡只要補 hook，不必重裝。
  STATUS_PRECOMMIT="部分"
  NOTE_PRECOMMIT="hook 機制已就位但缺 pre-commit 檔，跑 npx husky init 或手動補上"
fi

# ─── 5. lint-staged ──────────────────────────────────────────────────────────

# 裝了套件 ≠ 有設定。沒設定的話 `npx lint-staged` 會以
# "could not find any valid configuration" 失敗 —— 結果是每一次 commit 都被擋，
# 使用者兩天內就會把 hook 拿掉。所以這兩種狀態一定要分開報。
STATUS_LINTSTAGED="缺"
NOTE_LINTSTAGED=""

LINTSTAGED_HAS_CONFIG=""
if has_pkg_field "lint-staged"; then
  LINTSTAGED_HAS_CONFIG="package.json"
else
  for f in .lintstagedrc .lintstagedrc.json .lintstagedrc.yml .lintstagedrc.yaml .lintstagedrc.js .lintstagedrc.cjs .lintstagedrc.mjs lint-staged.config.js lint-staged.config.cjs lint-staged.config.mjs; do
    if [ -f "$PROJECT_DIR/$f" ]; then
      LINTSTAGED_HAS_CONFIG="$f"
      break
    fi
  done
fi

if [ -n "$LINTSTAGED_HAS_CONFIG" ]; then
  STATUS_LINTSTAGED="已有"
  NOTE_LINTSTAGED="${LINTSTAGED_HAS_CONFIG}"
elif has_dep "lint-staged"; then
  STATUS_LINTSTAGED="部分"
  NOTE_LINTSTAGED="套件已安裝但找不到設定，npx lint-staged 會直接失敗"
fi

# ─── 6. coverage 門檻 ────────────────────────────────────────────────────────

STATUS_COVERAGE="N/A"
NOTE_COVERAGE="無測試框架"

if [ "$TEST_FRAMEWORK" = "vitest" ]; then
  STATUS_COVERAGE="缺"
  NOTE_COVERAGE="建議 line 70 / branch 60"
  for f in vitest.config.ts vitest.config.js vitest.config.mjs vitest.config.cjs vitest.config.mts vitest.config.cts vite.config.ts vite.config.js vite.config.mjs vite.config.cjs; do
    if [ -f "$PROJECT_DIR/$f" ]; then
      if grep -Eq "thresholds|lines[[:space:]]*:[[:space:]]*[0-9]|branches[[:space:]]*:[[:space:]]*[0-9]" "$PROJECT_DIR/$f" 2>/dev/null; then
        STATUS_COVERAGE="已有"
        NOTE_COVERAGE="偵測到 $f 內設定（淺層偵測）"
        break
      fi
    fi
  done
elif [ "$TEST_FRAMEWORK" = "jest" ]; then
  STATUS_COVERAGE="缺"
  NOTE_COVERAGE="建議 line 70 / branch 60"
  if PKG_PATH="$PKG_JSON" node -e '
    const fs = require("fs");
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(process.env.PKG_PATH, "utf8"));
    } catch (e) {
      process.exit(1);
    }
    process.exit(pkg.jest && pkg.jest.coverageThreshold ? 0 : 1);
  ' 2>/dev/null; then
    STATUS_COVERAGE="已有"
    NOTE_COVERAGE="package.json jest.coverageThreshold"
  else
    if [ -f "$PROJECT_DIR/jest.config.json" ] && node -e '
      const fs = require("fs");
      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      } catch (e) {
        process.exit(1);
      }
      process.exit(cfg.coverageThreshold ? 0 : 1);
    ' "$PROJECT_DIR/jest.config.json" 2>/dev/null; then
      STATUS_COVERAGE="已有"
      NOTE_COVERAGE="jest.config.json coverageThreshold"
    else
      for f in jest.config.js jest.config.ts jest.config.cjs jest.config.mjs; do
        if [ -f "$PROJECT_DIR/$f" ] && grep -q "coverageThreshold" "$PROJECT_DIR/$f" 2>/dev/null; then
          STATUS_COVERAGE="已有"
          NOTE_COVERAGE="偵測到 $f 內 coverageThreshold（淺層偵測）"
          break
        fi
      done
    fi
  fi
fi

# ─── 7. TypeScript 嚴格度 ────────────────────────────────────────────────────

TSCONFIG="$PROJECT_DIR/tsconfig.json"
STATUS_TSSTRICT="N/A"
NOTE_TSSTRICT="無 tsconfig.json"
STATUS_TSNOUNCHECKED="N/A"
NOTE_TSNOUNCHECKED="無 tsconfig.json"

if [ -f "$TSCONFIG" ]; then
  # tsconfig 允許註解與尾逗號，不硬做完整 JSON parse；用正規表達式抓兩個布林
  # key 跟 extends 欄位就好，抓不到就誠實標「未解析」，不猜測。
  TS_INFO="$(node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    function extractBool(key) {
      const re = new RegExp("\"" + key + "\"\\s*:\\s*(true|false)");
      const m = raw.match(re);
      return m ? m[1] : "unset";
    }
    const extMatch = /"extends"\s*:\s*"([^"]+)"/.exec(raw);
    console.log("strict=" + extractBool("strict"));
    console.log("noUnchecked=" + extractBool("noUncheckedIndexedAccess"));
    console.log("extends=" + (extMatch ? extMatch[1] : ""));
  ' "$TSCONFIG" 2>/dev/null)"

  # 注意：變數後面直接接全形字元時一定要寫 ${VAR}，不能寫 $VAR。
  # bash 3.2 會把全形字元的部分 byte 併進變數名，展開結果變空字串、標點也跟著壞掉。
  TS_STRICT_VAL="unset"
  TS_NOUNCHECKED_VAL="unset"
  TS_EXTENDS_VAL=""
  while IFS= read -r line; do
    case "$line" in
      strict=*) TS_STRICT_VAL="${line#strict=}" ;;
      noUnchecked=*) TS_NOUNCHECKED_VAL="${line#noUnchecked=}" ;;
      extends=*) TS_EXTENDS_VAL="${line#extends=}" ;;
    esac
  done <<EOF
$TS_INFO
EOF

  if [ "$TS_STRICT_VAL" = "true" ]; then
    STATUS_TSSTRICT="已有"
    NOTE_TSSTRICT=""
  elif [ "$TS_STRICT_VAL" = "false" ]; then
    STATUS_TSSTRICT="缺"
    NOTE_TSSTRICT=""
  else
    if [ -n "$TS_EXTENDS_VAL" ]; then
      STATUS_TSSTRICT="部分"
      NOTE_TSSTRICT="繼承自 ${TS_EXTENDS_VAL}，未解析"
    else
      STATUS_TSSTRICT="缺"
      NOTE_TSSTRICT=""
    fi
  fi

  if [ "$TS_NOUNCHECKED_VAL" = "true" ]; then
    STATUS_TSNOUNCHECKED="已有"
    NOTE_TSNOUNCHECKED=""
  elif [ "$TS_NOUNCHECKED_VAL" = "false" ]; then
    STATUS_TSNOUNCHECKED="缺"
    NOTE_TSNOUNCHECKED=""
  else
    if [ -n "$TS_EXTENDS_VAL" ]; then
      STATUS_TSNOUNCHECKED="部分"
      NOTE_TSNOUNCHECKED="繼承自 ${TS_EXTENDS_VAL}，未解析"
    else
      STATUS_TSNOUNCHECKED="缺"
      NOTE_TSNOUNCHECKED=""
    fi
  fi
fi

# ─── 小結計數 ────────────────────────────────────────────────────────────────

TOTAL_ITEMS=10
DONE_ITEMS=0
NA_ITEMS=0
for s in "$STATUS_COMPLEXITY" "$STATUS_MAXLINESFUNC" "$STATUS_MAXDEPTH" "$STATUS_MAXLINES" \
         "$STATUS_JSCPD" "$STATUS_PRECOMMIT" "$STATUS_LINTSTAGED" "$STATUS_COVERAGE" \
         "$STATUS_TSSTRICT" "$STATUS_TSNOUNCHECKED"; do
  case "$s" in
    已有) DONE_ITEMS=$((DONE_ITEMS + 1)) ;;
    N/A) NA_ITEMS=$((NA_ITEMS + 1)) ;;
  esac
done
EFFECTIVE_ITEMS=$((TOTAL_ITEMS - NA_ITEMS))
TODO_ITEMS=$((EFFECTIVE_ITEMS - DONE_ITEMS))

if [ "$NA_ITEMS" -gt 0 ]; then
  SUMMARY_LINE="共 ${TOTAL_ITEMS} 項（${NA_ITEMS} 項 N/A）：${EFFECTIVE_ITEMS} 項中 ${DONE_ITEMS} 項已備妥，${TODO_ITEMS} 項待補"
else
  SUMMARY_LINE="${TOTAL_ITEMS} 項中 ${DONE_ITEMS} 項已備妥，${TODO_ITEMS} 項待補"
fi

# ─── 輸出 ────────────────────────────────────────────────────────────────────

if $JSON_MODE; then
  PROJECT_PATH="$PROJECT_DIR" \
  FRAMEWORK_ENV="$FRAMEWORK" \
  TEST_FRAMEWORK_ENV="$TEST_FRAMEWORK" \
  ESLINT_FORMAT_ENV="$ESLINT_FORMAT" \
  RULE_METHOD_ENV="$RULE_METHOD" \
  S_COMPLEXITY="$STATUS_COMPLEXITY" N_COMPLEXITY="$NOTE_COMPLEXITY" \
  S_MAXLINESFUNC="$STATUS_MAXLINESFUNC" N_MAXLINESFUNC="$NOTE_MAXLINESFUNC" \
  S_MAXDEPTH="$STATUS_MAXDEPTH" N_MAXDEPTH="$NOTE_MAXDEPTH" \
  S_MAXLINES="$STATUS_MAXLINES" N_MAXLINES="$NOTE_MAXLINES" \
  S_JSCPD="$STATUS_JSCPD" N_JSCPD="$NOTE_JSCPD" \
  S_PRECOMMIT="$STATUS_PRECOMMIT" N_PRECOMMIT="$NOTE_PRECOMMIT" \
  S_LINTSTAGED="$STATUS_LINTSTAGED" N_LINTSTAGED="$NOTE_LINTSTAGED" \
  S_COVERAGE="$STATUS_COVERAGE" N_COVERAGE="$NOTE_COVERAGE" \
  S_TSSTRICT="$STATUS_TSSTRICT" N_TSSTRICT="$NOTE_TSSTRICT" \
  S_TSNOUNCHECKED="$STATUS_TSNOUNCHECKED" N_TSNOUNCHECKED="$NOTE_TSNOUNCHECKED" \
  TOTAL_ENV="$TOTAL_ITEMS" DONE_ENV="$DONE_ITEMS" NA_ENV="$NA_ITEMS" \
  EFFECTIVE_ENV="$EFFECTIVE_ITEMS" TODO_ENV="$TODO_ITEMS" \
  node -e '
    const e = process.env;
    const item = (status, note, method) => {
      const obj = { status, note: note || null };
      if (method) obj.method = method;
      return obj;
    };
    const ruleMethod = e.RULE_METHOD_ENV;
    const out = {
      projectPath: e.PROJECT_PATH,
      isNodeProject: true,
      framework: e.FRAMEWORK_ENV,
      testFramework: e.TEST_FRAMEWORK_ENV,
      eslintConfigFormat: e.ESLINT_FORMAT_ENV,
      ruleDetectionMethod: ruleMethod,
      items: {
        complexity: item(e.S_COMPLEXITY, e.N_COMPLEXITY, ruleMethod),
        maxLinesPerFunction: item(e.S_MAXLINESFUNC, e.N_MAXLINESFUNC, ruleMethod),
        maxDepth: item(e.S_MAXDEPTH, e.N_MAXDEPTH, ruleMethod),
        maxLines: item(e.S_MAXLINES, e.N_MAXLINES, ruleMethod),
        duplicateDetection: item(e.S_JSCPD, e.N_JSCPD),
        preCommit: item(e.S_PRECOMMIT, e.N_PRECOMMIT),
        lintStaged: item(e.S_LINTSTAGED, e.N_LINTSTAGED),
        coverageThreshold: item(e.S_COVERAGE, e.N_COVERAGE),
        tsStrict: item(e.S_TSSTRICT, e.N_TSSTRICT),
        tsNoUncheckedIndexedAccess: item(e.S_TSNOUNCHECKED, e.N_TSNOUNCHECKED)
      },
      summary: {
        total: Number(e.TOTAL_ENV),
        done: Number(e.DONE_ENV),
        na: Number(e.NA_ENV),
        effective: Number(e.EFFECTIVE_ENV),
        todo: Number(e.TODO_ENV)
      }
    };
    console.log(JSON.stringify(out, null, 2));
  '
  exit 0
fi

print_row() {
  # $1 = 標籤, $2 = 狀態, $3 = 說明（可空）
  if [ -n "$3" ]; then
    printf "%s：%s（%s）\n" "$1" "$2" "$3"
  else
    printf "%s：%s\n" "$1" "$2"
  fi
}

echo "專案：$PROJECT_DIR"
echo "框架：$FRAMEWORK    測試：$TEST_FRAMEWORK    ESLint config：$ESLINT_FORMAT"
if [ "$RULE_METHOD" = "grep-fallback" ]; then
  echo "（規則偵測用 grep 淺層掃描，非 eslint --print-config，結果可能不準）"
fi
echo ""
print_row "複雜度門檻（complexity）" "$STATUS_COMPLEXITY" "$NOTE_COMPLEXITY"
print_row "函式長度上限（max-lines-per-function）" "$STATUS_MAXLINESFUNC" "$NOTE_MAXLINESFUNC"
print_row "巢狀深度（max-depth）" "$STATUS_MAXDEPTH" "$NOTE_MAXDEPTH"
print_row "單檔行數（max-lines）" "$STATUS_MAXLINES" "$NOTE_MAXLINES"
print_row "重複偵測（jscpd）" "$STATUS_JSCPD" "$NOTE_JSCPD"
print_row "pre-commit" "$STATUS_PRECOMMIT" "$NOTE_PRECOMMIT"
print_row "lint-staged" "$STATUS_LINTSTAGED" "$NOTE_LINTSTAGED"
print_row "coverage 門檻" "$STATUS_COVERAGE" "$NOTE_COVERAGE"
print_row "TS strict" "$STATUS_TSSTRICT" "$NOTE_TSSTRICT"
print_row "TS noUncheckedIndexedAccess" "$STATUS_TSNOUNCHECKED" "$NOTE_TSNOUNCHECKED"
echo ""
echo "小結：$SUMMARY_LINE"
