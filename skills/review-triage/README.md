# review-triage

> review 回來的 finding 和 reviewer 留言，動手修之前先逐筆判定是不是真的問題

## Purpose

AI code review、reviewer 在 MR 的留言，或自己審別人 MR 列出的 finding，常混著真 bug、誤報、提問和風格意見。直接照單全修，容易修了不存在的問題，或連續好幾輪都在修上一輪的修法。

這支 skill 只判定，不改程式、不 commit、不發 GitLab 留言。每筆先分成四類：指出 bug、質疑前提、提問、風格。

- **指出 bug**：從真實入口走一遍，確認使用者真的到得了那個狀態，判成確認、待驗證、撤銷、防禦性建議其中一種。需要時用 verify-admin／verify-client 實際起 app 走一次
- **質疑前提**：追出處（spec、issue 裁決、ADR），給使用者「保留／推翻」兩案，不自己選
- **修正輪**：核對上一輪確認的有沒有關掉；新 finding 落在上一輪修正的範圍、而且是同一個根因時，標 ⚠ 停下來，不建議繼續派修

判定標準在 `references/reachability.md`，Codex 的 `codex-evidence-review` 透過 symlink 讀同一份。

## When to Use

- code review 交回 finding、reviewer 在 MR 留言、或審別人 MR 列出 finding 之後，派人修正或回覆之前
- 主對話先把原文照貼存成 finding 檔，再打 `/review-triage <finding 檔的絕對路徑>`

跑在獨立的上下文（`context: fork`），看不到主對話，所以 finding 檔要自己帶齊材料。報告寫到 `.claude/verify-evidence/<key>/review-triage-r<N>.md`，第一行的 meta 給 mission-band 判斷審查進度用。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | 主對話的準備，以及 Step 1-7：讀材料、分類、可達性判定、追出處、修正輪檢查、寫報告、回報 |
| `references/reachability.md` | 可達性複核與操作證據的判定標準 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
