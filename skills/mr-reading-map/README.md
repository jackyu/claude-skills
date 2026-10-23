# MR Reading Map

> 在 GitLab MR 上發有順序的 inline 導覽註解，並在描述插一份閱讀地圖

## Purpose

給 reviewer 一條閱讀動線：第 1 則講入口點，第 2 則起由內而外讀核心。每則註解帶 `[i/M]` 編號和「接著看 → 下一則」連結，MR 描述裡另有一份可點的目錄。

review 修正 push 之後重跑，只補發被標成過時的註解（註解那一行被改了）；只是行號位移的，GitLab 會自己移過去，不用重發。

這個 skill 原本是 fe-mr-generator 的 Step 8 加上 `/push` 的步驟 9，拆出來之後兩邊都不再處理導覽註解。

## When to Use

- 使用者打 `/mr-reading-map <MR 號>`
- draft 轉 ready 時跑第一次
- review 修正 push 之後重跑

會寫入 GitLab，所以設成 `disable-model-invocation: true`，只能手打。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | 流程：第一次執行與重跑 |
| `references/picking-lines.md` | 挑行原則、順序、密度、行號 |
| `references/publishing.md` | 發文、補連結、插地圖，以及 data 的編碼 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
