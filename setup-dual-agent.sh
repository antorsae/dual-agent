#!/bin/bash
#
# Setup script for Dual Agent Development Environment
# Run this once to install skills and configure the environment
#
# Usage:
#   ./setup-dual-agent.sh          # Interactive component selection
#   ./setup-dual-agent.sh --codex-mcp   # Install Codex delegation for Claude
#   ./setup-dual-agent.sh --mcp    # Alias for --codex-mcp
#   ./setup-dual-agent.sh --claude-mcp  # Install Claude delegation for Codex
#   ./setup-dual-agent.sh --rosalind-mcp # Install Rosalind delegation for Claude and Codex
#   ./setup-dual-agent.sh --codex-from-codex # Install Codex delegation for Codex
#   ./setup-dual-agent.sh --both    # Install both delegation directions
#   ./setup-dual-agent.sh --all    # Install all components (non-interactive)
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERBOSE="${DUAL_AGENT_VERBOSE:-0}"
INSTALL_LOG="${DUAL_AGENT_INSTALL_LOG:-${TMPDIR:-/tmp}/dual-agent-setup-$$.log}"
VERIFY_ROSALIND_PROFILE="${ROSALIND_VERIFY_PROFILE:-0}"
INTERACTIVE_INSTALL=0
for setup_arg in "$@"; do
    [ "$setup_arg" = "--verify-rosalind-profile" ] && VERIFY_ROSALIND_PROFILE=1
done

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}  Dual Agent Environment Setup${NC}"
echo -e "${BLUE}=======================================${NC}"
echo ""

# Detect OS and package manager
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        PKG_MANAGER="brew"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        if command -v apt-get &> /dev/null; then
            PKG_MANAGER="apt"
        elif command -v dnf &> /dev/null; then
            PKG_MANAGER="dnf"
        elif command -v yum &> /dev/null; then
            PKG_MANAGER="yum"
        elif command -v pacman &> /dev/null; then
            PKG_MANAGER="pacman"
        elif command -v zypper &> /dev/null; then
            PKG_MANAGER="zypper"
        elif command -v apk &> /dev/null; then
            PKG_MANAGER="apk"
        else
            PKG_MANAGER="unknown"
        fi
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
        PKG_MANAGER="none"
    else
        OS="unknown"
        PKG_MANAGER="unknown"
    fi
    echo -e "  ${BLUE}[INFO]${NC} Detected OS: $OS ($PKG_MANAGER)"
}

# Get install command for a package based on OS/package manager
get_install_hint() {
    local pkg="$1"
    case "$PKG_MANAGER" in
        brew)    echo "brew install $pkg" ;;
        apt)     echo "sudo apt install $pkg" ;;
        dnf)     echo "sudo dnf install $pkg" ;;
        yum)     echo "sudo yum install $pkg" ;;
        pacman)  echo "sudo pacman -S $pkg" ;;
        zypper)  echo "sudo zypper install $pkg" ;;
        apk)     echo "sudo apk add $pkg" ;;
        *)       echo "install $pkg using your package manager" ;;
    esac
}

check_install() {
    if command -v "$1" &> /dev/null; then
        echo -e "  ${GREEN}[OK]${NC} $1"
        return 0
    else
        echo -e "  ${RED}[MISSING]${NC} $1 - $2"
        return 1
    fi
}

fail() {
    echo -e "${RED}✗ $*${NC}" >&2
    if [ -s "$INSTALL_LOG" ]; then
        echo "Details: $INSTALL_LOG" >&2
        if [ "$VERBOSE" != "1" ]; then
            echo "Last output:" >&2
            show_log_tail >&2 || true
        fi
    fi
    exit 1
}

run_logged() {
    local status
    if [ "$VERBOSE" = "1" ]; then
        if command -v tee >/dev/null 2>&1; then
            if "$@" 2>&1 | tee -a "$INSTALL_LOG"; then
                status=${PIPESTATUS[0]}
            else
                status=${PIPESTATUS[0]}
            fi
        else
            if "$@"; then
                status=0
            else
                status=$?
            fi
        fi
    else
        if "$@" >> "$INSTALL_LOG" 2>&1; then
            status=0
        else
            status=$?
        fi
    fi
    return "$status"
}

run_step() {
    local label="$1"
    shift
    printf "  %s..." "$label"
    if run_logged "$@"; then
        echo -e " ${GREEN}done${NC}"
    else
        echo -e " ${RED}failed${NC}"
        return 1
    fi
}

