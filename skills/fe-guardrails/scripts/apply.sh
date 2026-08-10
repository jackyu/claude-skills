#!/usr/bin/env bash
#
# apply.sh -- 套用「程式碼品質護欄」設定到前端專案
#
# 用法：
#   apply.sh [專案路徑]                 # 預設 dry-run：只印計畫，不寫入
#   apply.sh [專案路徑] --write         # 真的寫入
#   apply.sh [專案路徑] --measure       # 只量現況（ESLint + jscpd 實跑），不印套用計畫、不寫入
#   apply.sh [專案路徑] --mode=new|existing   # 覆寫自動判定的新／既有專案
#   apply.sh -h|--help
#
# 安全邊界（見 SKILL.md）：
#   - 預設 dry-run，一個字都不寫進磁碟
#   - 絕不覆蓋既有檔案，先備份成 <檔名>.bak-<YYYYMMDD-HHMMSS>
#   - 只加 guardrails 區塊，不動既有 ESLint config 的其他規則
#   - 不跑 npm install，要裝套件一律印指令請使用者自己跑
#
# 相容 macOS 內建 bash 3.2：不用 declare -A、不用 ${var,,}、不用 set -e。
# `$VAR` 後面接全形字元一律寫 `${VAR}`（bash 3.2 會把全形字元的部分 byte
# 併進變數名，導致展開成空字串、標點跟著壞掉），本檔一律用 ${VAR} 形式。
# JSON 解析一律丟給 node -e，不依賴 jq。

# ─── 說明文字 ────────────────────────────────────────────────────────────────

print_help() {
  cat <<'EOF'
用法：apply.sh [專案路徑] [旗標]

把品質護欄（ESLint complexity/max-lines-per-function/max-depth/max-lines、
jscpd 重複偵測、husky pre-commit、lint-staged）套用到前端專案。

旗標：
  （無）        dry-run：印出會做什麼，不寫入任何檔案
  --write       真的寫入
  --dry-run     等同不帶旗標（明示 dry-run）
  --measure     只量現況（實跑 eslint + jscpd），不印套用計畫、不寫入
  --mode=new        當作新專案處理（門檻用建議值、error 等級）
  --mode=existing   當作既有專案處理（先量現況，門檻設在目前最差值、warn 等級）
  -h, --help    印這段說明

不帶 --mode 時用 src/、app/ 底下的檔案數判斷新舊專案（詳見 SKILL.md 第 2 步）。

範例：
  apply.sh ~/proj                     # dry-run 看計畫
  apply.sh ~/proj --measure           # 只想看現況數字
  apply.sh ~/proj --write             # 真的套用
  apply.sh ~/proj --mode=existing --write
EOF
}

# ─── 參數解析 ────────────────────────────────────────────────────────────────

PROJECT_DIR_ARG="."
ACTION="dry-run"
MODE_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --write)
      ACTION="write"
      shift
      ;;
    --dry-run)
      ACTION="dry-run"
      shift
      ;;
    --measure)
      ACTION="measure"
      shift
      ;;
    --mode=new)
      MODE_OVERRIDE="new"
      shift
      ;;
    --mode=existing)
      MODE_OVERRIDE="existing"
      shift
      ;;
    --mode=*)
      echo "錯誤：--mode 只能是 new 或 existing" >&2
      exit 1
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

if [ ! -d "${PROJECT_DIR_ARG}" ]; then
  echo "錯誤：路徑不存在：${PROJECT_DIR_ARG}" >&2
  exit 1
fi
PROJECT_DIR="$(cd "${PROJECT_DIR_ARG}" && pwd)"
PKG_JSON="${PROJECT_DIR}/package.json"

if [ ! -f "${PKG_JSON}" ]; then
  echo "不是 Node.js 專案（找不到 package.json），無法套用。" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="$(cd "${SCRIPT_DIR}/../assets" && pwd)"
DETECT_SH="${SCRIPT_DIR}/detect.sh"

if [ ! -f "${DETECT_SH}" ]; then
  echo "錯誤：找不到 detect.sh（預期路徑：${DETECT_SH}）" >&2
  exit 1
fi

# ─── 暫存目錄（所有臨時檔都放這裡，絕不落地在專案內；結束一律清掉） ──────────

