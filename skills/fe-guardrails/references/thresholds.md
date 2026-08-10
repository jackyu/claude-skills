# 品質門檻數字與依據

本檔是**全 repo 靜態分析門檻的單一真相來源**。`fe-code-review`、`fe-mr-review` 的數字檢查項一律引用這裡，不各自寫死。

新增或調整門檻只改這一份，引用方不用動。

---

## 門檻表

### 函式長度 `max-lines-per-function`

**必須按副檔名分軌。** React function component 本身就是一個 function——一支回傳 80 行 JSX 的 `function UserProfileCard()` 會違反 50 行規則，卻完全符合「單一元件不超過 200 行」的既有規範。把 JSX 跟純邏輯混在同一個門檻，結果就是整包被關掉。

| 檔案 | 新專案 | 既有專案 | 依據 |
|---|---|---|---|
| `**/*.ts` | error 50 | warn 50 / error 80 | 一般函式超過 50 行通常該拆。80 對齊 `fe-mr-review-html/references/severity-system.md` 的 medium 分級 |
| `**/*.tsx` | error 150 | warn 150 | JSX 撐行數，跟邏輯複雜度不是同一回事 |

兩者一律加 `{ skipBlankLines: true, skipComments: true }`——空行與註解不該算進來，否則會逼人寫得更擠、更難讀。

### 其餘門檻

| 項目 | 新專案 | 既有專案 | 依據 |
|---|---|---|---|
| `complexity` | error 15 | warn 15 | cyclomatic complexity。前端要注意：多重條件渲染的元件容易破 15，**既有專案務必先量再設** |
| `max-depth` | error 4 | warn 4 | 巢狀四層以上通常代表該抽函式或提早 return |
| `max-lines`（單檔） | error 200 | warn 200 | 對齊 `~/.claude/rules/component-patterns.md`「單一元件檔案不超過 200 行，超過就拆分」 |
| jscpd 重複率 | threshold 3%、min-lines 5 | 先量 baseline，設成「不得退步」 | min-lines 5 抓的是「複製貼上一小段」這種最常見的 AI 產出模式 |
| coverage | line 70 / branch 60 | 同左 | 對齊 `~/.claude/rules/testing.md` 與 `coverage-check.sh` 的既有門檻，不另立標準 |

### TypeScript 嚴格度

不是數字門檻，但屬同一類「機器可驗的底線」，`detect.sh` 一併偵測：

| 選項 | 要求 | 依據 |
|---|---|---|
| `strict` | 必開 | `~/.claude/rules/typescript.md`「不可關閉」 |
| `noUncheckedIndexedAccess` | 必開 | 同上，「確保陣列存取安全」 |

---

## 新專案 vs 既有專案，為什麼要分軌

新專案沒有歷史包袱，直接 error 擋住，第一天就不會累積。

既有專案直接套 error 會一次噴出幾百條，接著發生的事幾乎是必然的：有人把規則關掉，或加一行 `eslint-disable` 蓋過去，護欄等於沒裝。所以既有專案的順序是：

1. 先**量**——現在幾支函式超標、最長幾行、重複率多少
2. 用量到的數字決定起始門檻（可能比建議值寬）
3. 先 warn 不 error，確認 CI 不會紅
4. 之後逐步收緊

完整做法見 `baseline-strategy.md`。

**`apply.sh` 在既有專案模式一定會先跑量測並印出來**，不是直接套表格上的數字。

---

## 給 review skill 引用的檢查項

`fe-code-review` / `fe-mr-review` 引用本檔時，用這組可逐項核對的判準：

| 檢查項 | 判準 | 沒超標時要怎麼寫 |
|---|---|---|
| 函式長度 | `.ts` >50 行、`.tsx` >150 行（不含空行註解） | 「掃過 N 支函式，最長 M 行，未超標」 |
| 巢狀深度 | >4 層 | 「最深 N 層」 |
| 單檔行數 | >200 行 | 「最大檔 N 行」 |
| 重複邏輯 | 連續 ≥5 行實質重複 | 「未發現 5 行以上重複區塊」 |
| 條件複雜度 | 單一函式分支數 >15 | 「最高 N」 |

**沒超標也要明講掃了什麼、數字多少。** 只寫「無異常」的話，分不出是驗過沒事還是根本沒看——這跟 `fe-code-review` 對爆炸半徑、無害區挑戰的要求是同一條原則。

---

## 這些門檻擋得住什麼、擋不住什麼

擋得住：函式無限膨脹、複製貼上、巢狀爆炸、單檔失控。這幾樣正好是 AI 產出程式碼最容易累積的問題（GitClear 對 2020-2024 年 2.11 億行的分析：5 行以上重複區塊增加 8 倍、重構佔比從 25% 掉到 10% 以下）。

擋不住：命名爛、抽象層次錯、業務邏輯錯、狀態管理設計錯。這些還是得靠 `fe-code-review` 的兩軸審查與人。

**別把靜態門檻當成 review 的替代品**，它只是把「機器能判的事」從人的注意力裡移出去，讓人專心看機器判不了的部分。
