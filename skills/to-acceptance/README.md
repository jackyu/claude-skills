# to-acceptance

> 把 spec 和 RD 票轉成給人看的驗收清單

## Purpose

在 to-spec 之後、to-tickets 之前，定下這個功能要怎麼驗收：每條 AC 寫清楚前提、操作、預期、改動前的行為、要留哪種證據、要不要進 verify-admin／verify-client 的回歸。清單寫到主 checkout 的 `.claude/specs/acceptance-<key>.md`，驗收階段的 `/verify-acceptance` 逐條跑並把結果寫回，`fe-mr-generator` 照 AC 編號填 Evidence，mission-band 讀它顯示進度。

格式規格在 `skills/_shared/acceptance/format.md`。

## When to Use

- 使用者打 `/to-acceptance`
- 規格改過之後重跑，更新清單（保留編號）

會寫檔，所以設成 `disable-model-invocation: true`，只能手打。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | 流程：找輸入、拆條目、檢查覆蓋、確認、更新 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