TMP_DIR="$(mktemp -d)"
cleanup() {
  if [ -n "${TMP_DIR}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

# ─── 拿 detect.sh 的現況（JSON），後面所有「已有/缺」判斷都查這份 ───────────

DETECT_JSON_FILE="${TMP_DIR}/detect.json"
bash "${DETECT_SH}" --json "${PROJECT_DIR}" >"${DETECT_JSON_FILE}" 2>"${TMP_DIR}/detect-err.txt"

if [ ! -s "${DETECT_JSON_FILE}" ]; then
  echo "錯誤：detect.sh 沒有輸出，無法取得現況" >&2
  cat "${TMP_DIR}/detect-err.txt" >&2
  exit 1
fi

# 查 detect.json 裡的欄位，$1 = 用點分隔的路徑，如 items.complexity.status
dj() {
  DJF="${DETECT_JSON_FILE}" KEYPATH="$1" node -e '
    const fs = require("fs");
    let d;
    try {
      d = JSON.parse(fs.readFileSync(process.env.DJF, "utf8"));
    } catch (e) {
      console.log("");
      process.exit(0);
    }
    const path = process.env.KEYPATH.split(".");
    let cur = d;
    for (const p of path) {
      cur = (cur == null) ? undefined : cur[p];
    }
    console.log(cur === undefined || cur === null ? "" : cur);
  ' 2>/dev/null
}

IS_NODE_PROJECT="$(dj isNodeProject)"
if [ "${IS_NODE_PROJECT}" != "true" ]; then
  echo "錯誤：detect.sh 回報這不是 Node.js 專案，無法套用" >&2
  exit 1
fi

FRAMEWORK="$(dj framework)"
TEST_FRAMEWORK="$(dj testFramework)"

# ─── ESLint config 格式與實際檔名（detect.sh 的 JSON 沒有輸出檔名，這裡重找） ─

ESLINT_FLAT_FOUND=false
ESLINT_FLAT_FILE=""
ESLINT_RC_FOUND=false
ESLINT_RC_FILE=""
ESLINT_FORMAT="none"

detect_eslint_format() {
  local f
  for f in eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts eslint.config.mts eslint.config.cts; do
    if [ -f "${PROJECT_DIR}/${f}" ]; then
      ESLINT_FLAT_FOUND=true
      ESLINT_FLAT_FILE="${f}"
      break
    fi
  done

  for f in .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml; do
    if [ -f "${PROJECT_DIR}/${f}" ]; then
      ESLINT_RC_FOUND=true
      ESLINT_RC_FILE="${f}"
      break
    fi
  done
  if ! ${ESLINT_RC_FOUND}; then
    if PKG_PATH="${PKG_JSON}" node -e '
      const fs = require("fs");
      let pkg;
      try { pkg = JSON.parse(fs.readFileSync(process.env.PKG_PATH, "utf8")); } catch (e) { process.exit(1); }
      process.exit(Object.prototype.hasOwnProperty.call(pkg, "eslintConfig") ? 0 : 1);
    ' 2>/dev/null; then
      ESLINT_RC_FOUND=true
      ESLINT_RC_FILE="package.json"
    fi
  fi

  if ${ESLINT_FLAT_FOUND} && ${ESLINT_RC_FOUND}; then
    ESLINT_FORMAT="both"
  elif ${ESLINT_FLAT_FOUND}; then
    ESLINT_FORMAT="flat"
  elif ${ESLINT_RC_FOUND}; then
    ESLINT_FORMAT="eslintrc"
  else
    ESLINT_FORMAT="none"
  fi
}
detect_eslint_format

# ─── 新專案 vs 既有專案 ──────────────────────────────────────────────────────
#
# 判準（SKILL.md 第 2 步）：src/ 或 app/ 下超過 20 個檔 → 既有專案；
# 剛 init、幾乎沒程式碼 → 新專案；拿不準就當既有專案處理，所以門檻定在 20。

detect_mode_auto() {
  local count=0
  local n
  if [ -d "${PROJECT_DIR}/src" ]; then
    n="$(find "${PROJECT_DIR}/src" -type f 2>/dev/null | wc -l | tr -d ' ')"
    count=$((count + n))
  fi
  if [ -d "${PROJECT_DIR}/app" ]; then
    n="$(find "${PROJECT_DIR}/app" -type f 2>/dev/null | wc -l | tr -d ' ')"
    count=$((count + n))
  fi
  if [ "${count}" -gt 20 ]; then
    echo "existing"
  else
    echo "new"
  fi
}

if [ -n "${MODE_OVERRIDE}" ]; then
  MODE="${MODE_OVERRIDE}"
else
  MODE="$(detect_mode_auto)"
fi

if [ "${MODE}" = "existing" ]; then
  MODE_LABEL="既有專案"
else
  MODE_LABEL="新專案"
fi

# ─── 度量用暫存 config（ESLint 門檻全設 1，逼每個函式都違規，藉此讀出實際數值） ─
#
# 兩份都先寫好：flat（ESLint 9 預設）與 eslintrc（ESLint 8）。跑的時候先試
# flat，跑不起來（版本不合、旗標不認得）再試 eslintrc，兩者互斥失敗剛好可以
# 當作「這台裝的是哪個世代」的判斷依據，不用另外猜版本。
#
# 兩份 config 都不落地在專案目錄裡，且都用 process.env.FE_GUARDRAILS_PROJECT_DIR
# 或 require.resolve({ paths }) 去專案的 node_modules 找 TypeScript parser，
# 避免暫存檔位置影響模組解析。

PARSE_SCRIPT="${TMP_DIR}/parse-measure.mjs"

write_parse_script() {
  cat >"${PARSE_SCRIPT}" <<'EOF'
import fs from 'fs';

const [, , jsonPath, kvPath] = process.argv;
let results;
try {
  results = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error('無法解析 ESLint JSON 輸出：' + e.message);
  process.exit(1);
}

function extFromPath(p) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(p || '');
  return m ? m[1].toLowerCase() : '';
}

const tsxExts = new Set(['tsx', 'jsx']);

const funcLinesTs = [];
const funcLinesTsx = [];
const complexities = [];
const depths = [];
const fileLines = [];
let parseErrorCount = 0;

for (const fileResult of results) {
  const ext = extFromPath(fileResult.filePath);
  for (const msg of fileResult.messages || []) {
    if (msg.fatal) {
      parseErrorCount++;
      continue;
    }
    if (msg.ruleId === 'max-lines-per-function') {
      const m = /\((\d+)\)/.exec(msg.message);
      if (m) {
        const n = Number(m[1]);
        if (tsxExts.has(ext)) funcLinesTsx.push(n);
        else funcLinesTs.push(n);
      }
    } else if (msg.ruleId === 'complexity') {
      const m = /complexity of (\d+)/.exec(msg.message);
      if (m) complexities.push(Number(m[1]));
    } else if (msg.ruleId === 'max-depth') {
      const m = /\((\d+)\)/.exec(msg.message);
      if (m) depths.push(Number(m[1]));
    } else if (msg.ruleId === 'max-lines') {
      const m = /\((\d+)\)/.exec(msg.message);
      if (m) fileLines.push(Number(m[1]));
    }
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function maxOf(arr) {
  return arr.length ? Math.max(...arr) : null;
}
function countOver(arr, threshold) {
  return arr.filter((n) => n > threshold).length;
}
function roundUpStep(n, step) {
  if (n === null || n === undefined) return null;
  return Math.ceil(n / step) * step;
}

const lines = [];
lines.push('量測結果（來源：eslint 實跑）');
lines.push('────────────────────────────');

function fmtFuncLine(label, arr, overThreshold) {
  if (arr.length === 0) {
    lines.push(label + '函式長度：  未掃到任何函式');
    return;
  }
  const p50 = percentile(arr, 50);
  const p90 = percentile(arr, 90);
  const mx = maxOf(arr);
  const over = countOver(arr, overThreshold);
  const overNote = over > 0 ? '（' + over + ' 支 > ' + overThreshold + '）' : '';
  lines.push(label + '函式長度：  掃過 ' + arr.length + ' 支，p50 ' + p50 + '、p90 ' + p90 + '、最長 ' + mx + overNote);
}

fmtFuncLine('.ts ', funcLinesTs, 50);
fmtFuncLine('.tsx', funcLinesTsx, 150);

if (depths.length) {
  lines.push('巢狀深度：       最深 ' + maxOf(depths));
} else {
  lines.push('巢狀深度：       未掃到超標區塊');
}

if (fileLines.length) {
  const over200 = countOver(fileLines, 200);
  const overNote = over200 > 0 ? '（' + over200 + ' 檔 > 200）' : '';
  lines.push('單檔行數：       掃過 ' + fileLines.length + ' 檔，最長 ' + maxOf(fileLines) + overNote);
} else {
  lines.push('單檔行數：       未掃到超標檔案');
}

if (complexities.length) {
  const over15 = countOver(complexities, 15);
  const overNote = over15 > 0 ? '（' + over15 + ' 支 > 15）' : '';
  lines.push('複雜度：         最高 ' + maxOf(complexities) + overNote);
} else {
  lines.push('複雜度：         未掃到超標函式');
}

if (parseErrorCount > 0) {
  lines.push('（' + parseErrorCount + ' 個檔案解析失敗，可能缺 TypeScript parser 或有語法錯誤，未計入統計）');
}

console.log(lines.join('\n'));

const tsMax = maxOf(funcLinesTs);
const tsxMax = maxOf(funcLinesTsx);
const depthMax = maxOf(depths);
const fileLinesMax = maxOf(fileLines);
const complexityMax = maxOf(complexities);

const kv = [];
kv.push('tsFuncMax=' + (tsMax === null ? '' : tsMax));
kv.push('tsxFuncMax=' + (tsxMax === null ? '' : tsxMax));
kv.push('depthMax=' + (depthMax === null ? '' : depthMax));
kv.push('fileLinesMax=' + (fileLinesMax === null ? '' : fileLinesMax));
kv.push('complexityMax=' + (complexityMax === null ? '' : complexityMax));
kv.push('tsFuncRecommend=' + (roundUpStep(tsMax, 10) ?? ''));
kv.push('tsxFuncRecommend=' + (roundUpStep(tsxMax, 10) ?? ''));
kv.push('depthRecommend=' + (depthMax === null ? '' : depthMax));
kv.push('fileLinesRecommend=' + (roundUpStep(fileLinesMax, 10) ?? ''));
kv.push('complexityRecommend=' + (roundUpStep(complexityMax, 5) ?? ''));

fs.writeFileSync(kvPath, kv.join('\n') + '\n');
EOF
}

write_measure_flat_config() {
  cat >"$1" <<'EOF'
import { createRequire } from 'module';

const PROJECT_DIR = process.env.FE_GUARDRAILS_PROJECT_DIR;
const req = createRequire(PROJECT_DIR + '/package.json');

let tsParser;
try {
  tsParser = req('@typescript-eslint/parser');
} catch (e) {
  try {
    tsParser = req('typescript-eslint').parser;
  } catch (e2) {
    tsParser = undefined;
  }
}

const languageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  parserOptions: { ecmaFeatures: { jsx: true } },
};
if (tsParser) {
  languageOptions.parser = tsParser;
}

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
    languageOptions,
    rules: {
      complexity: ['error', 1],
      'max-depth': ['error', 1],
      'max-lines': ['error', { max: 1, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 1, skipBlankLines: true, skipComments: true }],
    },
  },
];
EOF
}

