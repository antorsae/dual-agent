#!/bin/bash
# Install the selected delegation servers and host skills. See --help for options.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/scripts/integrations.sh"
VERBOSE="${DUAL_AGENT_VERBOSE:-0}"
INSTALL_LOG="${DUAL_AGENT_INSTALL_LOG:-${TMPDIR:-/tmp}/dual-agent-setup-$$.log}"
VERIFY_ROSALIND_PROFILE="${ROSALIND_VERIFY_PROFILE:-0}"
SELECTED=()
for index in "${!INTEGRATIONS[@]}"; do SELECTED+=(0); done

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
    if [ "$VERBOSE" = "1" ]; then
        if command -v tee >/dev/null 2>&1; then
            if "$@" 2>&1 | tee -a "$INSTALL_LOG"; then
                return 0
            else
                return "${PIPESTATUS[0]}"
            fi
        else
            "$@"
        fi
    else
        "$@" >> "$INSTALL_LOG" 2>&1
    fi
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

select_all() {
    local index
    for index in "${!INTEGRATIONS[@]}"; do SELECTED[$index]="$1"; done
}

select_option() {
    local index
    for index in "${!INTEGRATIONS[@]}"; do
        load_integration "$index"
        if [ "$1" = "$INTEGRATION_OPTION" ]; then
            SELECTED[$index]=1
            return 0
        fi
    done
    fail "Unknown option: $1. Use --help for usage."
}

show_help() {
    local index
    echo "Usage: $0 [options]"
    echo "Without arguments, choose integrations from the installation menu."
    for index in "${!INTEGRATIONS[@]}"; do
        load_integration "$index"
        printf '  %-22s Use %s from %s\n' "$INTEGRATION_OPTION" "$INTEGRATION_LABEL" "$INTEGRATION_HOST_LABEL"
    done
    echo "  --both                 Install the two original delegation directions"
    echo "  --all                  Install all delegation integrations"
    echo "  --verify-rosalind-profile Run one live Rosalind profile check"
    echo "  --mcp, --rosalind, --gemini Alias their corresponding --*-mcp options"
    echo "Options may be combined. Each integration is installed once."
}

for setup_arg in "$@"; do
    case "$setup_arg" in
        --all) select_all 1 ;;
        --both) select_option --codex-mcp; select_option --claude-mcp ;;
        --mcp) select_option --codex-mcp ;;
        --rosalind) select_option --rosalind-mcp ;;
        --gemini) select_option --gemini-mcp ;;
        --verify-rosalind-profile) select_option --rosalind-mcp; VERIFY_ROSALIND_PROFILE=1 ;;
        --help|-h) show_help; exit 0 ;;
        *) select_option "$setup_arg" ;;
    esac
done

echo -e "${BLUE}Dual Agent Environment Setup${NC}"
if [ "$#" -eq 0 ]; then
    while true; do
        echo "Select integrations (toggle a number, then continue):"
        for index in "${!INTEGRATIONS[@]}"; do
            load_integration "$index"
            mark=" "
            [ "${SELECTED[$index]}" -eq 0 ] || mark="x"
            echo "  $((index + 1))) [$mark] Use $INTEGRATION_LABEL from $INTEGRATION_HOST_LABEL"
        done
        echo "  a) Select all    n) Clear all    c) Continue"
        if ! read -r -n 1 -p "Toggle 1-${#INTEGRATIONS[@]}, a/n, or c: " choice; then
            fail "No selection received. Use --help for unattended setup options."
        fi
        echo ""
        case "$choice" in
            [1-9])
                if [ "$choice" -le "${#INTEGRATIONS[@]}" ]; then
                    index=$((choice - 1))
                    SELECTED[$index]=$((1 - SELECTED[index]))
                else
                    echo "Invalid choice"
                fi
                ;;
            a|A) select_all 1 ;;
            n|N) select_all 0 ;;
            c|C) break ;;
            *) echo "Invalid choice" ;;
        esac
    done
fi

SELECTION_COUNT=0
NEED_CLAUDE_HOST=0
NEED_CODEX_HOST=0
NEED_CLAUDE_WORKER=0
NEED_CODEX_WORKER=0
ROSALIND_SELECTED=0
for index in "${!INTEGRATIONS[@]}"; do
    [ "${SELECTED[$index]}" -eq 1 ] || continue
    SELECTION_COUNT=$((SELECTION_COUNT + 1))
    load_integration "$index"
    for host in $INTEGRATION_HOSTS; do
        case "$host" in claude) NEED_CLAUDE_HOST=1 ;; codex) NEED_CODEX_HOST=1 ;; esac
    done
    if [ "$INTEGRATION_PROVIDER" = "claude" ]; then NEED_CLAUDE_WORKER=1; else NEED_CODEX_WORKER=1; fi
    if [ "$INTEGRATION_PROVIDER" = "rosalind" ]; then ROSALIND_SELECTED=1; fi
