# 素材蒐集與事實清單

三個來源：手打筆記、PM issue、GitLab 本期活動。三者匯成一份「事實清單」，之後寫進報告的每句話都必須能對回這份清單。

## 期間怎麼算

日期由 skill 自己算好再傳給腳本，不要在腳本裡算週一。macOS 的 `date` 是 BSD 版，`date -d`／`date -v-mon` 這類寫法跨平台會壞。

```bash
date +%F   # 今天，例如 2026-09-04
date +%u   # 星期幾，1 是星期一，7 是星期日
```

拿到這兩個值後自己算：本週一 = 今天減去 `(%u - 1)` 天。把算出來的兩個 `YYYY-MM-DD` 直接寫進指令。

預設區間是本週一到今日。`--until` 含當日整天。使用者說「上週」「這兩週」就照使用者說的往前推，推完把區間念給使用者確認。

日期用 API 回傳的 UTC 時間切日，台北時間早上合併的 MR 可能被算到前一天，跨日邊界的差異自己補進事實清單。「進行中的 issue」只靠 `updated_after` 篩下界，`--until` 對它無效。

## 來源一：手打筆記

請使用者貼進對話，或給檔案路徑讓你讀。原文先整段收進事實清單，不要邊讀邊摘要——摘要會把「我猜的」跟「我看到的」混在一起。

筆記裡的推測句（「我覺得應該是…」）照抄，但在事實清單標 🟡，不要當成事實。

## 來源二：PM issue

```bash
~/.claude/skills/_shared/fe-mr-common/scripts/issue-get.sh <issue_url>
```

也可以傳 `<project_path> <issue_iid>`。用法同 `../fe-issue/SKILL.md` 的 Phase 1.1。

腳本失敗就請使用者直接貼 issue 內容。要抓的是：標題、需求描述、驗收條件、相關連結。

## 來源三：GitLab 本期活動

```bash
bash ~/.claude/skills/a3-report/scripts/gitlab-activity.sh <project_path_or_id> --since YYYY-MM-DD --until YYYY-MM-DD [--author <username>|me] [--json]
```

cwd 在使用者專案裡，所以一律用這個絕對路徑（skill 由 install.sh 以 symlink 裝進 `~/.claude/skills/`）；沒裝到那裡就改用 repo 內的 `skills/a3-report/scripts/gitlab-activity.sh`。

預設輸出 Markdown 三段，各一張表（欄位：iid、title、author、labels、日期、web_url、描述中引用的 `#N`）：

- `## 本期合併的 MR`
- `## 本期關閉的 issue`
- `## 進行中的 issue`

`--author me` 只留自己的。`--json` 給機器讀，寫報告時用不到。

腳本一次抓 100 筆不翻頁，超過會在 stderr 印警告。看到警告就縮短區間再跑一次，不要無視。

**專案路徑怎麼來：** 從 `git remote get-url origin` 推算，推不出來就問使用者，慣例同 `../fe-issue/SKILL.md` 的「需要建立」一節。

**多專案：** `--project a/b,c/d` 時腳本跑多次，一個專案一次。合併進同一份事實清單，但每條保留專案前綴，例如 `[shop-web MR !12]`。兩個專案的 `!12` 會撞號，沒有前綴就分不出來。

**失敗 fallback：** 腳本掛掉就請使用者貼 MR／issue 清單。手貼的內容一樣要標來源，不因為是人貼的就省略標記。**任何情況都不准憑記憶補資料**——沒抓到就是沒抓到，寫進報告要標待確認。

## 事實清單格式

每條一行，開頭標來源：

```
[筆記] 這週三跟 PM 對過，結帳改版的驗收條件多了「支援 Apple Pay」
[issue #482] 驗收條件：結帳頁首屏 3 秒內完成渲染
[shop-web MR !312] 拆掉序列打的三支 API，改成並行，2026-09-02 合併
[shop-web MR !315] 修 Apple Pay 按鈕在 Safari 不顯示，2026-09-03 合併
[admin-web issue #77] 進行中，卡在後端還沒給 webhook 規格
[GA] 2026-08 結帳頁首屏月均 4.2 秒
```

規則：

1. 一條一件事，不要一行塞三件。
2. 數字連同出處寫在同一條，之後寫報告直接引用。
3. 推測標 🟡 並寫依據；缺的東西不入清單，改在報告裡標 🔴 待確認。
4. 外部數據（Sentry、GA、dashboard）也算一條，來源標記寫工具名。

## 硬規則

**清單裡沒有的事，不能出現在輸出。** 這條沿用 `../retro/SKILL.md` 的事實清單約束。真的需要提到但清單裡沒有，就用固定寫法標出來：

```
🔴 待確認：<缺什麼>，去哪拿：<Sentry／GA／某 dashboard／問誰>
```