write_measure_rc_config() {
  cat >"$1" <<'EOF'
'use strict';
const PROJECT_DIR = process.env.FE_GUARDRAILS_PROJECT_DIR;

let parser;
try {
  parser = require.resolve('@typescript-eslint/parser', { paths: [PROJECT_DIR] });
} catch (e) {
  try {
    parser = require.resolve('typescript-eslint', { paths: [PROJECT_DIR] });
  } catch (e2) {
    parser = undefined;
  }
}

module.exports = {
  root: true,
  ignorePatterns: ['node_modules/**', '.next/**', 'dist/**', 'build/**', 'coverage/**', '**/*.d.ts'],
  parser: parser,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  rules: {
    complexity: ['error', 1],
    'max-depth': ['error', 1],
    'max-lines': ['error', { max: 1, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 1, skipBlankLines: true, skipComments: true }],
  },
};
EOF
}

MEAS_OK=false
MEAS_TS_MAX=""
MEAS_TSX_MAX=""
MEAS_DEPTH_MAX=""
MEAS_FILELINES_MAX=""
MEAS_COMPLEXITY_MAX=""
MEAS_TS_RECOMMEND=""
MEAS_TSX_RECOMMEND=""
MEAS_DEPTH_RECOMMEND=""
MEAS_FILELINES_RECOMMEND=""
MEAS_COMPLEXITY_RECOMMEND=""

