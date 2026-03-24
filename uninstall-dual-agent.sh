#!/bin/bash
#
# Uninstall script for Dual Agent Development Environment
# Reverses everything done by setup-dual-agent.sh
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

# 1. Remove MCP server
echo -e "${YELLOW}Removing MCP server...${NC}"
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

# 2. Remove Claude skills
echo -e "${YELLOW}Removing Claude Code skills...${NC}"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CLAUDE_SKILLS=(codex-read codex-status chatgpt-code-review codex-implement codex-plan-review codex-review)

for skill in "${CLAUDE_SKILLS[@]}"; do
    if [ -d "$CLAUDE_SKILLS_DIR/$skill" ]; then
        rm -rf "$CLAUDE_SKILLS_DIR/$skill"
        echo -e "  ${GREEN}[OK]${NC} Removed Claude skill: $skill"
        REMOVED=$((REMOVED + 1))
    else
        echo -e "  ${YELLOW}[SKIP]${NC} Claude skill not found: $skill"
    fi
done

# 3. Remove Codex skills
echo -e "${YELLOW}Removing Codex CLI skills...${NC}"
CODEX_SKILLS_DIR="$HOME/.codex/skills"
CODEX_SKILLS=(claude-status read-task respond)

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
    if [ "$codex_dir" = "$HOME/.codex/" ]; then
        continue
    fi
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

# 4. Remove dual-agent permissions and MCP server from Claude settings
echo -e "${YELLOW}Removing dual-agent config from Claude settings...${NC}"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

if [ -f "$CLAUDE_SETTINGS" ] && command -v jq &>/dev/null; then
    # Use a temp file for the jq filter to avoid shell quoting issues
    # with embedded $() and double quotes in permission strings
    TMPJQ=$(mktemp)
    cat > "$TMPJQ" <<'JQEOF'
.permissions.allow -= [
  "Bash(cat .agent-collab:*)",
  "Bash(echo idle > .agent-collab/status)",
  "Bash(echo pending > .agent-collab/status)",
  "Bash(echo working > .agent-collab/status)",
  "Bash(echo done > .agent-collab/status)",
  "Bash(while [ \"$(cat .agent-collab/status)\" != \"done\" ]; do sleep:*)",
  "Bash(tmux send-keys:*)"
]
| del(.mcpServers["codex-delegate"])
JQEOF
    UPDATED=$(jq -f "$TMPJQ" "$CLAUDE_SETTINGS")
    rm -f "$TMPJQ"
    echo "$UPDATED" > "$CLAUDE_SETTINGS"
    echo -e "  ${GREEN}[OK]${NC} Removed dual-agent permissions and MCP server from settings"
    REMOVED=$((REMOVED + 1))
else
    echo -e "  ${YELLOW}[SKIP]${NC} Claude settings file not found or jq not available"
fi

# 5. Remove .agent-collab directory
echo -e "${YELLOW}Removing .agent-collab directory...${NC}"
if [ -d "$SCRIPT_DIR/.agent-collab" ]; then
    rm -rf "$SCRIPT_DIR/.agent-collab"
    echo -e "  ${GREEN}[OK]${NC} Removed .agent-collab/"
    REMOVED=$((REMOVED + 1))
else
    echo -e "  ${YELLOW}[SKIP]${NC} .agent-collab/ not found"
fi

# 6. Remove .agent-collab from .gitignore
echo -e "${YELLOW}Cleaning .gitignore...${NC}"
GITIGNORE="$SCRIPT_DIR/.gitignore"
if [ -f "$GITIGNORE" ] && grep -q ".agent-collab" "$GITIGNORE"; then
    # Remove the comment line and the .agent-collab/ entry
    sed -i '/^# Dual agent collaboration files$/d' "$GITIGNORE"
    sed -i '/^\.agent-collab\/$/d' "$GITIGNORE"
    # Remove trailing blank lines left behind
    sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$GITIGNORE"
    echo -e "  ${GREEN}[OK]${NC} Removed .agent-collab from .gitignore"
    REMOVED=$((REMOVED + 1))
else
    echo -e "  ${YELLOW}[SKIP]${NC} .agent-collab not in .gitignore"
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
echo -e "${BLUE}Note:${NC} Restart Claude Code to unload MCP tools."
echo ""
