# 發文、組串、寫描述

note id 要發文成功才拿得到，「接著看 → 下一則」又需要下一則的 id。所以分三段：先全部發完收齊 id（A），再回頭補尾行（B），最後把地圖和 data 寫進描述（C）。

`diff_refs` 一律用 Step 0 確認 head 對上的那份。

## Phase A：發文

排序：有 `order` 的導引項照 `1 → 1.1 → 1.2 → 2 → 2.1 → 3…`，沒有 `order` 的補充項全部排在後面。

每則先送「首行＋純內容」，尾行等 Phase B：

```
🤖💬 [2/5] <title>

<body>
```

- 主要點首行 `🤖💬 [i/M] <title>`，i 是第幾個主要點、M 是主要點總數（有人回覆過、沒進串的不算）
- 次要點首行 `🤖💬 [2.1] <title>`
- 補充項首行 `🤖💬 [補充] <title，可省略>`

```bash
out=$(~/.claude/scripts/gitlab/mr-discussion.sh "<project>" <iid> \
  --file "<file>" --new-line <line> \
  --body "$(cat <body 檔>)" \
  --base-sha "<base_sha>" --start-sha "<start_sha>" --head-sha "<head_sha>" \
  2>"<scratchpad>/note-err-<n>.txt"); echo "exit=$?"
note_id=$(jq -r '.notes[0].id' <<<"$out")
discussion_id=$(jq -r '.id' <<<"$out")
```

- `side: old` 的改用 `--old-line <line>`
- 腳本會自己在 body 後面補 `<!-- mr:self-annotation -->`
- 每則記下 `note_id`、`discussion_id`，以及**發文當下那一行的原文**（從 diff 取，存進 data 的 `code`）
- exit 不是 0 → 這則失敗：`note_id`、`discussion_id` 記成 `null`，錯誤訊息從 err 檔取，繼續下一則
- 全部發完才進 Phase B

## Phase B：補「接著看」

把成功的導引項照順序串起來（有人回覆過的不進串）。串長度不到 2 → 跳過 Phase B，只有一則就留 `[1/1]`、不加尾行。Phase C 照樣要跑。

每則重新組裝完整 body，整則 PUT：

```
🤖💬 [2/5] <title>

<body>

接著看 → [[2.1] <下一則 title>](<web_url>#note_<下一則 note_id>)
```

- 連結文字是下一則的顯示標籤加 title
- 最後一則尾行改成 `🏁 導覽結束（共 <M> 個重點）`
- 補充項不掛尾行、不進串

```bash
~/.claude/scripts/gitlab/mr-note-update.sh "<project>" <iid> <note_id> \
  --body "$(cat <組好的 body 檔>)" --discussion "<discussion_id>"
```

body 一律從 data 的純內容重新組，不要把線上的 body 讀回來改：線上的 body 帶著上一輪的首行和尾行，讀回來改會疊在一起。單則失敗記成「這則缺導引」，不中止。

## Phase C：寫進描述

只要 Phase A 有發出任何一則，Phase C 就要跑，data 一定要寫進去，不然下次重跑找不到。

```markdown
<!-- mr:reading-map:start -->
**閱讀地圖**

1. [清單頁怎麼接上新篩選](<web_url>#note_101)
2. [篩選條件組裝](<web_url>#note_102)
   - [快取鍵設計](<web_url>#note_103)
3. [錯誤分流](<web_url>#note_104)

**有討論的註解**

- [舊的快取說明](<web_url>#note_099)

<!-- mr:reading-map:data <base64> -->
<!-- mr:reading-map:end -->
```

- 主要點是有序清單，次要點縮排成子清單；補充項不列
- 發文失敗的項目照列，但不帶連結
- 「有討論的註解」區只在有這種註解時才出現
- 清單只有補充項、沒有導引項時，省略「閱讀地圖」標題和清單，只留 data

**插在哪裡**（由上往下，先成立的採用）：

| 描述裡有 | 處理 |
|---------|------|
| `<!-- mr:reading-map:start -->`…`<!-- mr:reading-map:end -->` | 整塊替換 |
| `<!-- 閱讀地圖（選用）由另外的 skill 插在這裡 -->` | 用地圖區塊取代這一行 |
| 標題含 `Summary` 的 `## ` 行 | 往下找下一個 `## ` 標題行（跳過 ``` 圍起來的程式碼區塊），插在它前面；它前面緊鄰一行 `---` 的話，插在那行 `---` 之前。Summary 是最後一段、往下找不到標題時，插在 `<!-- mr:fe-mr-generator -->` 那一行之前 |
| 標題含 `為什麼要這樣做` 的 `## ` 行（舊格式） | 插在該標題行之後 |
| 都沒有 | 插在最上面 |

寫回並確認：

```bash
~/.claude/scripts/gitlab/mr-update.sh "<project>" <iid> --description "$(cat <新描述檔>)"
```

寫完重抓描述，確認 start／end 標記之間是新內容。`mr-update.sh` 失敗時不要重試整段流程：回報「閱讀地圖：寫入失敗」附錯誤訊息，並把整塊地圖（含 data）原樣印給使用者，讓他手動貼回描述。

## data 的格式

```json
[{ "order": "2", "title": "篩選條件組裝", "file": "…", "side": "new", "line": 42,
   "code": "<發文時那一行的原文>", "body": "<純內容>",
   "note_id": 102, "discussion_id": "…" }]
```

- 補充項的 `order`、`title` 可以是 null
- 發文失敗：`note_id`、`discussion_id` 是 null
- 有人回覆過、沒動的註解照樣留在 data，重跑時靠 discussions 判斷，不另外記欄位
- 重跑寫回時，沒過時那幾則的 `line` 要更新成目前的位置

用 base64 包起來，避免內容裡的 `-->` 提早結束 HTML 註解：

```bash
# 編碼
python3 -c 'import base64,sys; print(base64.b64encode(open(sys.argv[1],"rb").read()).decode())' <data.json>
# 解碼：從描述取出 base64 字串後
python3 -c 'import base64,sys; sys.stdout.write(base64.b64decode(sys.argv[1]).decode())' '<base64>'
```

## 失敗的後援

**這一次**新發生的發文失敗（重跑時，上次就失敗、這次又失敗的不算）→ 彙整成一則一般留言，每行 `<file>:<line> — <body>`，讓內容至少留在 MR 上：

```bash
~/.claude/scripts/gitlab/mr-note.sh "<project>" <iid> "$(cat <彙整檔>)"
```
