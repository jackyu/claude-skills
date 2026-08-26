# fe-ask-me-why

針對你正在開發的 branch，AI 扮演 reviewer／面試官逐題反問「為什麼這樣做」「為什麼不那樣做」「API 回什麼你怎麼接」；答不出來就切換成導師講給你聽，最後產出掌握度報告寫進 Heptabase。

## 為什麼要有這支

AI vibe coding 之後，規劃和實作都交出去了，diff 太大沒時間看就放行，久了自己對專案的掌控度越來越低。Code review 被問「為什麼要這樣做」答不出來，會議上也給不出具體建議。這支 skill 用最像真人 reviewer 的方式把理解逼回來。

## 怎麼用

```
/fe-ask-me-why            # 考當前 branch 對 origin/main 的 diff
考我 features/orders     # 指定檔案或目錄
grill 我一下這次改的 API 串接
```

## 流程

| 步驟 | 做什麼 |
|---|---|
| 1 拿素材 | `git diff origin/main...HEAD` 加未 commit 改動；diff 空就改考指定檔案；超過 500 行請你挑 2–3 個區塊；問有沒有 MR，有就貼連結拿標題與 URL |
| 2 備題庫 | 一次備 5–7 題，每題先寫好標準答案與常見誤解才問；題型四類：為什麼這樣做、為什麼不那樣做、API 契約、影響範圍 |
| 3 一題一答 | 每題綁 `檔案:行號`，你打字回答，AI 評 ✅／🟡／❌，最多追問一次；不接受「大概知道」；每題的題目、你的原文回答、評分、講評逐題記進 `qa-log.md` |
| 4 導師模式 | 你說不知道就講解（需要時叫 fe-show-me 畫圖），講完換個角度再問一次同一觀念 |
| 5 掌握度報告 | 標題 `[審查測驗] <MR 標題>`、開頭放 MR 連結；懂／半懂／不懂表格（Heptabase 用 `<hepta-table>` 包，不用裸 markdown table）、reviewer 可能追問的三題、補課紀錄，最後附完整考古題（每題 toggle：題目／你的原文回答／評分／講評）；寫進 Heptabase，MCP 不在就落 `.claude/notes/<project_name>/`（依專案名分一層） |

## 硬規則

- 題目不用選擇題（禁 AskUserQuestion 出題）——選擇題只測認得出，不測講得出。
- 一輪最多 7 題，到了就收。
- 「不知道」不是脫逃出口：講完會再問一次；連續兩題不知道會先暫停補課，不硬考完。
- 你答得比標準答案好，會記進報告的「值得保留的洞見」。
- 導師模式的圖只在資料流／狀態流轉／請求時序三種情境畫，沿用 `_shared/fe-mr-common/diagram-rules.md`。

## 檔案結構

```
fe-ask-me-why/
├── SKILL.md                      # Step 1–5 工作流程
├── README.md
└── references/
    └── report-template.md        # 掌握度報告模板
```

共用判準（難度分級、學習標籤、流程圖規則、寫作語氣）引用 `skills/_shared/fe-mr-common/`。

## 與其他 skill 的關係

開發中 `fe-ask-me-why`（確認自己懂）→ review 前 `fe-mr-walkthrough`（看懂別人的）→ 合併後 `fe-mr-digest`（沉澱成筆記）。導師模式的圖交給 `fe-show-me`。