show_log_tail() {
    local line
    local -a recent=()
    while IFS= read -r line; do
        recent+=("$line")
        if [ "${#recent[@]}" -gt 20 ]; then
            recent=("${recent[@]:1}")
        fi
    done < "$INSTALL_LOG"
    printf '%s\n' "${recent[@]}"
}

selection_mark() {
    if [ "$1" -eq 1 ]; then
        printf "[x]"
    else
        printf "[ ]"
    fi
}

INSTALL_MCP=0
INSTALL_CLAUDE_MCP=0
INSTALL_ROSALIND=0
INSTALL_CODEX_FROM_CODEX=0

case "${1:-}" in
    --all)
        INSTALL_MCP=1
        INSTALL_CLAUDE_MCP=1
        INSTALL_ROSALIND=1
        INSTALL_CODEX_FROM_CODEX=1
        ;;
    --codex-mcp|--mcp) INSTALL_MCP=1 ;;
    --claude-mcp) INSTALL_CLAUDE_MCP=1 ;;
    --rosalind-mcp|--rosalind) INSTALL_ROSALIND=1 ;;
    --codex-from-codex) INSTALL_CODEX_FROM_CODEX=1 ;;
    --verify-rosalind-profile) INSTALL_ROSALIND=1; VERIFY_ROSALIND_PROFILE=1 ;;
    --both) INSTALL_MCP=1; INSTALL_CLAUDE_MCP=1 ;;
    --help|-h)
        echo "Usage: $0 [option]"
        echo "Without arguments, choose integrations from the installation menu."
        echo "  --codex-mcp  Use Codex from Claude Code (MCP tools and skill)"
        echo "  --claude-mcp Use Claude from Codex (MCP tools and skill)"
        echo "  --rosalind-mcp Use Rosalind (Codex profile) from Claude Code and Codex"
        echo "  --codex-from-codex Use Codex from Codex (MCP tools and skill)"
        echo "  --verify-rosalind-profile Run one live Rosalind profile check"
        echo "  --both       Install both delegation integrations"
        echo "  --all        Install all delegation integrations"
        echo "  --mcp        Alias for --codex-mcp"
        exit 0
        ;;
    "")
        INTERACTIVE_INSTALL=1
        while true; do
            echo "Select integrations (toggle a number, then continue):"
            echo "  1) $(selection_mark "$INSTALL_MCP") Use Codex from Claude Code (MCP tools and skill)"
            echo "  2) $(selection_mark "$INSTALL_CLAUDE_MCP") Use Claude from Codex (MCP tools and skill)"
            echo "  3) $(selection_mark "$INSTALL_ROSALIND") Use Rosalind from Claude Code and Codex"
            echo "  4) $(selection_mark "$INSTALL_CODEX_FROM_CODEX") Use Codex from Codex (MCP tools and skill)"
            echo "  a) Select all    n) Clear all    c) Continue"
            if ! read -r -n 1 -p "Toggle 1-4, a/n, or c: " choice; then
                fail "No selection received. Use --codex-mcp, --claude-mcp, --rosalind-mcp, --codex-from-codex, --both, or --all for unattended setup."
            fi
            echo ""
            case "$choice" in
                1) INSTALL_MCP=$((1 - INSTALL_MCP)) ;;
                2) INSTALL_CLAUDE_MCP=$((1 - INSTALL_CLAUDE_MCP)) ;;
                3) INSTALL_ROSALIND=$((1 - INSTALL_ROSALIND)) ;;
                4) INSTALL_CODEX_FROM_CODEX=$((1 - INSTALL_CODEX_FROM_CODEX)) ;;
                a|A) INSTALL_MCP=1; INSTALL_CLAUDE_MCP=1; INSTALL_ROSALIND=1; INSTALL_CODEX_FROM_CODEX=1 ;;
                n|N) INSTALL_MCP=0; INSTALL_CLAUDE_MCP=0; INSTALL_ROSALIND=0; INSTALL_CODEX_FROM_CODEX=0 ;;
                c|C) break ;;
                *) echo "Invalid choice" ;;
            esac
        done
        ;;
    *) fail "Unknown option: $1. Use --help for usage." ;;
esac

