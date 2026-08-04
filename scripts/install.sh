#!/usr/bin/env bash
set -euo pipefail

# ─── Constants ───────────────────────────────────────────────────────────────

# Resolve REPO_DIR from the script's own location (handles symlinks too)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$REPO_DIR/skills"
BACKUP_DIR="$REPO_DIR/.backup"

# Target path lookup (no associative arrays -- macOS ships bash 3.2)
get_target_path() {
  case "$1" in
    claude-code) echo "$HOME/.claude/skills" ;;
    agents)      echo "$HOME/.agents/skills" ;;
    codex)       echo "$HOME/.codex/skills" ;;
    cursor)      echo "$HOME/.cursor/skills" ;;
    project)     echo "./.claude/skills" ;;
    *)           return 1 ;;
  esac
}
VALID_TARGETS="claude-code agents codex cursor project"

# Special "all" target expands to every agent home-dir target (project excluded --
# it is a cwd-relative path and should never be written implicitly).
ALL_TARGETS="claude-code agents codex cursor"

# Defaults
TARGET="claude-code"
TARGETS="claude-code"
SKILL_FILTER=""
DRY_RUN=false
LIST_MODE=false
UNINSTALL=false
FORCE=false

# Counters
COUNT_INSTALLED=0
COUNT_SKIPPED=0
COUNT_WARNINGS=0
COUNT_ERRORS=0
COUNT_UNINSTALLED=0

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Output helpers ──────────────────────────────────────────────────────────

info()    { printf "${CYAN}[info]${RESET}    %s\n" "$*"; }
success() { printf "${GREEN}[ok]${RESET}      %s\n" "$*"; }
warn()    { printf "${YELLOW}[warn]${RESET}    %s\n" "$*"; ((COUNT_WARNINGS++)) || true; }
error()   { printf "${RED}[error]${RESET}   %s\n" "$*" >&2; ((COUNT_ERRORS++)) || true; }
dry()     { printf "${YELLOW}[dry-run]${RESET} %s\n" "$*"; }

# ─── Usage ───────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Deploy skills from this repo via symlinks.

Options:
  -s, --skill NAME     Install a specific skill (supports glob patterns, e.g. "fe-*")
  -t, --target TARGET  Target environment(s): claude-code (default), agents, codex, cursor, project.
                       Accepts a comma-separated list (e.g. "claude-code,codex") or "all"
                       (= claude-code,agents,codex,cursor; project excluded).
  -l, --list           List all skills and their installation status
  -n, --dry-run        Dry run -- show what would happen without making changes
  --uninstall          Remove symlinks that point to this repo
  --force              Force overwrite existing non-symlink directories (backs up first)
  -h, --help           Show this help message

Examples:
  $(basename "$0")                  # Install all skills to ~/.claude/skills/
  $(basename "$0") -s figma         # Install only the figma skill
  $(basename "$0") -s "fe-*"        # Install all skills matching fe-*
  $(basename "$0") -t agents        # Install to ~/.agents/skills/ (generic AI agents)
  $(basename "$0") -t codex         # Install to ~/.codex/skills/ (Codex CLI native skills)
  $(basename "$0") -t claude-code,codex  # Install to Claude Code + Codex in one run
  $(basename "$0") -t all           # Install to all agent targets (claude-code,agents,codex,cursor)
  $(basename "$0") -t cursor        # Install to cursor target
  $(basename "$0") -t project       # Install to ./.claude/skills/ (project-level)
  $(basename "$0") -l               # List skills and status
  $(basename "$0") -n               # Dry run
  $(basename "$0") --uninstall      # Remove symlinks
EOF
}

# ─── Argument parsing ────────────────────────────────────────────────────────

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -s|--skill)
        SKILL_FILTER="${2:-}"
        [[ -z "$SKILL_FILTER" ]] && { error "Option $1 requires an argument"; usage; exit 1; }
        shift 2
        ;;
      -t|--target)
        local raw="${2:-}"
        [[ -z "$raw" ]] && { error "Option $1 requires an argument"; usage; exit 1; }
        # Accept a comma-separated list; "all" expands to every agent home-dir target.
        TARGETS=""
        local _parts=()
        IFS=',' read -ra _parts <<< "$raw"
        local t
        for t in "${_parts[@]}"; do
          [[ -z "$t" ]] && continue
          if [[ "$t" == "all" ]]; then
            local a
            for a in $ALL_TARGETS; do
              case " $TARGETS " in *" $a "*) ;; *) TARGETS="${TARGETS:+$TARGETS }$a" ;; esac
            done
            continue
          fi
          if ! get_target_path "$t" >/dev/null 2>&1; then
            error "Unknown target: $t (valid: $VALID_TARGETS, or 'all')"
            exit 1
          fi
          # De-duplicate while preserving order
          case " $TARGETS " in *" $t "*) ;; *) TARGETS="${TARGETS:+$TARGETS }$t" ;; esac
        done
        [[ -z "$TARGETS" ]] && { error "Option $1 requires at least one valid target"; exit 1; }
        shift 2
        ;;
      -l|--list)       LIST_MODE=true;  shift ;;
      -n|--dry-run)    DRY_RUN=true;    shift ;;
      --uninstall)     UNINSTALL=true;  shift ;;
      --force)         FORCE=true;      shift ;;
      -h|--help)       usage; exit 0 ;;
      *)
        error "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
}

