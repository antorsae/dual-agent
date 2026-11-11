#!/bin/bash
# Remove registrations and installed skills; preserve profiles, projects, and jobs.
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/scripts/integrations.sh"
REMOVED=0
CLAUDE_SERVERS=()
CODEX_SERVERS=()

remove_server() {
    local host="$1" server="$2" config="$HOME/.claude.json" updated
    local -a args=(mcp remove "$server")
    if [ "$host" = "claude" ]; then args+=(--scope user); fi
    if "$host" "${args[@]}" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Removed $server from $host"
    elif [ "$host" = "claude" ] && [ -f "$config" ] && command -v jq >/dev/null &&
        jq -e --arg server "$server" '.mcpServers[$server]' "$config" >/dev/null 2>&1; then
        updated=$(jq --arg server "$server" 'del(.mcpServers[$server])' "$config")
        printf '%s\n' "$updated" > "$config"
        echo -e "  ${GREEN}[OK]${NC} Removed $server from $config"
    else
        echo -e "  ${YELLOW}[SKIP]${NC} $server not found in $host"
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

echo -e "${BLUE}Dual Agent Environment Uninstall${NC}"
echo -e "${YELLOW}Removing MCP servers...${NC}"
for index in "${!INTEGRATIONS[@]}"; do
    load_integration "$index"
    server="$INTEGRATION_PROVIDER-delegate"
    for host in $INTEGRATION_HOSTS; do
        remove_server "$host" "$server"
        case "$host" in
            claude) CLAUDE_SERVERS+=("$server") ;;
            codex) CODEX_SERVERS+=("$server") ;;
        esac
    done
done

# Include retired skills so upgrades can still be fully uninstalled.
CLAUDE_SKILLS=("${CLAUDE_SERVERS[@]}" codex-read codex-status codex-implement codex-plan-review codex-review)
CODEX_SKILLS=("${CODEX_SERVERS[@]}" claude-status read-task respond)
echo -e "${YELLOW}Removing host skills...${NC}"
remove_skills "$HOME/.claude/skills" "${CLAUDE_SKILLS[@]}"
remove_skills "${CODEX_HOME:-$HOME/.codex}/skills" "${CODEX_SKILLS[@]}"
for codex_dir in "$HOME"/.codex*/; do
    remove_skills "${codex_dir}skills" "${CODEX_SKILLS[@]}"
done

# Remove legacy permissions and obsolete settings-based MCP registrations.
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [ -f "$CLAUDE_SETTINGS" ] && command -v jq >/dev/null; then
    UPDATED=$(jq --arg servers "${CLAUDE_SERVERS[*]}" '
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
' "$CLAUDE_SETTINGS")
    printf '%s\n' "$UPDATED" > "$CLAUDE_SETTINGS"
    echo -e "  ${GREEN}[OK]${NC} Removed legacy dual-agent settings"
    REMOVED=$((REMOVED + 1))
fi

echo -e "${GREEN}Uninstall Complete!${NC}"
echo "Removed $REMOVED items. Restart Claude Code and Codex to unload MCP tools."
echo "Saved task results and project files were preserved."
