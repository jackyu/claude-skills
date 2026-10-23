# FE MR Generator

> 生成 Git Merge Request 的 Title 與 Description

## Purpose

GitLab 版的 Pocock `pr` skill。Summary 圖、Evidence、Merge Danger 照 `pr` 的規則寫，再加上 GitLab 與前端專案的規則：`[#id][前後台] 中文說明` 標題、Closes／Related to 關聯、「為什麼要這樣做」、fe-arch 注意事項，以及給 `/push` 檢查用的隱形標記。

inline 導覽註解與閱讀地圖不在這個 skill 的範圍，由另外的 skill 處理。

## When to Use

- 用戶要求產生 MR 描述
- 用戶要求整理 branch 變更內容
- 用戶提到 merge request、MR、pull request、PR 內容撰寫
- 用戶開發完成要推 MR
- 用戶提到要開 MR 或發 PR

## Description 的五段

1. 關聯
2. 為什麼要這樣做
3. Summary（pr 的圖）
4. Merge Danger（pr 的 Door 與 Blast Radius）
5. Evidence（放最後、不收合）

Merge Danger 有 blast-radius 結論就引用；Evidence 只列實際存在的證據，沒有就標「待補」。

## Workflow

1. 收集 Context（關聯 Issue、Subtask、PM Issue、驗收素材）
2. 確認分支資訊與 commit 差異
3. 蒐集變更資訊（commit log、diff stat、完整 diff）
4. 用 Skill 工具載入 `mattpocock-skills:pr`
5. 產生 MR Title
6. 依模板產生五段 Description
7. 以 markdown code block 輸出

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Skill 主要指令 |
| `references/mr-title-rules.md` | MR Title 規則（含 monorepo 前綴邏輯） |
| `references/mr-description-template.md` | MR Description 模板（五段） |
| `references/gitlab-mr-template.md` | 可直接貼進 GitLab 的空白骨架 |
| `evals/evals.json` | Skill 行為的 eval 案例與斷言 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
