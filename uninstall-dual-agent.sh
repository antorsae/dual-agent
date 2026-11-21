#!/bin/bash
# Remove registrations and installed skills; preserve profiles, projects, and jobs.
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/scripts/integrations.sh"
source "$SCRIPT_DIR/scripts/terminal-picker.sh"
source "$SCRIPT_DIR/scripts/caller-homes.sh"
REMOVED=0

fail() { echo "$*" >&2; exit 1; }

remove_server() {
    local host="$1" caller_home="$2" server="$3" config updated
    local -a args=(mcp remove "$server")
    config="$(caller_registry "$host" "$caller_home")"
    if [ "$host" = claude ]; then args+=(--scope user); fi
    if caller_cli "$host" "$caller_home" "${args[@]}" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Removed $server from $caller_home"
    elif [ "$host" != codex ] && [ -s "$config" ] && command -v jq >/dev/null &&
        jq -e --arg server "$server" '.mcpServers[$server]' "$config" >/dev/null 2>&1; then
        updated=$(jq --arg server "$server" 'del(.mcpServers[$server])' "$config")
        printf '%s\n' "$updated" > "$config"
        echo -e "  ${GREEN}[OK]${NC} Removed $server from $config"
    else
        echo -e "  ${YELLOW}[SKIP]${NC} $server not removed from $caller_home"
        return 0
    fi
    REMOVED=$((REMOVED + 1))
}

remove_skills() {
    local directory="$1" skill
    shift
    for skill in "$@"; do
        if [ -d "$directory/$skill" ]; then
            rm -rf "$directory/$skill"
            echo -e "  ${GREEN}[OK]${NC} Removed $directory/$skill"
            REMOVED=$((REMOVED + 1))
        fi
    done
}

remove_legacy_claude_settings() {
    local file="$1" servers="$2" updated
    [ -f "$file" ] && command -v jq >/dev/null || return 0
    updated=$(jq --arg servers "$servers" '
if .permissions.allow then .permissions.allow -= [
  "Bash(cat .agent-collab:*)",
  "Bash(echo idle > .agent-collab/status)",
  "Bash(echo pending > .agent-collab/status)",
  "Bash(echo working > .agent-collab/status)",
  "Bash(echo done > .agent-collab/status)",
  "Bash(while [ \"$(cat .agent-collab/status)\" != \"done\" ]; do sleep:*)",
  "Bash(tmux send-keys:*)"
] else . end
| reduce ($servers | split(" "))[] as $server (. ; del(.mcpServers[$server]))
' "$file")
    printf '%s\n' "$updated" > "$file"
    echo -e "  ${GREEN}[OK]${NC} Removed legacy dual-agent settings from $file"
    REMOVED=$((REMOVED + 1))
}

remove_home() {
    local row="$1" host="${CALLERS[$1]}" caller_home="${CALLER_HOMES[$1]}" column index server
    local -a servers=()
    for column in "${!WORKERS[@]}"; do
        index=$((row * ${#WORKERS[@]} + column))
        [ -n "${CELLS[$index]}" ] || continue
        server="${WORKERS[$column]}-delegate"
        servers+=("$server")
        remove_server "$host" "$caller_home" "$server"
    done
    if [ "$host" = agy ]; then remove_skills "$caller_home/skills" dual-agent-review; return; fi
    servers+=(gemini-delegate)
    remove_server "$host" "$caller_home" gemini-delegate
    if [ "$host" = claude ]; then
        remove_skills "$caller_home/skills" "${servers[@]}" codex-read codex-status codex-implement codex-plan-review codex-review
        remove_legacy_claude_settings "$caller_home/settings.json" "${servers[*]}"
    else
        remove_skills "$caller_home/skills" "${servers[@]}" claude-status read-task respond
    fi
}

init_homes || fail "Could not resolve the active caller homes."
echo -e "${BLUE}Dual Agent Environment Uninstall${NC}"
if [ "$#" -eq 0 ]; then
    choose_homes "have their integrations removed" remove
else
    set_all_homes 0
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --home) [ "$#" -ge 2 ] || fail "--home requires HOST or HOST@/path."
                resolve_target "$2" || fail "Invalid caller home: $2"
                HOME_SELECTED[$TARGET_ROW]=1; shift 2 ;;
            --help|-h) echo "Usage: $0 [--home HOST[@/path]]..."; echo "With no options, choose homes interactively."; exit 0 ;;
            *) fail "Unknown option: $1. Use --help for usage." ;;
        esac
    done
fi
for row in "${!CALLERS[@]}"; do
    if [ "${HOME_SELECTED[$row]}" -eq 1 ]; then remove_home "$row"; fi
done

echo -e "${GREEN}Uninstall Complete!${NC}"
echo "Removed $REMOVED items. Restart the affected hosts to unload MCP tools."
echo "Saved task results and project files were preserved."