MEAS_JSCPD_OK=false
MEAS_JSCPD_PCT=""
MEAS_JSCPD_RECOMMEND=""

# 檢查 --format json 的輸出是不是合法 JSON（eslint 找到違規時 exit code 是 1，
# 但輸出仍是合法 JSON——這種情況算「跑成功」，不算失敗）
is_valid_json_file() {
  node -e '
    const fs = require("fs");
    try {
      JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.exit(0);
    } catch (e) {
      process.exit(1);
    }
  ' "$1" >/dev/null 2>&1
}

run_measurement() {
  local version_out
  version_out="$(cd "${PROJECT_DIR}" && npx --no-install eslint --version 2>&1)"
  if [ $? -ne 0 ]; then
    echo "請先安裝 eslint 才能量測（npx --no-install eslint --version 失敗：${version_out}）"
    MEAS_OK=false
    return 1
  fi

  export FE_GUARDRAILS_PROJECT_DIR="${PROJECT_DIR}"
  write_parse_script
  local flat_cfg="${TMP_DIR}/measure-flat.mjs"
  local rc_cfg="${TMP_DIR}/measure-rc.cjs"
  write_measure_flat_config "${flat_cfg}"
  write_measure_rc_config "${rc_cfg}"

  local out_json="${TMP_DIR}/eslint-measure-out.json"
  local out_err="${TMP_DIR}/eslint-measure-err.txt"
  local ok=false

  # 先試 flat（ESLint 9 預設用法），版本或旗標不合會直接報錯，跑不起來再試 eslintrc
  (cd "${PROJECT_DIR}" && npx --no-install eslint --no-config-lookup -c "${flat_cfg}" --format json . >"${out_json}" 2>"${out_err}")
  if is_valid_json_file "${out_json}"; then
    ok=true
  fi

  if ! ${ok}; then
    (cd "${PROJECT_DIR}" && npx --no-install eslint --no-eslintrc -c "${rc_cfg}" --ext .ts,.tsx,.js,.jsx,.mjs,.cjs --format json . >"${out_json}" 2>"${out_err}")
    if is_valid_json_file "${out_json}"; then
      ok=true
    fi
  fi

  if ! ${ok}; then
    echo "量測失敗：ESLint 用 flat 與 eslintrc 兩種暫存設定都跑不起來，改用 thresholds.md 建議值。"
    echo "最後一次錯誤訊息："
    tail -n 20 "${out_err}"
    MEAS_OK=false
    return 1
  fi

  local kv_out="${TMP_DIR}/measure-kv.txt"
  node "${PARSE_SCRIPT}" "${out_json}" "${kv_out}"
  if [ $? -ne 0 ] || [ ! -f "${kv_out}" ]; then
    echo "量測輸出解析失敗，改用 thresholds.md 建議值。"
    MEAS_OK=false
    return 1
  fi

  while IFS= read -r line; do
    case "${line}" in
      tsFuncMax=*) MEAS_TS_MAX="${line#tsFuncMax=}" ;;
      tsxFuncMax=*) MEAS_TSX_MAX="${line#tsxFuncMax=}" ;;
      depthMax=*) MEAS_DEPTH_MAX="${line#depthMax=}" ;;
      fileLinesMax=*) MEAS_FILELINES_MAX="${line#fileLinesMax=}" ;;
      complexityMax=*) MEAS_COMPLEXITY_MAX="${line#complexityMax=}" ;;
      tsFuncRecommend=*) MEAS_TS_RECOMMEND="${line#tsFuncRecommend=}" ;;
      tsxFuncRecommend=*) MEAS_TSX_RECOMMEND="${line#tsxFuncRecommend=}" ;;
      depthRecommend=*) MEAS_DEPTH_RECOMMEND="${line#depthRecommend=}" ;;
      fileLinesRecommend=*) MEAS_FILELINES_RECOMMEND="${line#fileLinesRecommend=}" ;;
      complexityRecommend=*) MEAS_COMPLEXITY_RECOMMEND="${line#complexityRecommend=}" ;;
    esac
  done <"${kv_out}"

  MEAS_OK=true
}