# ─── Skill discovery ────────────────────────────────────────────────────────

# Returns a newline-separated list of skill directory names that match the
# current filter (or all skills if no filter is set).
get_skills() {
  local skills=()
  for dir in "$SKILLS_DIR"/*/; do
    # Guard against empty glob
    [[ -d "$dir" ]] || continue
    local name
    name="$(basename "$dir")"
    # Skip names that are only whitespace (trailing-space edge case)
    [[ -z "${name// /}" ]] && continue
    # Skip directories prefixed with _ (shared references, internal helpers — not standalone skills)
    [[ "$name" == _* ]] && continue
    if [[ -n "$SKILL_FILTER" ]]; then
      # shellcheck disable=SC2254
      case "$name" in
        $SKILL_FILTER) ;;  # match -- fall through
        *) continue ;;
      esac
    fi
    skills+=("$name")
  done
  if [[ ${#skills[@]} -eq 0 ]]; then
    if [[ -n "$SKILL_FILTER" ]]; then
      error "No skills matched filter: $SKILL_FILTER"
      exit 1
    else
      error "No skills found in $SKILLS_DIR"
      exit 1
    fi
  fi
  printf '%s\n' "${skills[@]}"
}

# ─── Status helpers ──────────────────────────────────────────────────────────

# Prints the status of a skill at the given target path.
# Returns: installed | not-installed | conflict
skill_status() {
  local name="$1"
  local target_dir="$2"
  local link_path="$target_dir/$name"

  if [[ -L "$link_path" ]]; then
    local resolved
    resolved="$(readlink "$link_path")"
    if [[ "$resolved" == "$SKILLS_DIR/$name" ]]; then
      echo "installed"
    else
      echo "conflict"
    fi
  elif [[ -e "$link_path" ]]; then
    echo "conflict"
  else
    echo "not-installed"
  fi
}

# ─── List mode ───────────────────────────────────────────────────────────────

do_list() {
  local target_dir="$(get_target_path "$TARGET")"
  printf "\n${BOLD}Skills status${RESET} (target: %s -> %s)\n\n" "$TARGET" "$target_dir"

  local skills
  skills="$(get_skills)"

  while IFS= read -r name; do
    local status
    status="$(skill_status "$name" "$target_dir")"
    case "$status" in
      installed)
        printf "  ${GREEN}%-40s${RESET} %s\n" "$name" "installed (symlinked)"
        ;;
      not-installed)
        printf "  ${CYAN}%-40s${RESET} %s\n" "$name" "not installed"
        ;;
      conflict)
        printf "  ${YELLOW}%-40s${RESET} %s\n" "$name" "conflict (exists but not symlinked to this repo)"
        ;;
    esac
  done <<< "$skills"
  echo
}

# ─── Install ─────────────────────────────────────────────────────────────────

install_skill() {
  local name="$1"
  local target_dir="$2"
  local source="$SKILLS_DIR/$name"
  local link_path="$target_dir/$name"

  # Already symlinked to this repo -- skip
  if [[ -L "$link_path" ]]; then
    local resolved
    resolved="$(readlink "$link_path")"
    if [[ "$resolved" == "$source" ]]; then
      info "skip: $name (already symlinked)"
      ((COUNT_SKIPPED++)) || true
      return
    fi
    # Symlink exists but points elsewhere
    warn "$name: symlink exists but points to $resolved"
    if $FORCE; then
      if $DRY_RUN; then
        dry "would remove foreign symlink $link_path"
      else
        rm "$link_path"
      fi
    else
      warn "  use --force to overwrite"
      return
    fi
  elif [[ -e "$link_path" ]]; then
    # Non-symlink file/directory exists
    warn "$name: path exists and is not a symlink"
    if $FORCE; then
      local backup_dest="$BACKUP_DIR/$TARGET/$name"
      if $DRY_RUN; then
        dry "would backup $link_path -> $backup_dest"
        dry "would remove $link_path"
      else
        info "backing up $link_path -> $backup_dest"
        mkdir -p "$(dirname "$backup_dest")"
        mv "$link_path" "$backup_dest"
      fi
    else
      warn "  use --force to overwrite (existing dir will be backed up)"
      return
    fi
  fi

  # Create the symlink
  if $DRY_RUN; then
    dry "would link $source -> $link_path"
  else
    ln -s "$source" "$link_path"
    success "$name -> $link_path"
  fi
  ((COUNT_INSTALLED++)) || true
}

do_install() {
  local target_dir="$(get_target_path "$TARGET")"

  # Ensure target parent exists
  if ! $DRY_RUN; then
    mkdir -p "$target_dir"
  fi

  info "installing skills to $target_dir"
  $DRY_RUN && info "(dry-run mode -- no changes will be made)"
  echo

  local skills
  skills="$(get_skills)"

  while IFS= read -r name; do
    install_skill "$name" "$target_dir"
  done <<< "$skills"

  # Also symlink _shared/ directories so cross-skill references and scripts
  # remain reachable via absolute paths at runtime (e.g. ~/.claude/skills/_shared/...).
  # These are not standalone skills, but skill SKILL.md files may reference them
  # via relative paths (../_shared/...) or invoke scripts inside them via Bash.
  # Always run, even with -s filter, since filtered skills may depend on _shared/.
  install_shared_dirs "$target_dir"
}

install_shared_dirs() {
  local target_dir="$1"
  for shared in "$SKILLS_DIR"/_*/; do
    [[ -d "$shared" ]] || continue
    local sname
    sname="$(basename "$shared")"
    install_skill "$sname" "$target_dir"
  done
}

