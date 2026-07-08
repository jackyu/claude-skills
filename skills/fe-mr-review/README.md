# FE MR Review

> AI 輔助 GitLab Merge Request 審查與 Review Comment 回覆

## Purpose

取得 GitLab MR 資訊，以資深軟體工程師視角做全面、嚴格的 code review，支援兩種模式：

- **審查模式**：不只看程式碼對不對，更先問「該不該這樣做」——設計判斷三問（值得解決嗎 / 有無更簡單做法 / 影響範圍）、與既有程式碼的一致性與共用比對、技術正確性與安全性。所有描述用白話文，讓不熟架構的工程師（含新手）也能看懂並判斷
- **回覆評估模式**：分析 MR 上的 review comments，結合本地專案完整 context 逐條評估建議合理性，產出 Accept / Dismiss / Discuss 分類回覆

## When to Use

- 用戶要求審查 MR / PR
- 用戶提到 merge request review、PR review
- 用戶要求產出 code review 並包含人工確認項目
- 用戶要求讓 AI 先 review 再由人確認
- 用戶要求針對 GitLab MR 進行審查
- 用戶要求分析 review comments、處理 review feedback
- 用戶說 MR 上有 review 建議要回覆

## Key Features

- **雙模式架構**：自動判定審查模式或回覆評估模式
- **設計判斷三問**：先問「值得解決嗎 / 有無更簡單做法 / 什麼會被影響」，避免為不存在的問題寫程式、過度設計
- **一致性與共用比對**：主動找專案既有的類似做法，比對差異、是否可共用、風格手法是否一致（新人最常被抓的點）
- **技術審查 + 安全性把關**：聚焦商業邏輯、效能、可維護性、易讀性，安全性逐項看過（XSS、敏感資料外洩、權限缺漏等）
- **新手友善的報告**（依共用 `review-writing-principles.md`）：開頭比喻導讀建立心智模型、每個 finding 配關鍵程式碼 + GitLab 行號連結、風險用對照表、人工 Review 用四欄檢查項（動作/預期/為什麼/驗證）、報告末附名詞小辭典；內文維持專業用詞
- Review Comment 回覆：逐條分析為 Accept / Dismiss / Discuss，附具體專案脈絡
- **（選用）Codex 作者視角回答 review 問題**：review 後可一鍵把問題交給本機 Codex，以作者答疑模式逐題回答、過濾出真正需真人作者補充的點，完成推播通知並附 MR comment 草稿
- 支援大型 MR 與討論串未解決 comment 的特殊情境處理
- 中文文案排版規範（中英文間距、全形標點等）

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Main skill instructions |
| `references/review-focus.md` | 各類型 MR（feature / bugfix / refactor）的審查焦點 |
| `references/output-format-review.md` | 審查模式輸出格式範本 |
| `references/codex-author-reply.md` | （選用）Codex 作者視角回答 review 問題的編排規格 |
| `references/reply-mode.md` | 回覆評估模式詳細步驟 |
| `references/reply-template.md` | Review Comment 回覆格式範本 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