run_jscpd_measure() {
  local version_out
  version_out="$(cd "${PROJECT_DIR}" && npx --no-install jscpd --version 2>&1)"
  if [ $? -ne 0 ]; then
    echo "重複率：         未量測（未安裝 jscpd）"
    MEAS_JSCPD_OK=false
    return 0
  fi

  local out_dir="${TMP_DIR}/jscpd-out"
  (cd "${PROJECT_DIR}" && npx --no-install jscpd --reporters json --output "${out_dir}" . >"${TMP_DIR}/jscpd-run.log" 2>&1)

  local report="${out_dir}/jscpd-report.json"
  if [ ! -f "${report}" ]; then
    echo "重複率：         未量測（jscpd 未產生報告，可能是版本差異）"
    MEAS_JSCPD_OK=false
    return 0
  fi

  local pct
  pct="$(node -e '
    const fs = require("fs");
    try {
      const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const p = r && r.statistics && r.statistics.total ? r.statistics.total.percentage : undefined;
      if (typeof p === "number") console.log(p);
    } catch (e) {}
  ' "${report}")"

  if [ -z "${pct}" ]; then
    echo "重複率：         未量測（jscpd 報告格式解析不到 percentage）"
    MEAS_JSCPD_OK=false
    return 0
  fi

  local recommend
  recommend="$(node -e '
    const pct = Number(process.argv[1]);
    let r = Math.ceil(pct * 2) / 2;
    if (r <= pct) r += 0.5;
    console.log(Math.round(r * 10) / 10);
  ' "${pct}")"

  echo "重複率：         ${pct}%（jscpd）"
  MEAS_JSCPD_PCT="${pct}"
  MEAS_JSCPD_RECOMMEND="${recommend}"
  MEAS_JSCPD_OK=true
}

print_recommend_summary() {
  echo ""
  echo "建議起始門檻（依 baseline-strategy.md「設在目前最差值，讓它不再退步」）"
  if ${MEAS_OK}; then
    echo ".ts  max-lines-per-function: ${MEAS_TS_RECOMMEND:-N/A}"
    echo ".tsx max-lines-per-function: ${MEAS_TSX_RECOMMEND:-N/A}"
    echo "max-depth: ${MEAS_DEPTH_RECOMMEND:-N/A}    max-lines: ${MEAS_FILELINES_RECOMMEND:-N/A}    complexity: ${MEAS_COMPLEXITY_RECOMMEND:-N/A}"
  else
    echo "ESLint 量測失敗，沿用 thresholds.md 建議值（.ts 50 / .tsx 150 / complexity 15 / max-depth 4 / max-lines 200）。"
  fi
  if ${MEAS_JSCPD_OK}; then
    echo "jscpd threshold: ${MEAS_JSCPD_RECOMMEND}"
  else
    echo "jscpd threshold: 沿用建議值 3（未量測）"
  fi
}

# ─── 通用檔案寫入：絕不覆蓋既有檔案，先備份再寫 ──────────────────────────────

copy_with_backup() {
  local src="$1"
  local dest="$2"
  local ts backup

  if [ -f "${dest}" ]; then
    ts="$(date +%Y%m%d-%H%M%S)"
    backup="${dest}.bak-${ts}"
    if [ "${ACTION}" = "write" ]; then
      cp "${dest}" "${backup}"
      echo "既有檔案已備份：${backup}"
    else
      echo "[dry-run] 既有檔案將備份為：${backup}"
    fi
  fi

  if [ "${ACTION}" = "write" ]; then
    cp "${src}" "${dest}"
    echo "已寫入：${dest}"
  else
    echo "[dry-run] 將寫入：${dest}"
  fi
}

# ─── ESLint 規則 ─────────────────────────────────────────────────────────────

