# claude-skills

This repository is a central collection of Claude Code agent skills with version-controlled source and symlink-based deployment.

## Repo Structure

```
claude-skills/
├── skills/          # All skill packages (one directory per skill)
├── scripts/         # Deployment and utility scripts
├── README.md        # Project overview and skill catalog
└── CLAUDE.md        # This file (AI agent instructions for the repo)
```

- `skills/<name>/` -- Each skill is a self-contained directory.
- `scripts/install.sh` -- Installs skills as symlinks into the target agent directory (default: `~/.claude/skills/`).

## Skill Format Conventions

### Required Files

Every skill directory must contain:

- **SKILL.md** -- Agent-facing instructions with YAML frontmatter.
- **README.md** -- Human-readable documentation.

### SKILL.md Frontmatter

```yaml
---
name: skill-name
description: What this skill does. Use when [trigger scenario 1], [trigger scenario 2].
---
```

- `name` is kebab-case (e.g., `fe-code-review`).
- `description` must include at least two trigger scenarios so the agent knows when to activate the skill.
- Frontend-specific skills use the `fe-` prefix (e.g., `fe-code-review`).

### SKILL.md Body

- Use imperative form ("Analyze the branch", not "You should analyze the branch").
- Keep under 3000 words; put detailed references in a `references/` subdirectory.
- Prefer structured steps over long paragraphs.

### Optional Directories

```
skill-name/
├── scripts/        # Executable utilities (Python, Bash, etc.)
├── references/     # Detailed docs loaded on demand
├── assets/         # Output templates and resources
└── rules/          # Domain-specific rule files
```

## Install Commands

```bash
# Install all skills (symlinks to ~/.claude/skills/)
./scripts/install.sh

# Install a single skill
./scripts/install.sh -s <skill-name>

# Install for generic AI agents (Gemini, etc.)
./scripts/install.sh --target agents

# Install for Codex CLI native skills (~/.codex/skills/)
./scripts/install.sh --target codex

# Install for Cursor
./scripts/install.sh --target cursor

# Install to project-level (./.claude/skills/)
./scripts/install.sh --target project

# List available skills
./scripts/install.sh --list

# Preview without changes
./scripts/install.sh --dry-run

# Force reinstall
./scripts/install.sh --force

# Uninstall
./scripts/install.sh --uninstall
```

## Adding a New Skill

使用 Claude Code 官方的 skill-creator 建立新 skill：

1. 在 Claude Code 對話中輸入：
   ```
   請參考 /mnt/skills/examples/skill-creator/SKILL.md，幫我建立一個新的 skill，功能是 [描述需求]
   ```
2. Claude Code 會在 `/mnt/skills/user/<skill-name>/` 建立新 skill
3. 若要納入本 repo 管理，將建立好的 skill 複製至 `skills/<name>/`
4. 更新 `README.md` 的 Skill 目錄表格

## Naming Conventions

- Use kebab-case: `my-skill-name`
- Frontend skills: `fe-` prefix (e.g., `fe-code-review`)
- Names should intuitively reflect the skill's purpose