if [ "$INTERACTIVE_INSTALL" -eq 1 ] && [ "$INSTALL_ROSALIND" -eq 1 ] && [ "$VERIFY_ROSALIND_PROFILE" != "1" ] && [ -t 0 ]; then
    printf "Run one live Rosalind profile check? This sends one Codex request. [y/N]: "
    read -r verify_choice || verify_choice="n"
    case "$verify_choice" in
        y|Y|yes|YES) VERIFY_ROSALIND_PROFILE=1 ;;
    esac
fi

if [ "$INSTALL_MCP$INSTALL_CLAUDE_MCP$INSTALL_ROSALIND$INSTALL_CODEX_FROM_CODEX" = "0000" ]; then
    echo "Nothing selected. Exiting."
    exit 0
fi

: > "$INSTALL_LOG" 2>/dev/null || fail "Cannot write installer log: $INSTALL_LOG"

echo -e "${BLUE}[1/4]${NC} Checking prerequisites"
detect_os
MISSING=0
if [ "$INSTALL_MCP" -eq 1 ] || [ "$INSTALL_ROSALIND" -eq 1 ]; then
    check_install claude "Install from: https://code.claude.com/docs/en/setup" || MISSING=1
fi
if [ "$INSTALL_MCP" -eq 1 ] || [ "$INSTALL_CLAUDE_MCP" -eq 1 ] || [ "$INSTALL_ROSALIND" -eq 1 ] || [ "$INSTALL_CODEX_FROM_CODEX" -eq 1 ]; then
    check_install node "Install from: https://nodejs.org" || MISSING=1
    check_install npm "Install Node.js with npm" || MISSING=1
fi
if [ "$INSTALL_CLAUDE_MCP" -eq 1 ] || [ "$INSTALL_ROSALIND" -eq 1 ] || [ "$INSTALL_CODEX_FROM_CODEX" -eq 1 ]; then
    check_install codex "Install from: https://github.com/openai/codex" || MISSING=1
fi
if [ "$INSTALL_MCP" -eq 1 ] || [ "$INSTALL_ROSALIND" -eq 1 ] || [ "$INSTALL_CODEX_FROM_CODEX" -eq 1 ]; then
    DELEGATE_CODEX_BIN="${CODEX_BIN:-codex-pool}"
    if [ "$DELEGATE_CODEX_BIN" = "codex-pool" ] && ! command -v codex-pool &> /dev/null; then
        echo -e "  ${YELLOW}[WARN]${NC} codex-pool not found on PATH; falling back to codex"
        DELEGATE_CODEX_BIN="codex"
    fi
    check_install "$DELEGATE_CODEX_BIN" "Put it on PATH, or set CODEX_BIN to another Codex binary" || MISSING=1
