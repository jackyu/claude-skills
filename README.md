# claude-skills

Claude Code agent skills 的集中式儲存庫，具備版本控制與便捷部署。

## 快速開始

```bash
# 複製儲存庫
git clone https://github.com/jackyu/claude-skills.git
cd claude-skills

# 安裝所有 skills
./scripts/install.sh

# 安裝特定 skill
./scripts/install.sh -s fe-arch

# 列出可用 skills
./scripts/install.sh -l

# 預覽模式（不實際安裝）
./scripts/install.sh -n
```

## Skill 目錄

依分類索引如下：

- [前端開發](#前端開發) — 架構規範、issue 拆解、MR 導讀、審查與學習、review 結果判定
- [設計整合](#設計整合) — 設計稿驗證、Figma 整合、UI 審查
- [框架最佳實踐](#框架最佳實踐) — React/Next.js、Remotion
- [工具](#工具) — MR 生成、互動預覽、六步學習法、週報／A3 提案、PM 需求票
- [工作流程](#工作流程) — skill 探索、完成前驗證、做法決策、驗收清單與驗收、分支收尾
- [開發輔助](#開發輔助) — Agentation 視覺回饋
- [系統維護](#系統維護) — macOS 清理、磁碟分析

---

### 前端開發

| Skill | 說明 |
|---|---|
| [fe-arch](skills/fe-arch/) | 前端專案架構規範：檔案／目錄放置的決策流程（feature-based，建檔前必讀） |
| [fe-guardrails](skills/fe-guardrails/) | 偵測專案的品質護欄設定（複雜度、函式長度、重複偵測、pre-commit、coverage、TS 嚴格度），缺的提示、核可後代裝 |
| [gitlab-issue](skills/gitlab-issue/) | 將 PM 需求 Issue 轉換為前端技術 Issue 草稿，含 Subtask 拆解 |
| [fe-mr-review](skills/fe-mr-review/) | AI 輔助 GitLab MR 審查與 Review Comment 回覆（雙模式），含選用的 TL 視角補充 |
| [fe-mr-read](skills/fe-mr-read/) | 讀懂 GitLab MR 並可沉澱成學習筆記：導讀（白話化說明、流程圖、AI 扮演作者答疑、好做法雷達）→ 問要不要存筆記 → 補 Review 討論分析寫進 Heptabase |
| [mr-reading-map](skills/mr-reading-map/) | 在 MR diff 上發一串有順序的 inline 導覽註解（[1/M]、接著看 →），並把閱讀地圖插進 MR 描述；review 修正後重跑只補發過時的幾則。手動 `/mr-reading-map`，會寫入 GitLab |
| [review-triage](skills/review-triage/) | code review 或 reviewer 留言回來後、動手修之前逐筆判定：分成指出 bug／質疑前提／提問／風格，bug 從真實入口複核可達性，判成確認／待驗證／撤銷／防禦性建議；重跑時抓「在修上一輪修法」的訊號 |

> **架構規範的單一真相來源**：檔案該放哪一律以 [`fe-arch`](skills/fe-arch/) 為準；`gitlab-issue`／`fe-mr-generator`／`fe-mr-review`／`fe-mr-read` 只引用不複製，改規範只改一處。

> **品質門檻的單一真相來源**：函式長度、複雜度、巢狀深度、單檔行數、重複率的數字，一律以 [`fe-guardrails/references/thresholds.md`](skills/fe-guardrails/references/thresholds.md) 為準；`fe-mr-review` 只引用不寫死。**review skill 產出的是建議，`fe-guardrails` 裝的是 pre-commit 硬閘**，兩者互補。

> **fe-mr-\* 系列的時機分工**：Pocock `/mattpocock-skills:code-review`（Spec／Standards 兩軸）＋ Codex `$codex-evidence-review`（作者推送前的雙軌預審，結果交 `/review-triage`；爆炸半徑由驗收階段的 pstack `blast-radius` 負責）→ `fe-mr-read` Phase 1（reviewer review **前**的導讀）→ `fe-mr-review`（review **中**的審查與 comment 產出）→ `fe-mr-read` Phase 3（導讀或 review **之後**的 Heptabase 學習筆記，`fe-mr-review` 審完也可直接接）。共用判準（流程圖規則、好做法目錄、難度分級等）放在 [`skills/_shared/fe-mr-common/`](skills/_shared/fe-mr-common/)。

### 設計整合

| Skill | 說明 |
|---|---|

### 框架最佳實踐

| Skill | 說明 |
|---|---|
| [vercel-react-best-practices](skills/vercel-react-best-practices/) | 來自 Vercel Engineering 的 React 與 Next.js 效能最佳化指南 |
| [remotion-best-practices](skills/remotion-best-practices/) | Remotion 最佳實踐 — 使用 React 製作影片 |

### 工具

| Skill | 說明 |
|---|---|
| [fe-mr-generator](skills/fe-mr-generator/) | 從分支變更內容生成結構化 Merge Request 描述 |
| [teach-me](skills/teach-me/) | 六步學習法學任何主題：5 級階梯 → 20% 計畫 → 一次一題考官 → 一頁速查表（必問嵌進哪個必經路徑）→ 驗證過的 5 個資源 → 費曼補漏；進度存 `<repo>/.claude/learn/`，pure skill、網頁版也能用 |
| [a3-report](skills/a3-report/) | 給主管的週報與 A3 提案：進度／blocker／拍板事項（縮小版 A3：問題→現況→方案比較→建議）／下週，或完整 8 格 A3；素材來自手打筆記、PM issue、GitLab 本週 MR／issue；沒數據標「待確認」不腦補；`--format md\|ppt\|html` |
| [pm-issue](skills/pm-issue/) | 用 PM 口吻寫需求 issue：任務概述 → 需求 → Given/When/Then 驗收情境，白話不帶工程用語；自動列待補的設計稿、截圖、文案，符合條件附 Mermaid 流程圖；確認後 dry-run 再建到 rsc-pm |

### 工作流程

| Skill | 說明 |
|---|---|
| [find-skills](skills/find-skills/) | 從開放 skills 生態系中探索與安裝 agent skills |
| [approach](skills/approach/) | 動手前檢查這張票有沒有做法要先決定（套件或手寫、放哪裡、介面形狀、從哪開始），有把握的整批列、拿不準的逐題問並附推薦。手動 `/approach`，排在 `/to-spec` 前 |
| [to-acceptance](skills/to-acceptance/) | 把 spec 和 RD 票轉成給人看的驗收清單（AC-1…，含前提、操作、預期、證據類型、要不要進回歸），草稿後逼問補漏；規格改過重跑保留編號。手動 `/to-acceptance` |
| [verify-acceptance](skills/verify-acceptance/) | 照驗收清單逐條驗收：截圖、跑測試或指令，會改變的行為另拍 Before；結果寫回清單、要進回歸的寫進 verify-admin／verify-client，最後跑整體回歸。手動 `/verify-acceptance` |
| [cleanup](skills/cleanup/) | MR 合併後刪掉這張票的 worktree 與本地分支，spec、驗收清單搬進 archive；沒合併要輸入 discard 才丟棄 |

### 開發輔助

| Skill | 說明 |
|---|---|

### 系統維護

| Skill | 說明 |
|---|---|
| [mole-maintenance](skills/mole-maintenance/) | 安裝並用 Mole (`mo`) 做 macOS 維護 — 偵測/安裝、系統健康檢查、磁碟分析、清理預覽（清除預設只 dry-run，需明確指示才真刪） |

## Mods

Claude Code mod 放在 `mods/`，不走 `install.sh`，各自的 README 寫安裝方式與前置條件。

| Mod | 說明 |
|---|---|
| [mission-band](mods/mission-band/) | 輸入框上方的開發任務進度提示（開始 → 實作 → 驗收 → 審查 → 收尾），依賴本 repo 的 approach、to-acceptance、verify-acceptance、cleanup |

## 安裝方式

### install.sh（推薦用於本 repo 技能）

Skills 以 symlink 方式從本儲存庫安裝至 agent 的 skills 目錄，編輯即生效。

```bash
# 預設目標：Claude Code（~/.claude/skills/）
./scripts/install.sh

# 通用 AI agent（~/.agents/skills/）
./scripts/install.sh -t agents

# Codex CLI 原生 skills（~/.codex/skills/）
./scripts/install.sh -t codex

# 一次裝到多個目標（逗號分隔）
./scripts/install.sh -t claude-code,codex

# 一次裝到所有 agent 目標（claude-code,agents,codex,cursor；不含 project）
./scripts/install.sh -t all

# 安裝至專案級目錄（./.claude/skills/）
./scripts/install.sh -t project

# 目標 Cursor（~/.cursor/skills/）
./scripts/install.sh -t cursor

# 安裝單一 skill
./scripts/install.sh -s fe-mr-review

# 解除安裝所有 skills
./scripts/install.sh --uninstall

# 強制重新安裝（覆蓋既有）
./scripts/install.sh --force
```

### openskills CLI（適用於安裝外部技能）

若需從 GitHub 安裝社群或外部技能，可使用 [openskills CLI](https://github.com/numman-ali/openskills)：

```bash
# 安裝外部技能（從 GitHub repo）
npx openskills install <github-url>

# 列出已安裝技能
npx openskills list

# 按需讀取技能
npx openskills read <name>
```

> **注意**：openskills 使用檔案複製而非 symlink，修改後需重新安裝。本 repo 的自訂技能建議使用 `install.sh` 以保留 symlink 的即時生效特性。

### 開源推薦

另有社群維護的優質開源 skills 推薦清單，涵蓋前端、設計、測試等類別，詳見 **[RECOMMENDED_SKILLS.md](RECOMMENDED_SKILLS.md)**。

## 目錄結構

```
claude-skills/
├── README.md                  # 本檔案
├── CLAUDE.md                  # AI agent 指令
├── scripts/
│   └── install.sh             # 安裝腳本（symlink 部署）
├── skills/
│   │   ├── SKILL.md           # Agent 指令（必要）
│   │   ├── README.md          # 人類可讀文件（必要，繁體中文）
│   │   ├── scripts/           # 可執行工具（選用）
│   │   ├── references/        # 按需載入的詳細文件（選用）
│   │   ├── assets/            # 輸出範本與資源（選用）
│   │   └── rules/             # 領域特定規則檔案（選用）
│   └── ...                    # 每個 skill 一個目錄
├── mods/
│   └── mission-band/          # Claude Code mod（安裝見其 README）
```

## 貢獻方式

新增 skill 的步驟：

1. 在 Claude Code 中使用官方 skill-creator：
   ```
   請參考 /mnt/skills/examples/skill-creator/SKILL.md，幫我建立一個新的 skill，功能是 [描述需求]
   ```
2. Skill 會建立在 `/mnt/skills/user/<skill-name>/`
3. 若要納入本 repo，將 skill 複製至 `skills/<skill-名稱>/`
4. 確認 `SKILL.md` 含有效 YAML frontmatter（name + description + trigger scenarios）
5. 測試安裝：`./scripts/install.sh -s <skill-名稱>`
6. 更新本檔案的 Skill 目錄表格
