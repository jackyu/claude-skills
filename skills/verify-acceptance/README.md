# verify-acceptance

> 照驗收清單逐條驗收，把結果和證據寫回清單

## Purpose

驗收階段的入口。讀 `/to-acceptance` 產生的 `.claude/specs/acceptance-<key>.md`，依每條的證據類型截圖（用 verify-admin／verify-client 驅動）、跑測試或跑指令，把 `通過`／`未過`／`受阻` 和證據路徑寫回清單。mission-band 讀清單顯示進度，fe-mr-generator 照 AC 編號填 MR 的 Evidence。

格式規格在 `skills/_shared/acceptance/format.md`。

## When to Use

- 使用者打 `/verify-acceptance`
- 修完未過的條目後重跑（預設只跑沒過的）

會起 dev server、寫清單，所以設成 `disable-model-invocation: true`，只能手打。

## Contents

| File | Description |
|------|-------------|
| `SKILL.md` | 流程：準備、起 app、逐條跑、寫回、回報 |

## Language

zh-TW

---

*Part of [claude-skills](../../README.md)*