done
if [ "$SELECTION_COUNT" -eq 0 ]; then
    echo "Nothing selected. Exiting."
    exit 0
fi

if [ "$#" -eq 0 ] && [ "$ROSALIND_SELECTED" -eq 1 ] && [ "$VERIFY_ROSALIND_PROFILE" != "1" ] && [ -t 0 ]; then
    printf "Run one live Rosalind profile check? This sends one Codex request. [y/N]: "
    read -r verify_choice || verify_choice="n"
    case "$verify_choice" in y|Y|yes|YES) VERIFY_ROSALIND_PROFILE=1 ;; esac
fi

: > "$INSTALL_LOG" 2>/dev/null || fail "Cannot write installer log: $INSTALL_LOG"
echo -e "${BLUE}[1/4]${NC} Checking prerequisites"
MISSING=0
check_install node "Install from: https://nodejs.org" || MISSING=1
check_install npm "Install Node.js with npm" || MISSING=1
if [ "$NEED_CLAUDE_HOST" -eq 1 ]; then
    check_install claude "Install from: https://code.claude.com/docs/en/setup" || MISSING=1
fi
if [ "$NEED_CODEX_HOST" -eq 1 ]; then
    check_install codex "Install from: https://github.com/openai/codex" || MISSING=1
fi
if [ "$NEED_CODEX_WORKER" -eq 1 ]; then
    DELEGATE_CODEX_BIN="${CODEX_BIN:-codex-pool}"
    if [ "$DELEGATE_CODEX_BIN" = "codex-pool" ] && ! command -v codex-pool &> /dev/null; then
        echo -e "  ${YELLOW}[WARN]${NC} codex-pool not found on PATH; falling back to codex"
        DELEGATE_CODEX_BIN="codex"
    fi
    check_install "$DELEGATE_CODEX_BIN" "Put it on PATH, or set CODEX_BIN to another Codex binary" || MISSING=1
fi
if [ "$NEED_CLAUDE_WORKER" -eq 1 ]; then
    DELEGATE_CLAUDE_BIN="${CLAUDE_BIN:-claude}"
    check_install "$DELEGATE_CLAUDE_BIN" "Put it on PATH, or set CLAUDE_BIN" || MISSING=1
    if command -v "$DELEGATE_CLAUDE_BIN" >/dev/null; then
        DELEGATE_CLAUDE_BIN="$(command -v "$DELEGATE_CLAUDE_BIN")"
    fi
fi
[ "$MISSING" -eq 0 ] || fail "Install the missing dependencies and run setup again."