# ─── Uninstall ───────────────────────────────────────────────────────────────

uninstall_skill() {
  local name="$1"
  local target_dir="$2"
  local link_path="$target_dir/$name"

  if [[ -L "$link_path" ]]; then
    local resolved
    resolved="$(readlink "$link_path")"
    if [[ "$resolved" == "$SKILLS_DIR/$name" ]]; then
      if $DRY_RUN; then
        dry "would remove symlink $link_path"
      else
        rm "$link_path"
        success "removed $link_path"
      fi
      ((COUNT_UNINSTALLED++)) || true
    else
      info "skip: $name (symlink points to $resolved, not this repo)"
      ((COUNT_SKIPPED++)) || true
    fi
  elif [[ -e "$link_path" ]]; then
    info "skip: $name (not a symlink -- will not delete real directory)"
    ((COUNT_SKIPPED++)) || true
  else
    info "skip: $name (not installed)"
    ((COUNT_SKIPPED++)) || true
  fi
}

# Returns 0 if any skill symlink from this repo is still installed at target_dir
# apart from the ones handled in this run. Names handled this run are passed in
# (newline-separated) rather than probed from disk, so the answer is the same
# under --dry-run, where nothing has actually been unlinked yet.
has_dependent_skills() {
  local target_dir="$1"
  local handled="$2"
  local entry base resolved

  for entry in "$target_dir"/*; do
    [[ -L "$entry" ]] || continue
    base="$(basename "$entry")"
    # _shared/ dirs are what we are deciding about -- they are not dependents
    [[ "$base" == _* ]] && continue
    resolved="$(readlink "$entry")"
    [[ "$resolved" == "$SKILLS_DIR/$base" ]] || continue
    if printf '%s\n' "$handled" | /usr/bin/grep -qxF "$base"; then
      continue
    fi
    return 0
  done
  return 1
}

do_uninstall() {
  local target_dir="$(get_target_path "$TARGET")"

  info "uninstalling skills from $target_dir"
  $DRY_RUN && info "(dry-run mode -- no changes will be made)"
  echo

  local skills
  skills="$(get_skills)"

  while IFS= read -r name; do
    uninstall_skill "$name" "$target_dir"
  done <<< "$skills"

  # Remove _shared/ symlinks too, but only once nothing is left to depend on them.
  # Skills reach _shared/ via absolute paths at runtime (see install_shared_dirs),
  # so unlinking it while siblings stay installed breaks them -- which is exactly
  # what a filtered `--uninstall -s <one-skill>` used to do.
  local sname
  for shared in "$SKILLS_DIR"/_*/; do
    [[ -d "$shared" ]] || continue
    sname="$(basename "$shared")"
    if has_dependent_skills "$target_dir" "$skills"; then
      info "skip: $sname (still required by other installed skills)"
      ((COUNT_SKIPPED++)) || true
      continue
    fi
    uninstall_skill "$sname" "$target_dir"
  done
}

# ─── Summary ─────────────────────────────────────────────────────────────────

print_summary() {
  echo
  printf "${BOLD}Summary${RESET}\n"
  if $UNINSTALL; then
    printf "  uninstalled: %d  skipped: %d  warnings: %d  errors: %d\n" \
      "$COUNT_UNINSTALLED" "$COUNT_SKIPPED" "$COUNT_WARNINGS" "$COUNT_ERRORS"
  else
    printf "  installed: %d  skipped: %d  warnings: %d  errors: %d\n" \
      "$COUNT_INSTALLED" "$COUNT_SKIPPED" "$COUNT_WARNINGS" "$COUNT_ERRORS"
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  parse_args "$@"

  if $LIST_MODE; then
    for TARGET in $TARGETS; do
      do_list
    done
    exit 0
  fi

  for TARGET in $TARGETS; do
    if $UNINSTALL; then
      do_uninstall
    else
      do_install
    fi
  done

  print_summary
}

main "$@"