plan_eslint_flat() {
  local mode_arg="$1"
  local guardrails_dest="${PROJECT_DIR}/eslint-guardrails.mjs"
  copy_with_backup "${ASSETS_DIR}/eslint-guardrails.mjs" "${guardrails_dest}"

  local target="${PROJECT_DIR}/${ESLINT_FLAT_FILE}"
  local import_line="import guardrails from './eslint-guardrails.mjs'"
  local spread_line

  if [ "${mode_arg}" = "existing" ]; then
    spread_line="  ...guardrails({ mode: 'existing', overrides: { tsFunctionLines: ${MEAS_TS_RECOMMEND:-50}, tsxFunctionLines: ${MEAS_TSX_RECOMMEND:-150}, complexity: ${MEAS_COMPLEXITY_RECOMMEND:-15}, maxDepth: ${MEAS_DEPTH_RECOMMEND:-4}, maxLines: ${MEAS_FILELINES_RECOMMEND:-200} } }),"
  else
    spread_line="  ...guardrails({ mode: 'new' }),"
  fi

  if grep -q "eslint-guardrails.mjs" "${target}" 2>/dev/null; then
    echo "${ESLINT_FLAT_FILE} 裡已經有 eslint-guardrails.mjs 的 import，跳過修改。"
    return 0
  fi

  local last_line export_count is_simple_end
  last_line="$(tail -n 1 "${target}" | tr -d '[:space:]')"
  export_count="$(grep -c 'export default \[' "${target}" 2>/dev/null | tr -d ' ')"
  is_simple_end=false
  if [ "${last_line}" = "]" ] || [ "${last_line}" = "];" ]; then
    is_simple_end=true
  fi

  if [ "${export_count}" = "1" ] && ${is_simple_end}; then
    if [ "${ACTION}" = "write" ]; then
      local ts backup
      ts="$(date +%Y%m%d-%H%M%S)"
      backup="${target}.bak-${ts}"
      cp "${target}" "${backup}"
      echo "既有 ${ESLINT_FLAT_FILE} 已備份：${backup}"

      TARGET_FILE="${target}" IMPORT_LINE="${import_line}" SPREAD_LINE="${spread_line}" node -e '
        const fs = require("fs");
        const target = process.env.TARGET_FILE;
        const importLine = process.env.IMPORT_LINE;
        const spreadLine = process.env.SPREAD_LINE;
        const content = fs.readFileSync(target, "utf8");
        const lines = content.split("\n");

        let lastImportIdx = -1;
        lines.forEach((l, i) => { if (/^import\s/.test(l)) lastImportIdx = i; });
        if (lastImportIdx >= 0) {
          lines.splice(lastImportIdx + 1, 0, importLine);
        } else {
          lines.unshift(importLine, "");
        }

        let closeIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          const t = lines[i].trim();
          if (t === "]" || t === "];") { closeIdx = i; break; }
        }
        if (closeIdx === -1) {
          console.error("找不到陣列結尾，未修改");
          process.exit(1);
        }
        lines.splice(closeIdx, 0, spreadLine);

        fs.writeFileSync(target, lines.join("\n"));
      '
      if [ $? -eq 0 ]; then
        echo "已在 ${ESLINT_FLAT_FILE} 加入 import 與 guardrails 展開。"
      else
        echo "自動修改失敗，請手動在 ${ESLINT_FLAT_FILE} 加入："
        echo "  ${import_line}"
        echo "  ${spread_line}（放進 export default 陣列最後一項）"
      fi
    else
      echo "[dry-run] 將在 ${ESLINT_FLAT_FILE} 加入："
      echo "  ${import_line}"
      echo "  ${spread_line}（陣列最後一項）"
    fi
  else
    echo "${ESLINT_FLAT_FILE} 不是單純的「export default [ ... ]」結尾格式，無法安全自動修改。"
    echo "請手動加入："
    echo "  ${import_line}"
    echo "  ${spread_line}"
  fi
}

plan_eslint_eslintrc() {
  local mode_arg="$1"
  local target target_desc mergeable

  if [ "${ESLINT_RC_FILE}" = "package.json" ]; then
    target="${PKG_JSON}"
    target_desc="package.json（eslintConfig 欄位）"
    mergeable=true
  else
    target="${PROJECT_DIR}/${ESLINT_RC_FILE}"
    target_desc="${ESLINT_RC_FILE}"
    case "${ESLINT_RC_FILE}" in
      .eslintrc|.eslintrc.json) mergeable=true ;;
      *) mergeable=false ;;
    esac
  fi

  if ! ${mergeable}; then
    echo "${target_desc} 不是純 JSON 格式，無法自動合併。請手動把以下內容併入你的 ESLint 設定："
    cat "${ASSETS_DIR}/eslintrc-guardrails.json"
    return 0
  fi

  local is_pkg="false"
  if [ "${ESLINT_RC_FILE}" = "package.json" ]; then
    is_pkg="true"
  fi

  local ts_rec="${MEAS_TS_RECOMMEND:-50}"
  local tsx_rec="${MEAS_TSX_RECOMMEND:-150}"
  local complexity_rec="${MEAS_COMPLEXITY_RECOMMEND:-15}"
  local depth_rec="${MEAS_DEPTH_RECOMMEND:-4}"
  local lines_rec="${MEAS_FILELINES_RECOMMEND:-200}"
  local merged_out="${TMP_DIR}/eslintrc-merged.json"
  local merge_err="${TMP_DIR}/eslintrc-merge-err.txt"

  MODE_ARG="${mode_arg}" TARGET_JSON="${target}" ASSET_JSON="${ASSETS_DIR}/eslintrc-guardrails.json" \
  IS_PKG="${is_pkg}" TS_REC="${ts_rec}" TSX_REC="${tsx_rec}" COMPLEXITY_REC="${complexity_rec}" \
  DEPTH_REC="${depth_rec}" LINES_REC="${lines_rec}" OUT_PATH="${merged_out}" \
  node -e '
    const fs = require("fs");
    const isPkg = process.env.IS_PKG === "true";
    const mode = process.env.MODE_ARG;
    const asset = JSON.parse(fs.readFileSync(process.env.ASSET_JSON, "utf8"));
    const target = JSON.parse(fs.readFileSync(process.env.TARGET_JSON, "utf8"));

    function applyLevel(rule) {
      if (!Array.isArray(rule)) return rule;
      const level = mode === "new" ? "error" : rule[0];
      return [level, rule[1]];
    }

    const rules = {
      complexity: applyLevel(["warn", Number(process.env.COMPLEXITY_REC)]),
      "max-depth": applyLevel(["warn", Number(process.env.DEPTH_REC)]),
      "max-lines": applyLevel(["warn", { max: Number(process.env.LINES_REC), skipBlankLines: true, skipComments: true }]),
      "max-lines-per-function": applyLevel(["warn", { max: Number(process.env.TS_REC), skipBlankLines: true, skipComments: true }]),
    };

    const overrides = JSON.parse(JSON.stringify(asset.overrides || []));
    if (overrides[0] && overrides[0].rules && overrides[0].rules["max-lines-per-function"]) {
      overrides[0].rules["max-lines-per-function"] = applyLevel(["warn", { max: Number(process.env.TSX_REC), skipBlankLines: true, skipComments: true }]);
    }

    const base = isPkg ? (target.eslintConfig || {}) : target;
    const mergedRules = Object.assign({}, base.rules, rules);
    const mergedOverrides = (base.overrides || []).concat(overrides);
    const mergedConfig = Object.assign({}, base, { rules: mergedRules, overrides: mergedOverrides });

    let finalObj;
    if (isPkg) {
      finalObj = Object.assign({}, target, { eslintConfig: mergedConfig });
    } else {
      finalObj = mergedConfig;
    }

    fs.writeFileSync(process.env.OUT_PATH, JSON.stringify(finalObj, null, 2) + "\n");
    console.log("合併後預覽已產生");
  ' 2>"${merge_err}"

  if [ ! -s "${merged_out}" ]; then
    echo "自動合併失敗（${target_desc} 格式無法解析），請手動把以下內容併入："
    cat "${merge_err}" >&2
    cat "${ASSETS_DIR}/eslintrc-guardrails.json"
    return 0
  fi

  if [ "${ACTION}" = "write" ]; then
    local ts backup
    ts="$(date +%Y%m%d-%H%M%S)"
    backup="${target}.bak-${ts}"
    cp "${target}" "${backup}"
    echo "既有 ${target_desc} 已備份：${backup}"
    cp "${merged_out}" "${target}"
    echo "已合併 ESLint 規則進 ${target_desc}"
  else
    echo "[dry-run] 將把以下規則合併進 ${target_desc}："
    echo "  complexity / max-depth / max-lines / max-lines-per-function（含 .tsx override）"
    echo "  數字：ts=${ts_rec} tsx=${tsx_rec} complexity=${complexity_rec} maxDepth=${depth_rec} maxLines=${lines_rec}"
  fi
}

