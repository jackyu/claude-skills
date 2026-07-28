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
./scripts/install.sh -s figma

# 列出可用 skills
./scripts/install.sh -l

# 預覽模式（不實際安裝）
./scripts/install.sh -n
```

## Skill 目錄

共 18 個 skills，依分類索引如下：

- [前端開發](#前端開發) — 架構規範、issue 拆解、MR 審查與學習
- [設計整合](#設計整合) — 設計稿驗證、Figma 整合、UI 審查
- [框架最佳實踐](#框架最佳實踐) — React/Next.js、Remotion
- [工具](#工具) — MR 生成、互動預覽
- [工作流程](#工作流程) — skill 探索、完成前驗證、分支收尾
- [開發輔助](#開發輔助) — Agentation 視覺回饋
- [系統維護](#系統維護) — macOS 清理、磁碟分析

---

### 前端開發

| Skill | 說明 |
|---|---|
| [fe-arch](skills/fe-arch/) | 前端專案架構規範：檔案／目錄放置的決策流程（feature-based，建檔前必讀） |
| [fe-issue](skills/fe-issue/) | 將 PM 需求 Issue 轉換為前端技術 Issue 草稿，含 Subtask 拆解 |
| [fe-code-review](skills/fe-code-review/) | 前端程式碼審查，涵蓋品質、效能、安全性與編碼標準 |
| [fe-mr-review](skills/fe-mr-review/) | AI 輔助 GitLab MR 審查與 Review Comment 回覆（雙模式），含選用的 TL 視角補充 |
| [fe-mr-review-html](skills/fe-mr-review-html/) | fe-mr-review 的 HTML artifact 輸出版本：內嵌 diff + 嚴重程度色標 + 焦點區深度說明（streaming/cache/並行控制等） |
| [fe-mr-walkthrough](skills/fe-mr-walkthrough/) | reviewer 在 review 前的 MR 理解輔助：白話化說明、流程圖、AI 扮演作者答疑、好做法雷達 |
| [fe-mr-digest](skills/fe-mr-digest/) | 將已合併的 GitLab MR 轉化為學習筆記，從程式碼與 Review 討論中萃取知識 |

> **架構規範的單一真相來源**：檔案該放哪一律以 [`fe-arch`](skills/fe-arch/) 為準；`fe-issue`／`fe-mr-generator`／`fe-mr-review`／`fe-code-review`／`fe-mr-digest` 只引用不複製，改規範只改一處。

> **fe-mr-\* 系列的時機分工**：`fe-code-review`（作者推送前的多 agent 預審）→ `fe-mr-walkthrough`（reviewer review **前**的理解輔助）→ `fe-mr-review`（review **中**的審查與 comment 產出）→ `fe-mr-digest`（合併**後**的學習筆記萃取）。共用判準（流程圖規則、好做法目錄、難度分級等）放在 [`skills/_shared/fe-mr-common/`](skills/_shared/fe-mr-common/)。

### 設計整合

| Skill | 說明 |
|---|---|
| [figma](skills/figma/) | 整合 Figma API 進行設計自動化與程式碼生成 |
| [web-design-guidelines](skills/web-design-guidelines/) | 依據 Web Interface Guidelines 審查 UI 程式碼的合規性與無障礙性 |

### 框架最佳實踐

| Skill | 說明 |
|---|---|
| [vercel-react-best-practices](skills/vercel-react-best-practices/) | 來自 Vercel Engineering 的 React 與 Next.js 效能最佳化指南 |
| [remotion-best-practices](skills/remotion-best-practices/) | Remotion 最佳實踐 — 使用 React 製作影片 |

### 工具

| Skill | 說明 |
|---|---|
| [fe-mr-generator](skills/fe-mr-generator/) | 從分支變更內容生成結構化 Merge Request 描述 |
| [preview](skills/preview/) | 把提案/計畫/想法做成互動 HTML、部署 Vercel 取得分享連結，內嵌註解 overlay 收集回饋 |

### 工作流程

| Skill | 說明 |
|---|---|
| [find-skills](skills/find-skills/) | 從開放 skills 生態系中探索與安裝 agent skills |
| [verification-before-completion](skills/verification-before-completion/) | 在宣稱完成前強制執行驗證指令，證據先於斷言 |
| [finish](skills/finish/) | 開發分支收尾：判斷合併狀態後提供選項（開 MR／保留／丟棄／清理 worktree），丟棄需輸入 discard |

### 開發輔助

| Skill | 說明 |
|---|---|
| [agentation](skills/agentation/) | 為 Next.js 專案加入 Agentation 視覺回饋工具列 |

### 系統維護

| Skill | 說明 |
|---|---|
| [mole-maintenance](skills/mole-maintenance/) | 安裝並用 Mole (`mo`) 做 macOS 維護 — 偵測/安裝、系統健康檢查、磁碟分析、清理預覽（清除預設只 dry-run，需明確指示才真刪） |

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
./scripts/install.sh -s fe-code-review

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
│   ├── agentation/
│   │   ├── SKILL.md           # Agent 指令（必要）
│   │   ├── README.md          # 人類可讀文件（必要，繁體中文）
│   │   ├── scripts/           # 可執行工具（選用）
│   │   ├── references/        # 按需載入的詳細文件（選用）
│   │   ├── assets/            # 輸出範本與資源（選用）
│   │   └── rules/             # 領域特定規則檔案（選用）
│   ├── figma/
│   ├── fe-code-review/
│   └── ...                    # 共 18 個 skills
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