AGENT_DIR="$SCRIPT_DIR/agent"
DELEGATE_STATE_DIR="${DUAL_AGENT_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/dual-agent}"
case "$DELEGATE_STATE_DIR" in /*) ;; *) fail "DUAL_AGENT_STATE_DIR must be an absolute path." ;; esac
DELEGATE_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
for index in "${!INTEGRATIONS[@]}"; do
    [ "${SELECTED[$index]}" -eq 1 ] || continue
    load_integration "$index"
    [ -n "$INTEGRATION_PROFILE" ] || continue
    profile_file="$DELEGATE_CODEX_HOME/$INTEGRATION_PROFILE.config.toml"
    [ -f "$profile_file" ] || fail "$INTEGRATION_LABEL Codex profile not found: $profile_file. Configure codex -p $INTEGRATION_PROFILE before installing $INTEGRATION_LABEL."
    echo "  $INTEGRATION_LABEL Codex profile: using existing $profile_file"
done

verify_rosalind_profile() {
    local answer_file="${INSTALL_LOG}.rosalind-answer" answer
    rm -f "$answer_file"
    if ! printf '%s\n' "Reply with exactly: ROSALIND_PROFILE_OK" | CODEX_HOME="$DELEGATE_CODEX_HOME" "$DELEGATE_CODEX_BIN" -p rosalind_delegate exec \
        --ephemeral --sandbox read-only --skip-git-repo-check --json --output-last-message "$answer_file" -; then
        rm -f "$answer_file"
        return 1
    fi
    [ -s "$answer_file" ] || { rm -f "$answer_file"; return 1; }
    answer="$(<"$answer_file")"
    rm -f "$answer_file"
    [[ "$answer" == *"ROSALIND_PROFILE_OK"* ]]
}
if [ "$ROSALIND_SELECTED" -eq 1 ] && [ "$VERIFY_ROSALIND_PROFILE" = "1" ]; then
    run_step "Live Rosalind profile check" verify_rosalind_profile || fail "The live Rosalind profile check failed."
fi

install_skill() {
    local source="$1" destination="$2"
    mkdir -p "$destination" && cp -R "$source/." "$destination/"
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

register_integration() {
    local host="$1" provider="$2" profile="$3" server="$2-delegate" destination
    local entrypoint="$AGENT_DIR/dist/$(server_entrypoint "$provider" "$host")"
    local -a server_env=(--env "DUAL_AGENT_STATE_DIR=$DELEGATE_STATE_DIR")
    if [ "$provider" = "claude" ]; then
        server_env+=(--env "CLAUDE_BIN=$DELEGATE_CLAUDE_BIN")
        if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then server_env+=(--env "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"); fi
        if [ -n "$CLAUDE_WORKER_EFFORT" ]; then server_env+=(--env "CLAUDE_CODE_EFFORT_LEVEL=$CLAUDE_WORKER_EFFORT"); fi
    else
        server_env+=(--env "CODEX_BIN=$DELEGATE_CODEX_BIN" --env "CODEX_HOME=$DELEGATE_CODEX_HOME")
    fi
    if [ "$host" = "claude" ]; then
        destination="$HOME/.claude/skills/$server"
        run_logged claude mcp remove "$server" --scope user || true
        run_step "$server → Claude Code" claude mcp add --scope user "$server" "${server_env[@]}" -- node "$entrypoint" ||
            fail "Could not register $server for Claude. Fix the Claude CLI error above and rerun setup."
    else
        destination="$DELEGATE_CODEX_HOME/skills/$server"
        run_logged codex mcp remove "$server" || true
        run_step "$server → Codex" codex mcp add "$server" "${server_env[@]}" -- node "$entrypoint" ||
            fail "Could not register $server for Codex. Fix the Codex CLI error above and rerun setup."
        if [ "$provider" != "claude" ]; then
            local -a key_sources=("$DELEGATE_CODEX_HOME/config.toml")
            if [ -n "$profile" ]; then key_sources+=("$DELEGATE_CODEX_HOME/$profile.config.toml"); fi
            forward_codex_keys "$server" "${key_sources[@]}"
        fi
    fi
    run_step "$server $host skill" install_skill "$SCRIPT_DIR/.$host/skills/$server" "$destination" ||
        fail "Could not install the $host $server skill."
}

echo -e "${BLUE}[2/4]${NC} Building agent package"
[ -d "$AGENT_DIR" ] || fail "Agent package not found: $AGENT_DIR"
build_agent() { (cd "$AGENT_DIR" && npm ci && npm run build); }
run_step "MCP servers" build_agent || fail "Agent install/build failed."

# Check every selected artifact before replacing any existing registration.
for index in "${!INTEGRATIONS[@]}"; do
    [ "${SELECTED[$index]}" -eq 1 ] || continue
    load_integration "$index"
    for host in $INTEGRATION_HOSTS; do
        entrypoint="$AGENT_DIR/dist/$(server_entrypoint "$INTEGRATION_PROVIDER" "$host")"
        skill="$SCRIPT_DIR/.$host/skills/$INTEGRATION_PROVIDER-delegate/SKILL.md"
        [ -f "$entrypoint" ] || fail "MCP build output not found: $entrypoint"
        [ -f "$skill" ] || fail "Skill not found: $skill"
    done
done

# Read the saved effort before removing Claude's registration.
CLAUDE_WORKER_EFFORT=""
if [ "$NEED_CLAUDE_WORKER" -eq 1 ]; then
    CLAUDE_WORKER_EFFORT="${CLAUDE_CODE_EFFORT_LEVEL:-$(codex_registration_env claude-delegate CLAUDE_CODE_EFFORT_LEVEL)}"
fi
echo -e "${BLUE}[3/4]${NC} Registering integrations"
for index in "${!INTEGRATIONS[@]}"; do
    [ "${SELECTED[$index]}" -eq 1 ] || continue
    load_integration "$index"
    for host in $INTEGRATION_HOSTS; do
        register_integration "$host" "$INTEGRATION_PROVIDER" "$INTEGRATION_PROFILE"
    done
done

echo -e "${BLUE}[4/4]${NC} Finalizing"
echo -e "${GREEN}Setup Complete!${NC}"
for index in "${!INTEGRATIONS[@]}"; do
    [ "${SELECTED[$index]}" -eq 1 ] || continue
    load_integration "$index"
    prefix="delegate_$INTEGRATION_PROVIDER"
    echo "Restart $INTEGRATION_HOST_LABEL to load $INTEGRATION_LABEL delegation."
    echo "Tools: $prefix, ${prefix}_review, ${prefix}_implement, ${prefix}_plan_review"
    echo "Jobs: ${prefix}_status, ${prefix}_list, ${prefix}_cancel"
    if [ -n "$INTEGRATION_PROFILE" ]; then echo "Codex profile: $INTEGRATION_PROFILE"; fi
    for host in $INTEGRATION_HOSTS; do echo "Check registration: $host mcp get $INTEGRATION_PROVIDER-delegate"; done
done
if [ -n "$CLAUDE_WORKER_EFFORT" ]; then echo "Claude worker effort: $CLAUDE_WORKER_EFFORT"; fi