plan_eslint_rules() {
  echo ""
  echo "== ESLint 規則（complexity / max-lines-per-function / max-depth / max-lines）=="

  local s_complexity s_funclen s_depth s_lines
  s_complexity="$(dj items.complexity.status)"
  s_funclen="$(dj items.maxLinesPerFunction.status)"
  s_depth="$(dj items.maxDepth.status)"
  s_lines="$(dj items.maxLines.status)"

  if [ "${s_complexity}" = "已有" ] || [ "${s_funclen}" = "已有" ] || [ "${s_depth}" = "已有" ] || [ "${s_lines}" = "已有" ]; then
    echo "已有部分或全部規則（complexity=${s_complexity}, max-lines-per-function=${s_funclen}, max-depth=${s_depth}, max-lines=${s_lines}）。"
    echo "為避免蓋掉既有數字，整組跳過（上面逐項列出的狀態才是實情，別當成四項都有了）。"
    echo "要補齊缺的項目、或改 mode／調門檻數字，直接編輯 eslint.config 裡 guardrails({...}) 的參數；"
    echo "想讓本腳本重新產生，先刪掉那一行與 eslint-guardrails.mjs 再重跑。"
    return 0
  fi

  if [ "${ESLINT_FORMAT}" = "both" ] || [ "${ESLINT_FORMAT}" = "none" ]; then
    echo "ESLint config 格式是「${ESLINT_FORMAT}」，無法自動判斷該寫哪一份，停下來請你決定："
    if [ "${ESLINT_FORMAT}" = "both" ]; then
      echo "  同時存在 flat config 與 eslintrc，兩種都在用嗎？還是其中一份是遺留檔案？"
    else
      echo "  完全沒有 ESLint config，需要新建一份 flat config 嗎？"
    fi
    return 0
  fi

  if [ "${MODE}" = "existing" ] && ! ${MEAS_OK}; then
    echo "警告：量測失敗，以下門檻是 thresholds.md 建議值，不是量測結果，套用前請自行確認現況。"
  fi

  if [ "${ESLINT_FORMAT}" = "flat" ]; then
    plan_eslint_flat "${MODE}"
  elif [ "${ESLINT_FORMAT}" = "eslintrc" ]; then
    plan_eslint_eslintrc "${MODE}"
  fi
}

# ─── jscpd ───────────────────────────────────────────────────────────────────

plan_jscpd() {
  echo ""
  echo "== jscpd 重複偵測 =="
  local s_jscpd threshold dest final_cfg

  s_jscpd="$(dj items.duplicateDetection.status)"
  if [ "${s_jscpd}" = "已有" ]; then
    echo "已有，跳過。"
    return 0
  fi

  threshold="${MEAS_JSCPD_RECOMMEND:-3}"
  dest="${PROJECT_DIR}/.jscpd.json"
  final_cfg="${TMP_DIR}/jscpd-final.json"

  THRESHOLD="${threshold}" ASSET_PATH="${ASSETS_DIR}/jscpd.json" OUT_PATH="${final_cfg}" node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync(process.env.ASSET_PATH, "utf8"));
    cfg.threshold = Number(process.env.THRESHOLD);
    fs.writeFileSync(process.env.OUT_PATH, JSON.stringify(cfg, null, 2) + "\n");
  '

  if ${MEAS_JSCPD_OK}; then
    echo "threshold 設為 ${threshold}（依量測結果）"
  else
    echo "threshold 設為 ${threshold}（未量測，沿用建議值）"
  fi
  copy_with_backup "${final_cfg}" "${dest}"
  echo "請自行安裝：npm i -D jscpd"
}

