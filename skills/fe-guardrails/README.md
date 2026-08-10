# fe-guardrails

檢查前端專案有沒有裝好機器擋得住的品質關卡，缺的提示、核可後代裝。

## 為什麼有這支 skill

repo 裡其他 review skill（`fe-code-review`、`fe-mr-review`）產出的是**建議**——人或 AI 讀了才會照做。這支裝的是 **pre-commit 硬閘**，機器直接擋，不看心情。

補的是兩個具體缺口：

- 沒有任何靜態分析門檻。過去全 repo 唯一的複雜度數字是 `fe-mr-review-html/references/severity-system.md` 的「過長函式 >80 行」，而且只是報告分級用語、不是閘門
- 檢查全部發生在 push 或 review 階段，沒有 shift-left 到 commit

## 檢查什麼

10 個檢查項，每項標 `已有` / `部分` / `缺` / `N/A`：

| 項目 | 為什麼 |
|---|---|
| ESLint `complexity` | 分支太多的函式，測試寫不完也讀不動 |
| ESLint `max-lines-per-function` | 函式無限膨脹，`.ts` 與 `.tsx` **分軌** |
| ESLint `max-depth` | 巢狀爆炸 |
| ESLint `max-lines` | 單檔失控 |
| jscpd 重複偵測 | 擋 AI「重新生成而非重用」的傾向 |
| husky（pre-commit） | 讓上面幾項真的在 commit 當下擋住 |
| lint-staged | 只檢查改到的檔，舊檔不被拖下水 |
| coverage 門檻 | vitest / jest 的 threshold 設定 |
| TS `strict` | `rules/typescript.md` 已要求，順手一起驗 |
| TS `noUncheckedIndexedAccess` | 同上 |

標頭另外顯示：專案路徑、框架（Next.js / Vite / CRA）、測試框架、**ESLint config 格式**（flat / eslintrc / both / none）。

「部分」不是湊數的狀態，它代表**機制裝了但設定沒補完**，修法跟「缺」不一樣：

| 情境 | 為什麼要跟「缺」分開 |
|---|---|
| `husky` 裝了、`.husky/pre-commit` 不存在 | 只要補 hook，不必重裝 |
| `lint-staged` 裝了、沒有任何設定 | **最危險的一種**：`npx lint-staged` 會以 `could not find any valid configuration` 失敗，等於每一次 commit 都被擋。護欄看起來很嚴格，實際上一條規則都沒檢查，使用者很快就會把 hook 拿掉 |
| `tsconfig.json` 有 `extends`、本檔沒寫 `strict` | 值可能繼承自被 extends 的檔，腳本不遞迴解析，誠實標明未解析 |

規則偵測優先用 `eslint --print-config` 拿 resolved config；拿不到才 fallback 到 grep，並在輸出標「淺層偵測，可能不準」——flat config 常把規則 import 進來，grep 掃不到。

## 用法

```bash
# 唯讀偵測，隨便跑
bash scripts/detect.sh [專案路徑]
bash scripts/detect.sh --json          # 機器可讀

# 既有專案：先量現況
bash scripts/apply.sh --measure [專案路徑]

# 套用（預設 dry-run）
bash scripts/apply.sh --dry-run [專案路徑]
bash scripts/apply.sh [專案路徑]
```

## 流程

| 步驟 | 做什麼 |
|---|---|
| 1 | `detect.sh` 唯讀偵測，輸出現況表 |
| 2 | 判斷新專案 vs 既有專案（決定門檻取哪一欄） |
| 3 | 報告現況＋建議，**問使用者要不要裝** |
| 4 | 既有專案先 `--measure` 量 baseline |
| 5 | `--dry-run` 看過再真的套用，逐項核可 |
| 6 | 驗證：`npx eslint .`、分軌驗證、pre-commit 實測 |

## 安全邊界

| 規則 | 說明 |
|---|---|
| `detect.sh` 純唯讀 | 不寫任何檔 |
| `apply.sh` 預設 dry-run | 真的寫入要使用者明確說「裝吧 / apply」 |
| 既有專案先量再設 | 不准直接套建議數字，否則一開就噴幾百條、然後整包被關掉 |
| 不動既有規則 | 只加 guardrails 區塊 |
| 格式不支援就拒絕 | 不寫出載不起來的 config |

## 為什麼函式長度要按副檔名分軌

React function component 本身就是一個 function。一支回傳 80 行 JSX 的 `function UserProfileCard()` 會違反 50 行規則，但完全符合 `component-patterns.md`「單一元件不超過 200 行」的既有規範。

把 JSX 跟純邏輯放進同一個門檻，結果是幾乎每支非 trivial 元件都噴——然後有人把規則關掉，護欄等於沒裝。所以 `.ts` 用 50、`.tsx` 用 150，兩者都跳過空行與註解。

## 檔案結構

```
fe-guardrails/
├── SKILL.md                        # Agent 指令（步驟 1-6）
├── README.md                       # 本檔
├── scripts/
│   ├── detect.sh                   # 唯讀偵測七項
│   └── apply.sh                    # 套用，預設 dry-run，支援 --measure
├── references/
│   ├── thresholds.md               # 門檻數字與依據（單一真相來源）
│   └── baseline-strategy.md        # 既有專案漸進導入
└── assets/
    ├── eslint-guardrails.mjs       # ESLint flat config 片段
    ├── jscpd.json
    └── lint-staged.config.mjs
```

## 與其他 skill 的關係

`references/thresholds.md` 是**全 repo 靜態分析門檻的單一真相來源**。`fe-code-review` 與 `fe-mr-review` 的數字檢查項引用同一份，不各自寫死——比照 `fe-arch` 當架構規範單一真相來源的模式。

調整門檻只改 `thresholds.md`，引用方不用動。
