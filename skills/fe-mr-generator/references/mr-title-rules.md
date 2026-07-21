# MR Title 規則

產生 MR Title 時依此檔。先判斷專案，再套用對應規則。

## 通用規則（所有專案）

- 直接使用執行 Issue 原本的 title，不改寫
- 若為 Subtask，在 Issue title 後加 ` - <subtask title>`
- Issue ID 使用 `[#xxx]` 前綴標記

基本格式：

| 情境 | 格式 | 範例 |
|------|------|------|
| 有對應 Issue | `[#<issue_id>] <issue title>` | `[#269] 會員清單頁面擴充` |
| 有對應 Subtask | `[#<subtask_issue_id>] <issue title> - <subtask title>` | `[#270] 會員清單頁面擴充 - 搜尋篩選功能` |
| 無對應 Issue | `<簡短描述>` | `會員清單頁面擴充` |

---

## 專案判斷

看**目錄結構**，不看 repo 名：

```bash
ls apps 2>/dev/null   # 存在且底下有多個 app → monorepo
```

- 有 `apps/*` 的 monorepo → 套用「monorepo 規則」
- 單一應用（無 `apps/`）→ 套用「單一應用規則」

---

## monorepo 規則

典型目錄結構：

| 目錄 | 用途 |
|------|------|
| `apps/client` | 前台應用 |
| `apps/admin` | 後台應用 |
| `packages/ui` | 共用元件 |
| `packages/config` | 共用設定 |
| `packages/utils` | 共用函式 |

> **前綴詞可依專案調整**：下方用「前台／後台」作為通用詞。若專案有慣用說法（例如加上業務領域名），在專案的 `CLAUDE.md` 或 `~/.claude/rules/` 定義對照表，本檔規則照用。

在通用規則之上，**依本次變更的檔案路徑**推導前綴。

判斷依據（看變更落在哪些目錄）：

```bash
git diff --name-only main..HEAD
```

前綴決策（由上往下，先成立者採用）：

| 變更涉及 | 前綴詞 |
|---------|--------|
| `apps/client` 與 `apps/admin` 都有 | `前/後台` |
| 只有 `apps/client`（可同時含 `packages/*`）| `前台` |
| 只有 `apps/admin`（可同時含 `packages/*`）| `後台` |
| 完全沒動 apps，只動 `packages/*` | `共用` |

> `packages/*` 是共用層，會同時影響前後台。只要變更**有觸及某個 app**，前綴就以該 app 為準（共用變更視為支援它）；唯有**整個 MR 只動共用層、沒碰任何 app** 時，才標 `共用`。

完整格式：`[#{issue id}][{前綴詞}] {title}`

- 前綴詞外層用 `[]` 包住
- `[{前綴詞}]` 與 `{title}` 之間保留**一個半形空白**作區隔
- 前綴由路徑推導，不要從 issue title 手動嵌入

範例：

- 只動 `apps/client`：`[#312][前台] 身分驗證流程調整`
- 只動 `apps/admin`：`[#312][後台] 身分驗證流程調整`
- 兩個 app 都動：`[#312][前/後台] 身分驗證流程調整`
- 只動 `packages/ui`：`[#312][共用] Button 元件 hover 樣式調整`

無對應 issue id 時：省略 `[#id]`，保留前綴 → `[前台] 身分驗證流程調整`

偵測 snippet（給 agent 自動判斷前綴）：

```bash
files=$(git diff --name-only main..HEAD)
client=$(echo "$files" | grep -q '^apps/client/' && echo 1)
admin=$(echo "$files" | grep -q '^apps/admin/' && echo 1)
if [ "$client" = 1 ] && [ "$admin" = 1 ]; then echo "前/後台"
elif [ "$client" = 1 ]; then echo "前台"
elif [ "$admin" = 1 ]; then echo "後台"
else echo "共用"; fi
```

---

## 單一應用規則

- **有對應 issue id**：一律加上 `[#{issue id}]`
- **找不到對應 issue id**：可不加，直接寫描述
