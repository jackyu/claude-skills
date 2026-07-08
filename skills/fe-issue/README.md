# FE Issue

> 將 PM 需求 Issue 透過互動流程轉換為前端技術 Issue 草稿

## Purpose

以三階段流程（收集資訊 → 產出草稿 → 發佈至 GitLab），將 PM/PD 的需求 Issue 轉化為前端可開發的技術 Issue。依複雜度分三層級：Micro 走極簡三段加速產出、Small 產出完整模版搭配實作範圍清單、Medium-Large 產出 Subtask 拆解。

## When to Use

- 用戶要求將 PM issue 轉為 RD / 前端 issue
- 用戶提到需求拆解、技術拆解、issue 拆解
- 用戶要求分析 PM 需求並產出開發任務
- 用戶提到 subtask 拆解、開發任務規劃
- 用戶貼上 PM issue 內容要求轉成技術 issue

## Key Features

- **GitLab Issue 自動取得**：提供 PM Issue URL 即可透過 `issue-get.sh` 自動取得內容與 Labels，無需手動貼上
- **AI 主動探索架構**：自動探索 codebase 找出相關元件與可複用模組，減少用戶回答負擔
- **Figma 三種輸入方式**：MCP 連結（優先）、截圖、文字描述
- **依複雜度決定拆解模式**：
  - **Micro (<1 天)**：極簡三段（關聯 + 實作範圍 + 預估一行），適合錯字、樣式微調、圖片替換、檔案移動
  - **Small (1-3 天)**：扁平「實作範圍」清單 + 完整模版
  - **Medium-Large (4+ 天)**：Subtask 拆解，每 Subtask 對應獨立 MR
- **Micro fast-path 自動偵測**：AI 依關鍵字與規模預判微型改動，確認後跳過 Figma/API 收集步驟
- **Labels 自動擷取**：從 PM Issue API 回應自動解析 type、product、priority
- **一鍵建立 GitLab Issue**：透過 `issue-create.sh` 自動建立並設定 Labels

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | Main skill instructions |
| `references/frontend-issue-template.md` | Frontend Issue Template 結構定義 |
| `references/gitlab-label-definition.md` | Label 規範定義 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
