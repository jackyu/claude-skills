# approach

> 動手前先把「怎麼做」的決定談完，不留給實作時的 AI 自己補

## Purpose

grill 問完需求之後、`/to-spec` 整理規格之前，檢查這張票有沒有做法要先決定。分四類檢查：套件還是手寫、檔案放哪裡、介面形狀（含測試要打在哪個介面）、從哪裡開始。

有把握的結論一次整批列出，沒意見就當接受；拿不準的逐題問，每題附推薦答案。值得深查的項目提議升級到 Pocock `research`／`prototype` 或 pstack `how`／`architect`，要使用者逐項核准才跑。

輸出只留在對話裡，由 `/to-spec` 收進 Implementation Decisions，所以跑完到 `/to-spec` 之間不要 `/clear`。這個階段 worktree 還沒建，不寫主 checkout 的任何檔案；跨票決定要寫的 `.claude/reference/` 規則和 ADR，等實作開始後跟功能一起 commit。

## When to Use

- 使用者打 `/approach`，每張票都跑一次（多半一行就結束）
- 在 mission-band 流程裡排在 grill 之後、`/to-spec` 之前

設成 `disable-model-invocation: true`，只能手打。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | 流程：判斷四類有沒有碰到、快查、一次輸出、升級 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
