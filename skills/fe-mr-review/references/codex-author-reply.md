# Codex 作者視角回答 review 問題（編排規格）

由 `fe-mr-review` Step R7 的「第三選項」觸發。把剛產出的 review 問題交給本機 **Codex**，由 Codex 以 `fe-mr-walkthrough` 的「扮演作者答疑」模式逐題回答，完成後推播通知並附 MR comment 草稿。

> **定位**：Codex 與本次 review 看的是同一份 diff。🟢/🟡 是「草擬答覆 + 跨模型複核」，🔴（業務規則／架構決策／產品優先序）仍須真人作者——輸出務必區分這兩類，**絕不讓 Codex 編造作者意圖**。

---

## Step 1：前置檢查（缺則中止，不炸）

```bash
command -v codex >/dev/null 2>&1 && [ -f "$HOME/.codex/auth.json" ] && echo READY || echo MISSING
```

非 `READY` → 告知使用者：「本機 Codex CLI 未安裝或未登入。請先 `npm i -g @openai/codex`（或 brew）並 `codex login`，或執行 `/codex:setup` 後再試。」然後停止，不影響已產出的 review。

## Step 2：抽出要問作者的問題

從剛產出的 review 取「需作者回應」項目，改寫成一句問題：

- ✅ 納入：`需要修正`、`建議改善`、設計判斷疑慮（⚖️）、`人工 Review 需特別關注` 各項。
- ❌ 略過：`技術觀察（不需動作）`、純 LGTM 確認。

每題保留對應的 `file:line` 以便 Codex 定位。

## Step 3：組 Codex prompt（寫暫存檔）

寫入 `/tmp/codex-author-reply-{project_slug}-{mr_iid}.md`，內容包含：

1. **角色與紀律**（inline，不依賴 Codex 能否讀檔；同時請它參照 `~/.codex/skills/fe-mr-walkthrough` 的作者答疑模式）：
   - 你是**這個 MR 的作者**，逐題回答 reviewer 的提問。
   - 每題用**信心三級**開頭：🟢 從 code 可推斷 / 🟡 推測（建議與作者確認）/ 🔴 必須問真人作者。
   - 業務規則、架構決策、產品優先序、外部合約、為何不做某功能 → 一律 🔴「需真人作者補充」。
   - **禁止偽造引用**：不准寫「作者說／作者認為」。用「從程式碼看…」「我的理解是…」開頭。
   - 寧可標 🔴，也不要硬掰。
2. **每題輸出格式**：`信心 emoji｜核心答案（一句）｜依據（code 位置 / diff 片段）`。
3. **附料**：MR 標題與 diff（Claude 已持有，直接 inline）＋ Step 2 的問題清單（編號）。

## Step 4：背景執行 Codex

用 stdin 餵入（避免大 diff 的 shell escape），**整段輸出導到檔案**（不要 `| tail`，會截斷答覆），並以**背景**執行（Codex 可能數分鐘）：

```bash
codex exec --skip-git-repo-check - \
  < /tmp/codex-author-reply-{slug}-{iid}.md \
  > /tmp/codex-{slug}-{iid}-answers.txt 2>/tmp/codex-{slug}-{iid}-err.log
```

- `--skip-git-repo-check`：prompt 暫存檔在 `/tmp`（非 git repo / 非 trusted dir），不加會以 `Not inside a trusted directory` 失敗。
- **模型相容性**：若 stderr 出現 `The '<model>' model requires a newer version of Codex`，代表 `~/.codex/config.toml` 的預設模型比本機 CLI 新。處理：用 `-c model=<較舊且相容的模型>` 覆蓋（從 `~/.codex/models_cache.json` 挑），或請使用者升級 Codex CLI（`npm i -g @openai/codex` / `brew upgrade`）。
- stderr 常見 MCP server 連線/授權錯誤（figma、notion…）為**雜訊**，不影響答覆，忽略即可。
- 以 `run_in_background: true` 啟動；harness 會在完成時重新喚起。

## Step 5：完成 → 推播通知

Codex 背景任務完成後，用 `PushNotification` ping 使用者（內容如「MR !{iid} 的 Codex 作者視角答覆已完成，待你檢視」）。結果仍呈現在對話。

## Step 6：整理輸出

解析 Codex stdout，產出：

1. **答覆總表**

   | # | 問題 | Codex 作者視角答覆 | 信心 |
   |---|------|------------------|------|
   | 1 | … | … | 🟢/🟡/🔴 |

2. **兩區分明**：
   - **Codex 已可答（🟢/🟡）** — 可直接作為 review 討論的初步回應。
   - **仍需你 / 真人作者（🔴）** — Codex 無法從程式碼回答的，列在這。

3. **MR comment 草稿**：針對每個 🔴（與存疑的 🟡），依 `fe-mr-walkthrough/references/qa-protocol.md` 的改寫原則產出可貼回 MR 的草稿——開頭 `@{author}`、中性好奇語氣、想了解背景就明說。**列出但不自動送出。**

## Step 7：詢問下一步

問使用者是否要把草稿貼回 MR：用 `~/.claude/scripts/gitlab/mr-note.sh`（整體 comment）或 `mr-reply.sh`（回特定討論串）。**需使用者明確同意才送**。

---

## 注意

- Codex 是獨立計費、獨立 runtime 的 agent；此流程為選用、需使用者在 R7 主動選擇才觸發。
- 全程不自動寫入 GitLab；唯一對外動作（貼 comment）在 Step 7 由使用者確認。