fi
if [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    DELEGATE_CLAUDE_BIN="${CLAUDE_BIN:-claude}"
    check_install "$DELEGATE_CLAUDE_BIN" "Put it on PATH, or set CLAUDE_BIN" || MISSING=1
    if command -v "$DELEGATE_CLAUDE_BIN" >/dev/null; then
        DELEGATE_CLAUDE_BIN="$(command -v "$DELEGATE_CLAUDE_BIN")"
    fi
fi
if [ "$MISSING" -eq 1 ]; then
    fail "Install the missing dependencies and run setup again."
fi
echo -e "  ${GREEN}done${NC}"

AGENT_DIR="$SCRIPT_DIR/agent"
DELEGATE_STATE_DIR="${DUAL_AGENT_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/dual-agent}"
case "$DELEGATE_STATE_DIR" in /*) ;; *) fail "DUAL_AGENT_STATE_DIR must be an absolute path." ;; esac
DELEGATE_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

if [ "$INSTALL_ROSALIND" -eq 1 ]; then
    ROSALIND_PROFILE_FILE="$DELEGATE_CODEX_HOME/rosalind_delegate.config.toml"
    [ -f "$ROSALIND_PROFILE_FILE" ] || fail "Rosalind Codex profile not found: $ROSALIND_PROFILE_FILE. Create this profile before installing Rosalind."
    echo "  Rosalind Codex profile: using existing $ROSALIND_PROFILE_FILE"
    verify_rosalind_profile() {
        local answer_file="${INSTALL_LOG}.rosalind-answer"
        local prompt="Reply with exactly: ROSALIND_PROFILE_OK"
        rm -f "$answer_file"
        if ! printf '%s\n' "$prompt" | CODEX_HOME="$DELEGATE_CODEX_HOME" "$DELEGATE_CODEX_BIN" -p rosalind_delegate exec \
            --ephemeral --sandbox read-only --skip-git-repo-check --json \
            --output-last-message "$answer_file" - >> "$INSTALL_LOG" 2>&1; then
            rm -f "$answer_file"
            return 1
        fi
        if [ ! -s "$answer_file" ]; then
            rm -f "$answer_file"
            return 1
        fi
        local answer
        answer="$(<"$answer_file")"
        rm -f "$answer_file"
        [[ "$answer" == *"ROSALIND_PROFILE_OK"* ]]
    }
    if [ "$VERIFY_ROSALIND_PROFILE" = "1" ]; then
        if ! run_step "Live Rosalind profile check" verify_rosalind_profile; then
            fail "The live Rosalind profile check failed."
        fi
    fi
fi

install_skill() {
    local source="$1" destination="$2"
    [ -f "$source/SKILL.md" ] || fail "Skill not found: $source/SKILL.md"
    mkdir -p "$destination"
    cp -R "$source/." "$destination/"
}

# Codex starts stdio MCP servers with a minimal environment, so a delegated
# Codex worker lacks provider API keys unless the registration lists them in
# env_vars. Collect the variable names that model providers read (env_key).
codex_env_keys() {
    local file line keys=" "
    local pattern="env_key[[:space:]]*=[[:space:]]*[\"']([A-Za-z_][A-Za-z0-9_]*)[\"']"
    for file in "$@"; do
        [ -f "$file" ] || continue
        while IFS= read -r line || [ -n "$line" ]; do
            if [[ "$line" =~ $pattern ]] && [[ "$keys" != *" ${BASH_REMATCH[1]} "* ]]; then
                keys+="${BASH_REMATCH[1]} "
            fi
        done < "$file"
    done
    keys="${keys# }"
    printf '%s' "${keys% }"
}

# codex mcp add cannot set env_vars, so insert it below the server's table
# header. Rewriting in place keeps the file's mode and any symlink.
add_codex_env_vars() {
    local server="$1" keys="$2" config="$DELEGATE_CODEX_HOME/config.toml"
    local line name list="" found=0
    local -a lines=()
    for name in $keys; do list+="${list:+, }\"$name\""; done
    [ -f "$config" ] || { echo "Codex config not found: $config" >&2; return 1; }
    while IFS= read -r line || [ -n "$line" ]; do
        lines+=("$line")
        if [ "$line" = "[mcp_servers.$server]" ]; then
            lines+=("env_vars = [$list]")
            found=1
        fi
    done < "$config"
    [ "$found" -eq 1 ] || { echo "[mcp_servers.$server] not found in $config" >&2; return 1; }
    printf '%s\n' "${lines[@]}" > "$config"
}

# Read a value saved in a Codex MCP registration's [mcp_servers.<name>.env] table.
codex_registration_env() {
    local server="$1" key="$2" config="$DELEGATE_CODEX_HOME/config.toml" line section=""
    local pattern="^${key}[[:space:]]*=[[:space:]]*\"([^\"]*)\""
    [ -f "$config" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        [[ "$line" == "["* ]] && section="$line"
        if [ "$section" = "[mcp_servers.$server.env]" ] && [[ "$line" =~ $pattern ]]; then
            printf '%s' "${BASH_REMATCH[1]}"
            return 0
        fi
    done < "$config"
}

forward_codex_keys() {
    local server="$1" keys
    shift
    keys="$(codex_env_keys "$@")"
    [ -n "$keys" ] || return 0
    if ! run_step "$server API key forwarding ($keys)" add_codex_env_vars "$server" "$keys"; then
        fail "Could not add env_vars = [$keys] to [mcp_servers.$server] in $DELEGATE_CODEX_HOME/config.toml."
    fi
}

echo -e "${BLUE}[2/4]${NC} Building agent package"
if [ "$INSTALL_MCP" -eq 1 ] || [ "$INSTALL_CLAUDE_MCP" -eq 1 ] || [ "$INSTALL_ROSALIND" -eq 1 ] || [ "$INSTALL_CODEX_FROM_CODEX" -eq 1 ]; then
    [ -d "$AGENT_DIR" ] || fail "Agent package not found: $AGENT_DIR"
    build_agent() { (cd "$AGENT_DIR" && npm ci && npm run build); }
    if ! run_step "MCP servers" build_agent; then
        fail "Agent install/build failed."
    fi
else
    echo "  skipped"
fi

echo -e "${BLUE}[3/4]${NC} Registering integrations"

if [ "$INSTALL_MCP" -eq 1 ]; then
    MCP_SERVER_PATH="$AGENT_DIR/dist/mcp.js"
    [ -f "$MCP_SERVER_PATH" ] || fail "MCP build output not found: $MCP_SERVER_PATH"
    run_logged claude mcp remove codex-delegate --scope user || true
    if ! run_step "codex-delegate → Claude Code" claude mcp add --scope user codex-delegate --env "CODEX_BIN=$DELEGATE_CODEX_BIN" --env "DUAL_AGENT_STATE_DIR=$DELEGATE_STATE_DIR" --env "CODEX_HOME=$DELEGATE_CODEX_HOME" -- node "$MCP_SERVER_PATH"; then
        fail "Could not register codex-delegate. Fix the Claude CLI error above and rerun setup."
    fi
    if ! run_step "codex-delegate skill" install_skill "$SCRIPT_DIR/.claude/skills/codex-delegate" "$HOME/.claude/skills/codex-delegate"; then
        fail "Could not install the codex-delegate skill."
    fi
fi

if [ "$INSTALL_ROSALIND" -eq 1 ]; then
    ROSALIND_CLAUDE_SERVER_PATH="$AGENT_DIR/dist/rosalindMcp.js"
    ROSALIND_CODEX_SERVER_PATH="$AGENT_DIR/dist/rosalindCodexMcp.js"
    [ -f "$ROSALIND_CLAUDE_SERVER_PATH" ] || fail "MCP build output not found: $ROSALIND_CLAUDE_SERVER_PATH"
    [ -f "$ROSALIND_CODEX_SERVER_PATH" ] || fail "MCP build output not found: $ROSALIND_CODEX_SERVER_PATH"
    ROSALIND_SERVER_ENV=(--env "CODEX_BIN=$DELEGATE_CODEX_BIN" --env "DUAL_AGENT_STATE_DIR=$DELEGATE_STATE_DIR" --env "CODEX_HOME=$DELEGATE_CODEX_HOME")
    run_logged claude mcp remove rosalind-delegate --scope user || true
    if ! run_step "rosalind-delegate → Claude Code" claude mcp add --scope user rosalind-delegate "${ROSALIND_SERVER_ENV[@]}" -- node "$ROSALIND_CLAUDE_SERVER_PATH"; then
        fail "Could not register rosalind-delegate for Claude. Fix the Claude CLI error above and rerun setup."
    fi
    run_logged codex mcp remove rosalind-delegate || true
    if ! run_step "rosalind-delegate → Codex" codex mcp add rosalind-delegate "${ROSALIND_SERVER_ENV[@]}" -- node "$ROSALIND_CODEX_SERVER_PATH"; then
        fail "Could not register rosalind-delegate for Codex. Fix the Codex CLI error above and rerun setup."
    fi
    forward_codex_keys rosalind-delegate "$DELEGATE_CODEX_HOME/config.toml" "$ROSALIND_PROFILE_FILE"
    if ! run_step "rosalind-delegate skills" install_skill "$SCRIPT_DIR/.claude/skills/rosalind-delegate" "$HOME/.claude/skills/rosalind-delegate"; then
        fail "Could not install the Claude Rosalind skill."
    fi
    if ! run_step "rosalind-delegate Codex skill" install_skill "$SCRIPT_DIR/.codex/skills/rosalind-delegate" "$DELEGATE_CODEX_HOME/skills/rosalind-delegate"; then
        fail "Could not install the Codex Rosalind skill."
    fi
fi

if [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    CLAUDE_MCP_SERVER_PATH="$AGENT_DIR/dist/claudeMcp.js"
    [ -f "$CLAUDE_MCP_SERVER_PATH" ] || fail "MCP build output not found: $CLAUDE_MCP_SERVER_PATH"
    CLAUDE_SERVER_ENV=(--env "CLAUDE_BIN=$DELEGATE_CLAUDE_BIN" --env "DUAL_AGENT_STATE_DIR=$DELEGATE_STATE_DIR")
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
        CLAUDE_SERVER_ENV+=(--env "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR")
    fi
    # Headless claude -p ignores effortLevel from Claude settings. Keep a saved
    # worker effort unless CLAUDE_CODE_EFFORT_LEVEL selects a new one.
    CLAUDE_WORKER_EFFORT="${CLAUDE_CODE_EFFORT_LEVEL:-$(codex_registration_env claude-delegate CLAUDE_CODE_EFFORT_LEVEL)}"
    if [ -n "$CLAUDE_WORKER_EFFORT" ]; then
        CLAUDE_SERVER_ENV+=(--env "CLAUDE_CODE_EFFORT_LEVEL=$CLAUDE_WORKER_EFFORT")
    fi
    run_logged codex mcp remove claude-delegate || true
    if ! run_step "claude-delegate → Codex" codex mcp add claude-delegate "${CLAUDE_SERVER_ENV[@]}" -- node "$CLAUDE_MCP_SERVER_PATH"; then
        fail "Could not register claude-delegate. Fix the Codex CLI error above and rerun setup."
    fi
    if ! run_step "claude-delegate skill" install_skill "$SCRIPT_DIR/.codex/skills/claude-delegate" "$DELEGATE_CODEX_HOME/skills/claude-delegate"; then
        fail "Could not install the claude-delegate skill."
    fi
fi

if [ "$INSTALL_CODEX_FROM_CODEX" -eq 1 ]; then
    CODEX_CODEX_SERVER_PATH="$AGENT_DIR/dist/codexCodexMcp.js"
    [ -f "$CODEX_CODEX_SERVER_PATH" ] || fail "MCP build output not found: $CODEX_CODEX_SERVER_PATH"
    run_logged codex mcp remove codex-delegate || true
    if ! run_step "codex-delegate → Codex" codex mcp add codex-delegate --env "CODEX_BIN=$DELEGATE_CODEX_BIN" --env "DUAL_AGENT_STATE_DIR=$DELEGATE_STATE_DIR" --env "CODEX_HOME=$DELEGATE_CODEX_HOME" -- node "$CODEX_CODEX_SERVER_PATH"; then
        fail "Could not register codex-delegate for Codex. Fix the Codex CLI error above and rerun setup."
    fi
    forward_codex_keys codex-delegate "$DELEGATE_CODEX_HOME/config.toml"
    if ! run_step "codex-delegate Codex skill" install_skill "$SCRIPT_DIR/.codex/skills/codex-delegate" "$DELEGATE_CODEX_HOME/skills/codex-delegate"; then
        fail "Could not install the Codex codex-delegate skill."
    fi
fi

echo -e "${BLUE}[4/4]${NC} Finalizing"
echo -e "  ${GREEN}done${NC}"
echo ""
echo -e "${GREEN}Setup Complete!${NC}"
if [ "$INSTALL_MCP" -eq 1 ]; then
    echo "Restart Claude Code, then ask it to review or implement something using Codex."
    echo "Tools: delegate_codex_review, delegate_codex_implement, delegate_codex_plan_review, delegate_codex"
    echo "Jobs: delegate_codex_status, delegate_codex_list, delegate_codex_cancel"
    echo "Check registration: claude mcp get codex-delegate"
fi
if [ "$INSTALL_ROSALIND" -eq 1 ]; then
    echo "Restart Claude Code and Codex, then use the delegate_rosalind_* tools for Codex with the rosalind_delegate profile."
    echo "Tools: delegate_rosalind_review, delegate_rosalind_implement, delegate_rosalind_plan_review, delegate_rosalind"
    echo "Jobs: delegate_rosalind_status, delegate_rosalind_list, delegate_rosalind_cancel"
    echo "Check registrations: claude mcp get rosalind-delegate; codex mcp get rosalind-delegate"
fi
if [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    echo "Restart Codex to load Claude's review, implementation, plan-review, and custom task tools."
    echo "Jobs: delegate_claude_status, delegate_claude_list, delegate_claude_cancel"
    echo "Check registration: codex mcp get claude-delegate"
    if [ -n "$CLAUDE_WORKER_EFFORT" ]; then
        echo "Claude worker effort: $CLAUDE_WORKER_EFFORT"
    fi
fi
if [ "$INSTALL_CODEX_FROM_CODEX" -eq 1 ]; then
    echo "Restart Codex to load the delegate_codex_* tools. Workers use the default Codex configuration, not the session's profile."
    echo "Check registration: codex mcp get codex-delegate"
fi
