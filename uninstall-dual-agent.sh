#!/bin/bash
#
# Uninstall script for Dual Agent Development Environment
# Removes registrations and installed skills; preserves task data
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}  Dual Agent Environment Uninstall${NC}"
echo -e "${BLUE}=======================================${NC}"
echo ""

# Track what was removed
REMOVED=0

# 1. Remove MCP servers
echo -e "${YELLOW}Removing MCP servers...${NC}"
if claude mcp remove codex-delegate --scope user 2>/dev/null; then
    echo -e "  ${GREEN}[OK]${NC} Removed codex-delegate MCP server"
    REMOVED=$((REMOVED + 1))
else
    # Fallback: remove from ~/.claude.json manually
    CLAUDE_JSON="$HOME/.claude.json"
    if [ -f "$CLAUDE_JSON" ] && command -v jq &>/dev/null; then
        if jq -e '.mcpServers["codex-delegate"]' "$CLAUDE_JSON" >/dev/null 2>&1; then
            UPDATED=$(jq 'del(.mcpServers["codex-delegate"])' "$CLAUDE_JSON")
            echo "$UPDATED" > "$CLAUDE_JSON"
            echo -e "  ${GREEN}[OK]${NC} Removed codex-delegate from ~/.claude.json"
            REMOVED=$((REMOVED + 1))
        else
            echo -e "  ${YELLOW}[SKIP]${NC} codex-delegate not found in MCP config"
        fi
    else
        echo -e "  ${YELLOW}[SKIP]${NC} codex-delegate MCP server not found"
    fi
fi

if claude mcp remove rosalind-delegate --scope user 2>/dev/null; then
    echo -e "  ${GREEN}[OK]${NC} Removed rosalind-delegate MCP server"
    REMOVED=$((REMOVED + 1))
else
    CLAUDE_JSON="$HOME/.claude.json"
    if [ -f "$CLAUDE_JSON" ] && command -v jq &>/dev/null; then
        if jq -e '.mcpServers["rosalind-delegate"]' "$CLAUDE_JSON" >/dev/null 2>&1; then
            UPDATED=$(jq 'del(.mcpServers["rosalind-delegate"])' "$CLAUDE_JSON")
            echo "$UPDATED" > "$CLAUDE_JSON"
            echo -e "  ${GREEN}[OK]${NC} Removed rosalind-delegate from ~/.claude.json"
            REMOVED=$((REMOVED + 1))
        else
            echo -e "  ${YELLOW}[SKIP]${NC} rosalind-delegate not found in MCP config"
        fi
    else
        echo -e "  ${YELLOW}[SKIP]${NC} rosalind-delegate MCP server not found"
    fi
fi

if codex mcp remove claude-delegate 2>/dev/null; then
    echo -e "  ${GREEN}[OK]${NC} Removed claude-delegate MCP server"
    REMOVED=$((REMOVED + 1))
else
    echo -e "  ${YELLOW}[SKIP]${NC} claude-delegate MCP server not found"
fi

if codex mcp remove rosalind-delegate 2>/dev/null; then
    echo -e "  ${GREEN}[OK]${NC} Removed rosalind-delegate MCP server"
    REMOVED=$((REMOVED + 1))
else
    echo -e "  ${YELLOW}[SKIP]${NC} rosalind-delegate MCP server not found"
fi

if codex mcp remove codex-delegate 2>/dev/null; then
    echo -e "  ${GREEN}[OK]${NC} Removed codex-delegate MCP server from Codex"
    REMOVED=$((REMOVED + 1))
else
    echo -e "  ${YELLOW}[SKIP]${NC} codex-delegate MCP server not found in Codex"
fi

# 2. Remove current and legacy Claude skills
echo -e "${YELLOW}Removing Claude Code skills...${NC}"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CLAUDE_SKILLS=(codex-delegate rosalind-delegate codex-read codex-status codex-implement codex-plan-review codex-review)

for skill in "${CLAUDE_SKILLS[@]}"; do
    if [ -d "$CLAUDE_SKILLS_DIR/$skill" ]; then
        rm -rf "$CLAUDE_SKILLS_DIR/$skill"
        echo -e "  ${GREEN}[OK]${NC} Removed Claude skill: $skill"
        REMOVED=$((REMOVED + 1))
    else
        echo -e "  ${YELLOW}[SKIP]${NC} Claude skill not found: $skill"
    fi
done

# 3. Remove current and legacy Codex skills
echo -e "${YELLOW}Removing Codex CLI skills...${NC}"
CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
CODEX_SKILLS=(claude-delegate codex-delegate rosalind-delegate claude-status read-task respond)

for skill in "${CODEX_SKILLS[@]}"; do
    if [ -d "$CODEX_SKILLS_DIR/$skill" ]; then
        rm -rf "$CODEX_SKILLS_DIR/$skill"
        echo -e "  ${GREEN}[OK]${NC} Removed Codex skill: $skill"
        REMOVED=$((REMOVED + 1))
    else
        echo -e "  ${YELLOW}[SKIP]${NC} Codex skill not found: $skill"
    fi
done

# Also check additional Codex config directories
for codex_dir in "$HOME"/.codex*/; do
    skills_dir="${codex_dir}skills"
    if [ -d "$skills_dir" ]; then
        for skill in "${CODEX_SKILLS[@]}"; do
            if [ -d "$skills_dir/$skill" ]; then
                rm -rf "$skills_dir/$skill"
                echo -e "  ${GREEN}[OK]${NC} Removed skill '$skill' from ${codex_dir}"
                REMOVED=$((REMOVED + 1))
            fi
        done
    fi
done

# 4. Remove legacy permissions and obsolete settings-based MCP registration
echo -e "${YELLOW}Removing dual-agent config from Claude settings...${NC}"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

if [ -f "$CLAUDE_SETTINGS" ] && command -v jq &>/dev/null; then
    # Use a temp file for the jq filter to avoid shell quoting issues
    # with embedded $() and double quotes in permission strings
    TMPJQ=$(mktemp)
    cat > "$TMPJQ" <<'JQEOF'
if .permissions.allow then .permissions.allow -= [
  "Bash(cat .agent-collab:*)",
  "Bash(echo idle > .agent-collab/status)",
  "Bash(echo pending > .agent-collab/status)",
  "Bash(echo working > .agent-collab/status)",
  "Bash(echo done > .agent-collab/status)",
  "Bash(while [ \"$(cat .agent-collab/status)\" != \"done\" ]; do sleep:*)",
  "Bash(tmux send-keys:*)"
] else . end
| del(.mcpServers["codex-delegate"])
| del(.mcpServers["rosalind-delegate"])
JQEOF
    UPDATED=$(jq -f "$TMPJQ" "$CLAUDE_SETTINGS")
    rm -f "$TMPJQ"
    echo "$UPDATED" > "$CLAUDE_SETTINGS"
    echo -e "  ${GREEN}[OK]${NC} Removed dual-agent permissions and MCP server from settings"
    REMOVED=$((REMOVED + 1))
else
    echo -e "  ${YELLOW}[SKIP]${NC} Claude settings file not found or jq not available"
fi

echo ""
echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}  Uninstall Complete!${NC}"
echo -e "${GREEN}=======================================${NC}"
echo ""
if [ $REMOVED -gt 0 ]; then
    echo -e "Removed ${GREEN}${REMOVED}${NC} items."
else
    echo -e "${YELLOW}Nothing to remove — environment was already clean.${NC}"
fi
echo ""
echo -e "${BLUE}Note:${NC} Restart Claude Code and Codex to unload MCP tools."
echo "Saved task results and project files were preserved."
echo ""
