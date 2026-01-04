#!/bin/bash
#
# Setup script for Dual Agent Development Environment
# Run this once to install skills and configure the environment
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
echo -e "${BLUE}  Dual Agent Environment Setup${NC}"
echo -e "${BLUE}=======================================${NC}"
echo ""

# Check for required tools
echo -e "${YELLOW}Checking dependencies...${NC}"

check_install() {
    if command -v "$1" &> /dev/null; then
        echo -e "  ${GREEN}[OK]${NC} $1"
        return 0
    else
        echo -e "  ${RED}[MISSING]${NC} $1 - $2"
        return 1
    fi
}

check_tmux_version() {
    local version major minor
    version=$(tmux -V | awk '{print $2}')
    major=$(echo "$version" | awk -F. '{print $1}')
    minor=$(echo "$version" | awk -F. '{print $2}' | sed -E 's/[^0-9].*//')

    if [ -z "$major" ] || [ -z "$minor" ]; then
        echo -e "  ${RED}[MISSING]${NC} tmux 2.6+ required (unable to parse version: $version)"
        return 1
    fi

    if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 6 ]; }; then
        echo -e "  ${RED}[MISSING]${NC} tmux 2.6+ required (found $version)"
        return 1
    fi

    echo -e "  ${GREEN}[OK]${NC} tmux version $version"
}

MISSING=0
check_install tmux "Install with: brew install tmux" || MISSING=1
check_install claude "Install from: https://github.com/anthropics/claude-code" || MISSING=1
check_install codex "Install from: https://github.com/openai/codex" || MISSING=1
check_install jq "Install with: brew install jq" || MISSING=1
check_install node "Install from: https://nodejs.org" || MISSING=1

if command -v tmux &> /dev/null; then
    check_tmux_version || MISSING=1
fi

if [ $MISSING -eq 1 ]; then
    echo ""
    echo -e "${RED}Please install missing dependencies and run again.${NC}"
    exit 1
fi

echo ""

# Build the codex-delegate agent
echo -e "${YELLOW}Building codex-delegate agent...${NC}"
AGENT_DIR="$SCRIPT_DIR/agent"

if [ -d "$AGENT_DIR" ]; then
    cd "$AGENT_DIR"
    if [ ! -d "node_modules" ]; then
        npm install --silent 2>/dev/null
    fi
    npm run build --silent 2>/dev/null
    echo -e "  ${GREEN}[OK]${NC} Built codex-delegate MCP server"
    cd "$SCRIPT_DIR"
else
    echo -e "  ${YELLOW}[SKIP]${NC} agent/ directory not found"
fi

echo ""

# Create global Claude skills directory
echo -e "${YELLOW}Setting up Claude Code skills...${NC}"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
mkdir -p "$CLAUDE_SKILLS_DIR"

# Copy Claude skills (each skill is a directory with SKILL.md)
if [ -d "$SCRIPT_DIR/.claude/skills" ]; then
    for skill_dir in "$SCRIPT_DIR/.claude/skills"/*/; do
        if [ -f "${skill_dir}SKILL.md" ]; then
            skill_name=$(basename "$skill_dir")
            mkdir -p "$CLAUDE_SKILLS_DIR/$skill_name"
            cp -r "$skill_dir"* "$CLAUDE_SKILLS_DIR/$skill_name/"
            echo -e "  ${GREEN}[OK]${NC} Installed Claude skill: $skill_name"
        fi
    done
else
    echo -e "  ${YELLOW}[SKIP]${NC} No local Claude skills found, using project-local skills"
fi

# Create global Codex skills directory
echo -e "${YELLOW}Setting up Codex CLI skills...${NC}"
CODEX_SKILLS_DIR="$HOME/.codex/skills"
mkdir -p "$CODEX_SKILLS_DIR"

# Copy Codex skills (each skill is a directory with SKILL.md)
if [ -d "$SCRIPT_DIR/.codex/skills" ]; then
    for skill_dir in "$SCRIPT_DIR/.codex/skills"/*/; do
        if [ -f "${skill_dir}SKILL.md" ]; then
            skill_name=$(basename "$skill_dir")
            mkdir -p "$CODEX_SKILLS_DIR/$skill_name"
            cp -r "$skill_dir"* "$CODEX_SKILLS_DIR/$skill_name/"
            echo -e "  ${GREEN}[OK]${NC} Installed Codex skill: $skill_name"
        fi
    done
else
    echo -e "  ${YELLOW}[SKIP]${NC} No local Codex skills found, using project-local skills"
fi

echo ""

# Configure Claude Code settings
echo -e "${YELLOW}Configuring Claude Code settings...${NC}"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# Permissions needed for dual-agent collaboration
DUAL_AGENT_PERMISSIONS='[
  "Bash(cat .agent-collab:*)",
  "Bash(echo idle > .agent-collab/status)",
  "Bash(echo pending > .agent-collab/status)",
  "Bash(echo working > .agent-collab/status)",
  "Bash(echo done > .agent-collab/status)",
  "Bash(while [ \"$(cat .agent-collab/status)\" != \"done\" ]; do sleep:*)",
  "Bash(tmux send-keys:*)"
]'

# MCP server configuration for codex-delegate
MCP_SERVER_PATH="$AGENT_DIR/dist/mcp.js"
MCP_CONFIG="{\"command\": \"node\", \"args\": [\"$MCP_SERVER_PATH\"]}"

