---
name: fe-guardrails
description: 偵測前端專案的程式碼品質護欄設定（複雜度門檻、函式長度、重複偵測、pre-commit 檢查、coverage 門檻、TS 嚴格度）是否齊備，缺的提示並可代為安裝。使用時機：(1) 新專案起手要建品質關卡, (2) 既有專案想補靜態分析門檻, (3) 用戶問「這專案有沒有擋複雜度／重複程式碼」, (4) 用戶提到 ESLint complexity、jscpd、husky、lint-staged、pre-commit hook, (5) 用戶說 AI 產出的程式碼品質在下滑、想加關卡, (6) 剛建好 worktree 或新專案想確認品質設定。即使只說「幫這專案加個品質關卡」也應觸發。
---

# fe-guardrails

檢查一個前端專案有沒有裝好「機器擋得住」的品質關卡，沒有就提示、核可後代裝。

定位：review skill 產出的是**建議**，人讀了才會照做；這裡裝的是 **pre-commit 硬閘**，機器直接擋。兩者互補，不互相取代。

## 安全邊界（硬性）

- `detect.sh` **純唯讀**，不寫任何檔。可以隨便跑。
- `apply.sh` **預設 dry-run**。真的寫入需要使用者明確說「裝吧 / apply / 執行」，且**逐項核可**，不是一次全裝。
- **既有專案不准直接套建議數字**。一定先量現況（幾支函式超標、最長幾行、重複率多少），拿實際數字決定起始門檻。跳過這步的下場是一開就噴幾百條，然後整包被關掉。
- 只加 guardrails 區塊，**不動既有 ESLint config 的其他規則**。
- ESLint config 格式不支援時**乾淨拒絕並說明**，不要寫出一個載不起來的 config。
- 不跑 `npm install` 以外的安裝行為；要裝套件前先問。

## 流程

### 1. 偵測（一定先做）

```bash
bash scripts/detect.sh [專案路徑]
```

省略路徑就用 cwd。`--json` 給機器讀。

輸出分兩塊：**標頭**（專案路徑、框架、測試框架、ESLint config 格式）與 **10 個檢查項**，每項標 `已有` / `部分` / `缺` / `N/A`：複雜度門檻、函式長度上限、巢狀深度、單檔行數、重複偵測、pre-commit、lint-staged、coverage 門檻、TS strict、TS noUncheckedIndexedAccess。

看輸出時注意兩件事：

- **ESLint config 格式**（flat / eslintrc / both / none）——決定後面能不能裝、要寫哪一種
- **偵測方法**——腳本優先用 `eslint --print-config` 拿 resolved config（準確）；拿不到才 fallback 到 grep 並在輸出標「淺層偵測，可能不準」。標了這句的項目**結論要保守**，別直接斷言「沒設」——flat config 常把規則 import 進來，grep 掃不到

沒有 `package.json` 會印出說明並正常結束（exit 0），不是錯誤。

### 2. 判斷這是新專案還是既有專案

這一刀決定後面所有門檻。判準：

```
有實質程式碼（src/ 或 app/ 下超過 20 個檔）→ 既有專案
剛 init、幾乎沒有程式碼          → 新專案
```

拿不準就當**既有專案**處理——多量一次的成本，遠低於噴爆之後被關掉。

### 3. 報告現況並提出建議

把 `detect.sh` 的結果整理成人看的版本，講清楚三件事：

1. 哪些已經有了（不用重裝）
2. 哪些缺，缺了會怎樣（用具體後果講，不要只說「不符合最佳實踐」）
3. 建議的門檻數字 — 讀 `references/thresholds.md`，**新舊專案取不同欄位**

**問使用者要不要裝，不要自己裝。**

### 4. 既有專案：先量 baseline

使用者說要裝之後，若是既有專案，先跑量測：

```bash
bash scripts/apply.sh --measure [專案路徑]
```

輸出實際分佈：幾支函式超過 50/80/150 行、最長幾行、最深幾層、重複率多少。

拿這組數字跟 `thresholds.md` 的建議值比對，決定起始門檻。詳細做法見 `references/baseline-strategy.md`。

現況離建議值很遠時，**明講「這批門檻先設在哪、之後怎麼收緊」**，不要假裝一次到位。

### 5. 套用（逐項核可）

```bash
bash scripts/apply.sh --dry-run [專案路徑]   # 先看會寫什麼
bash scripts/apply.sh [專案路徑]             # 真的寫
```

先跑 `--dry-run` 把將寫入的內容給使用者看過，再執行。

### 6. 驗證（不可略過）

裝完必須實測，不能只看檔案寫進去了就宣稱完成：

```bash
npx eslint .                    # config 載得起來、規則真的生效
```

再做**分軌驗證**——這是最容易翻車的一點：

- 找一支 80 行以上的 `.tsx` 元件跑 lint → **應該不噴**
- 找一支 60 行以上的 `.ts` 純函式跑 lint → **應該噴**

分軌沒生效的話，門檻等於設了會被關掉。

最後測 pre-commit：故意 commit 一個超標的 function，**確認真的被擋下**（要看到阻擋訊息，不是只看 exit code）。

## 常見狀況

| 狀況 | 怎麼處理 |
|---|---|
| 兩種 ESLint config 並存（flat + eslintrc） | 停下來問。ESLint 9 預設只讀 flat，但專案可能靠 `ESLINT_USE_FLAT_CONFIG` 切換，猜錯會寫到沒在用的那份 |
| 專案用 Biome / oxlint 不是 ESLint | 目前不支援，誠實說明，不要硬塞 ESLint |
| 裝完跑 `npx eslint` 出現 `Parsing error: Unexpected token` | 專案沒有 TS/JSX parser。guardrails 只給規則不給 parser，要靠既有 config 提供（Next.js 通常來自 `eslint-config-next`）。**這種狀態下規則一行都不會生效**，看起來像沒作用。先把 parser 補好再談門檻 |
| monorepo | 先問要裝在哪一層（root 還是各 package）。不要自作主張裝 root |
| 已有 pre-commit 但內容是別的東西 | 不覆蓋，改成附加一行，並把原內容展示給使用者確認 |
| `pre-commit` 或 `lint-staged` 顯示「部分」 | 意思是**機制裝了但設定沒補完**，跟「缺」的修法不同。`lint-staged` 停在這個狀態最危險——`npx lint-staged` 會以 `could not find any valid configuration` 失敗，導致**每一次 commit 都被擋**，使用者兩天內就會把 hook 拿掉。看到「部分」一定要補完，別跳過 |
| 既有專案量出來超標的有幾百處 | 這是正常的。門檻先設在「目前最差值」讓它不再退步，之後再收緊，不要建議一次修完 |

## 參考

- `references/thresholds.md` — 門檻數字與依據。**這是全 repo 的單一真相來源**，`fe-code-review`、`fe-mr-review` 也引用同一份
- `references/baseline-strategy.md` — 既有專案怎麼漸進導入
- `assets/` — 可直接套用的 config 範本