# ─── pre-commit（husky） ─────────────────────────────────────────────────────

append_lintstaged_line_if_missing() {
  local hook_file="$1"
  local hook_line="npx lint-staged"

  if grep -q "lint-staged" "${hook_file}" 2>/dev/null; then
    echo "偵測到 ${hook_file} 已含 lint-staged，跳過附加。"
    return 0
  fi

  if [ "${ACTION}" = "write" ]; then
    printf '%s\n' "${hook_line}" >>"${hook_file}"
    echo "已在 ${hook_file} 附加一行：${hook_line}"
  else
    echo "[dry-run] 將在 ${hook_file} 附加一行：${hook_line}"
  fi
}

plan_precommit() {
  echo ""
  echo "== pre-commit（husky）=="
  local s_precommit note_precommit hook_file
  s_precommit="$(dj items.preCommit.status)"
  note_precommit="$(dj items.preCommit.note)"
  hook_file="${PROJECT_DIR}/.husky/pre-commit"

  if [ "${s_precommit}" = "已有" ]; then
    if [ "${note_precommit}" = "husky" ] && [ -f "${hook_file}" ]; then
      append_lintstaged_line_if_missing "${hook_file}"
    else
      echo "已偵測到其他形式的 pre-commit（${note_precommit}），不動它。若要接上 lint-staged，請自行加入：npx lint-staged"
    fi
    return 0
  fi

  echo "缺 pre-commit hook。請先自行執行："
  echo "  npx husky init"
  if [ -f "${hook_file}" ]; then
    append_lintstaged_line_if_missing "${hook_file}"
  else
    echo "（${hook_file} 目前不存在，跑完 npx husky init 後重新執行本腳本即可自動附加 npx lint-staged）"
  fi
}

# ─── lint-staged ─────────────────────────────────────────────────────────────

plan_lintstaged() {
  echo ""
  echo "== lint-staged =="
  local s_lintstaged dest
  s_lintstaged="$(dj items.lintStaged.status)"
  if [ "${s_lintstaged}" = "已有" ]; then
    echo "已有，跳過。"
    return 0
  fi
  dest="${PROJECT_DIR}/lint-staged.config.mjs"
  copy_with_backup "${ASSETS_DIR}/lint-staged.config.mjs" "${dest}"
  if [ "${s_lintstaged}" = "部分" ]; then
    # 套件裝了但沒設定：這正是 pre-commit 會每次都失敗的成因，設定補上就好，不用再叫他裝
    echo "（套件已安裝，這裡補的是缺的設定檔——沒有設定時 npx lint-staged 會讓每一次 commit 都失敗）"
  else
    echo "請自行安裝：npm i -D lint-staged"
  fi
}

# ─── 主流程 ──────────────────────────────────────────────────────────────────

echo "專案：${PROJECT_DIR}"
echo "模式：${MODE_LABEL}    框架：${FRAMEWORK}    ESLint config：${ESLINT_FORMAT}"
echo ""

if [ "${ACTION}" = "measure" ]; then
  run_measurement
  run_jscpd_measure
  print_recommend_summary
  exit 0
fi

NEED_ESLINT_MEASURE=false
NEED_JSCPD_MEASURE=false
if [ "${MODE}" = "existing" ]; then
  s_complexity="$(dj items.complexity.status)"
  s_funclen="$(dj items.maxLinesPerFunction.status)"
  s_depth="$(dj items.maxDepth.status)"
  s_lines="$(dj items.maxLines.status)"
  s_jscpd="$(dj items.duplicateDetection.status)"

  if [ "${s_complexity}" != "已有" ] && [ "${s_funclen}" != "已有" ] && [ "${s_depth}" != "已有" ] && [ "${s_lines}" != "已有" ] \
     && [ "${ESLINT_FORMAT}" != "both" ] && [ "${ESLINT_FORMAT}" != "none" ]; then
    NEED_ESLINT_MEASURE=true
  fi
  if [ "${s_jscpd}" != "已有" ]; then
    NEED_JSCPD_MEASURE=true
  fi
fi

if ${NEED_ESLINT_MEASURE} || ${NEED_JSCPD_MEASURE}; then
  echo "既有專案，套用前先量現況："
  if ${NEED_ESLINT_MEASURE}; then
    run_measurement
  fi
  if ${NEED_JSCPD_MEASURE}; then
    run_jscpd_measure
  fi
  print_recommend_summary
  echo ""
fi

if [ "${ACTION}" = "write" ]; then
  echo "==== 開始套用（--write，會真的寫入檔案）===="
else
  echo "==== dry-run 計畫（不會寫入任何檔案，加 --write 才真的套用）===="
fi

plan_eslint_rules
plan_jscpd
plan_precommit
plan_lintstaged

echo ""
if [ "${ACTION}" = "write" ]; then
  echo "套用完成。務必依 SKILL.md 第 6 步驗證：npx eslint .、分軌驗證（.tsx 不噴／.ts 噴）、pre-commit 實測。"
else
  echo "以上是 dry-run 計畫。確認沒問題後加 --write 重新執行才會真的寫入。"
fi