if [ -f "$CLAUDE_SETTINGS" ]; then
    # File exists - merge settings
    EXISTING=$(cat "$CLAUDE_SETTINGS")

    # Merge permissions
    if echo "$EXISTING" | jq -e '.permissions.allow' > /dev/null 2>&1; then
        MERGED=$(echo "$EXISTING" | jq --argjson new "$DUAL_AGENT_PERMISSIONS" '
            .permissions.allow = (.permissions.allow + $new | unique)
        ')
    else
        MERGED=$(echo "$EXISTING" | jq --argjson new "$DUAL_AGENT_PERMISSIONS" '
            .permissions.allow = $new
        ')
    fi

    # Add MCP server if agent was built
    if [ -f "$MCP_SERVER_PATH" ]; then
        MERGED=$(echo "$MERGED" | jq --argjson mcp "$MCP_CONFIG" '
            .mcpServers["codex-delegate"] = $mcp
        ')
        echo -e "  ${GREEN}[OK]${NC} Added codex-delegate MCP server"
    fi

    echo "$MERGED" > "$CLAUDE_SETTINGS"
    echo -e "  ${GREEN}[OK]${NC} Merged settings into existing config"
else
    # Create new settings file
    mkdir -p "$HOME/.claude"
    if [ -f "$MCP_SERVER_PATH" ]; then
        cat > "$CLAUDE_SETTINGS" << EOF
{
  "permissions": {
    "allow": $DUAL_AGENT_PERMISSIONS
  },
  "mcpServers": {
    "codex-delegate": $MCP_CONFIG
  }
}
EOF
        echo -e "  ${GREEN}[OK]${NC} Created Claude settings with permissions and MCP server"
    else
        cat > "$CLAUDE_SETTINGS" << EOF
{
  "permissions": {
    "allow": $DUAL_AGENT_PERMISSIONS
  }
}
EOF
        echo -e "  ${GREEN}[OK]${NC} Created Claude settings with permissions"
    fi
fi

echo ""

# Create .agent-collab in current directory
echo -e "${YELLOW}Initializing .agent-collab directory...${NC}"
mkdir -p .agent-collab/{requests,responses,context}
echo "idle" > .agent-collab/status
cat > .agent-collab/context/shared.md << 'EOF'
# Shared Project Context

This file contains context shared between Claude Code and Codex agents.
Both agents should read this file to understand the project state.

## Project Overview
<!-- Add project description here -->

## Architecture Decisions
<!-- Document key architectural decisions -->

## Conventions
<!-- Coding conventions, patterns to follow -->

## Current Focus
<!-- What the team is currently working on -->
EOF

cat > .agent-collab/requests/task.md << 'EOF'
# Agent Task Request

No pending tasks.
EOF

cat > .agent-collab/responses/response.md << 'EOF'
# Agent Response

No responses yet.
EOF

echo -e "  ${GREEN}[OK]${NC} .agent-collab directory initialized"

echo ""

# Add to .gitignore if git repo
if [ -d ".git" ]; then
    echo -e "${YELLOW}Updating .gitignore...${NC}"
    if ! grep -q ".agent-collab" .gitignore 2>/dev/null; then
        echo "" >> .gitignore
        echo "# Dual agent collaboration files" >> .gitignore
        echo ".agent-collab/" >> .gitignore
        echo -e "  ${GREEN}[OK]${NC} Added .agent-collab to .gitignore"
    else
        echo -e "  ${YELLOW}[SKIP]${NC} .agent-collab already in .gitignore"
    fi
fi

echo ""

# Make start script executable
chmod +x "$SCRIPT_DIR/start-dual-agent.sh" 2>/dev/null || true

echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}=======================================${NC}"
echo ""
echo -e "${BLUE}Three ways to use external models with Claude:${NC}"
echo ""
echo -e "${YELLOW}Option 1: MCP Tools (Recommended)${NC}"
echo -e "  Claude now has codex tools available directly."
echo -e "  Just ask: ${GREEN}\"review src/auth.ts using codex\"${NC}"
echo -e "  Or: ${GREEN}\"have codex implement a rate limiter\"${NC}"
echo ""
echo -e "${YELLOW}Option 2: Tmux Dual-Pane${NC}"
echo -e "  Run: ${GREEN}./start-dual-agent.sh${NC}"
echo -e "  Use skills: ${GREEN}/codex-review${NC}, ${GREEN}/codex-implement${NC}, ${GREEN}/codex-plan-review${NC}"
echo ""
echo -e "${YELLOW}Option 3: ChatGPT Code Review (Chrome)${NC}"
echo -e "  Run: ${GREEN}claude --chrome${NC}"
echo -e "  Use skill: ${GREEN}/chatgpt-code-review${NC}"
echo -e "  Requires: ChatGPT Pro subscription, Claude in Chrome extension"
echo ""
echo -e "${BLUE}Available Codex MCP Tools:${NC}"
echo -e "  ${GREEN}delegate_codex_review${NC}      - Code review (security, bugs, quality)"
echo -e "  ${GREEN}delegate_codex_implement${NC}   - Implement features"
echo -e "  ${GREEN}delegate_codex_plan_review${NC} - Review implementation plans"
echo -e "  ${GREEN}delegate_codex${NC}             - Custom prompts"
echo ""
echo -e "${BLUE}Note:${NC} Restart Claude Code to load the new MCP tools."
echo ""
