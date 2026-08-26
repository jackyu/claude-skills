# teach-me

用六步學習法帶你學任何主題：拆 5 級階梯 → 鎖定最重要的 20% 排 10 課 → 一次一題當考官 → 壓成一頁速查表 → 篩 5 個驗證過的資源 → 費曼復述補漏。進度存在當前 repo，跨 session、跨機器自動接續。

## 為什麼要有這支

「幫我學 Python」得到一大段解釋，當下看懂、兩天就忘。真正有效的是：先拿到地圖、只學最重要的那塊、學完立刻被考、把它壓成一頁會在工作路徑上自己出現的東西。這支 skill 把六步變成可以每天接續的流程，而且是 pure skill——不依賴本機其他 skill 或 agent，網頁版 Claude Code 也能用。

## 怎麼用

```
/teach-me                    # 自動接續：沒主題就開新主題，有進度就接下一步
/teach-me ladder             # 搭 5 級階梯
/teach-me plan               # 排 10 課計畫
/teach-me quiz               # 考下一課（或到期該復習的課）
/teach-me cheatsheet         # 把剛考完的課壓成一頁
/teach-me resources          # 篩 5 個資源＋7 天路徑
/teach-me feynman            # 費曼復述補漏
教我 Python async
考我 git rebase 觀念
```

## 流程

| 模式 | 做什麼 | 產物 |
|---|---|---|
| ladder | L1–L5，每級列必懂概念、常見錯誤、2–3 個練習、過關標準；程式類主題過關標準必須是可驗證產物 | `ladder.md`、建 `progress.md` |
| plan | 帕累托 20%：10 課、每課一個小主題、附課後那一題 | `plan.md`、`progress.md` 各課填未開始 |
| quiz | 先備標準答案再問、一次一題、打字答、✅🟡❌、不知道就切導師講解再換角度重問；考完更新 next-review | `progress.md` |
| cheatsheet | 定義／核心概念／例子／常見錯誤／檢查清單／自測題，最後一定問「要嵌進哪個必經路徑」 | `cheatsheets/*.md`（＋Heptabase 卡） |
| resources | 5 個資源，每個 WebSearch／WebFetch 驗證存在，標適合誰、難度、可跳過段落；排 7 天路徑 | `resources.md` |
| feynman | 12 歲版講解 → 你復述 → 找洞（該課狀態最多標 🟡）→ 記回 progress | `progress.md` |

無參數時讀 `progress.md` 決定下一步：沒主題 → ladder；多個主題 → 先挑一個；有階梯沒計畫 → plan；上一課 ❌ 沒補課 → 重考；有課到期 → quiz 復習；上一課考過沒速查表 → cheatsheet；其餘 → quiz 下一課。

## 硬規則

- 題目不用選擇題（禁 AskUserQuestion 出題）——選擇題只測認得出，不測講得出。
- 一輪最多 7 題；連續兩題不知道先暫停補課。
- 速查表不問「嵌進哪個必經路徑」不算完成。
- 資源清單每一筆都要驗證 URL 存在，找不到 5 個好的就寫 3 個，不湊數。
- 進度只存在 `<cwd>/.claude/learn/<slug>/`，要 commit 才能跨機器續學；不靠 `~/.claude/`。
- Heptabase 是選配，MCP 不在就只留 repo 檔，不算失敗。

## 檔案結構

```
teach-me/
├── SKILL.md                        # 入口判斷＋六個模式
├── README.md
└── references/
    ├── ladder-template.md          # 5 級階梯骨架
    ├── plan-template.md            # 10 課計畫骨架
    ├── progress-template.md        # 進度檔欄位定義與 next-review 規則
    ├── cheatsheet-template.md      # 一頁速查表骨架（含放置位置欄）
    └── visual-forms.md             # 何時畫圖、Mermaid 與文字樹範例
```

學習進度落在被學習的那個 repo：

```
<cwd>/.claude/learn/<slug>/
├── progress.md
├── ladder.md
├── plan.md
├── resources.md
└── cheatsheets/<lesson-slug>.md
```

## 與其他 skill 的關係

純主題學習用 `teach-me`；題目要綁 branch diff 或專案程式碼時用 `fe-ask-me-why`（有裝的話）。兩支不互相依賴。
