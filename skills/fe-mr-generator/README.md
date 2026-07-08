# FE MR Generator

> 生成 Git Merge Request 的 Title 與 Description

## Purpose

根據 Git branch 的 commit 與 diff，產出結構化的 MR Title 與 Description。核心理念是聚焦 reviewer 難以從 code 自行還原的核心：為什麼這樣改、整體概念地圖、做了什麼。其餘 diff 看得出來的（逐項功能、架構選擇、review 重點）與開發過程的解題思維不重複描述。

## When to Use

- 用戶要求產生 MR 描述
- 用戶要求整理 branch 變更內容
- 用戶提到 merge request、MR、pull request、PR 內容撰寫
- 用戶開發完成要推 MR
- 用戶提到要開 MR 或發 PR

## Key Features

- **Context 收集**：主動確認關聯 Issue、Subtask、PM Issue 等資訊
- **複雜度分級**：根據變更內容自動判斷簡單/一般/複雜，決定描述區塊的詳細程度
- **精簡知識模板**：保留為什麼、概念地圖、做了什麼、測試等核心區塊；架構決策／review 重點／學習點／解題紀錄等不入描述
- **格式嚴格規範**：禁止出現檔案路徑，一律用功能描述取代
- 支援指定不同的 base branch（預設 main）

## Workflow

1. 收集 Context（關聯 Issue、Subtask、PM Issue）
2. 確認分支資訊與 commit 差異
3. 蒐集變更資訊（commit log、diff stat、完整 diff）
4. 分析變更內容（動機、概念地圖、功能分組）
5. 判斷複雜度（簡單/一般/複雜）
6. 產生 MR Title（`[#issue_id]` + Issue 原始 title）
7. 依模板產生 MR Description
8. 以 markdown code block 輸出結果

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Skill 主要指令 |
| `references/mr-description-template.md` | MR Description 結構化模板 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
