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

MISSING=0
check_install tmux "Install with: brew install tmux" || MISSING=1
check_install claude "Install from: https://github.com/anthropics/claude-code" || MISSING=1
check_install codex "Install from: https://github.com/openai/codex" || MISSING=1
check_install jq "Install with: brew install jq" || MISSING=1

if [ $MISSING -eq 1 ]; then
    echo ""
    echo -e "${RED}Please install missing dependencies and run again.${NC}"
    exit 1
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

# Merge Claude Code permissions for dual-agent commands
echo -e "${YELLOW}Configuring Claude Code permissions...${NC}"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# Permissions needed for dual-agent collaboration
DUAL_AGENT_PERMISSIONS='[
  "cat .agent-collab/*",
  "cat .agent-collab/**",
  "echo * > .agent-collab/status",
  "while *; do sleep *; done; echo *",
  "tmux send-keys *"
]'

if [ -f "$CLAUDE_SETTINGS" ]; then
    # File exists - merge permissions
    EXISTING=$(cat "$CLAUDE_SETTINGS")

    # Check if permissions.allow exists
    if echo "$EXISTING" | jq -e '.permissions.allow' > /dev/null 2>&1; then
        # Merge with existing allow list, avoiding duplicates
        MERGED=$(echo "$EXISTING" | jq --argjson new "$DUAL_AGENT_PERMISSIONS" '
            .permissions.allow = (.permissions.allow + $new | unique)
        ')
    else
        # Add permissions.allow to existing config
        MERGED=$(echo "$EXISTING" | jq --argjson new "$DUAL_AGENT_PERMISSIONS" '
            .permissions.allow = $new
        ')
    fi

    echo "$MERGED" > "$CLAUDE_SETTINGS"
    echo -e "  ${GREEN}[OK]${NC} Merged permissions into existing settings"
else
    # Create new settings file
    mkdir -p "$HOME/.claude"
    cat > "$CLAUDE_SETTINGS" << EOF
{
  "permissions": {
    "allow": $DUAL_AGENT_PERMISSIONS
  }
}
EOF
    echo -e "  ${GREEN}[OK]${NC} Created Claude settings with permissions"
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
echo -e "To start the dual agent environment:"
echo -e "  ${YELLOW}./start-dual-agent.sh${NC}"
echo ""
echo -e "Or with custom session name and directory:"
echo -e "  ${YELLOW}./start-dual-agent.sh my-session /path/to/project${NC}"
echo ""
echo -e "${BLUE}Workflow:${NC}"
echo -e "  1. Work with Claude (left pane) as your primary agent"
echo -e "  2. Delegate to Codex using: ${GREEN}/codex-review${NC}, ${GREEN}/codex-implement${NC}, ${GREEN}/codex-plan-review${NC}"
echo -e "  3. Codex auto-receives tasks via tmux (semi-automated)"
echo -e "  4. Read Codex results with: ${GREEN}/codex-read${NC}"
echo ""
echo -e "${BLUE}Pro Tips:${NC}"
echo -e "  - Edit ${YELLOW}.agent-collab/context/shared.md${NC} to provide project context to both agents"
echo -e "  - Use ${GREEN}/codex-status${NC} to check collaboration status"
echo -e "  - Codex excels at: deep code review, complex implementations, plan validation"
echo -e "  - Claude excels at: rapid iteration, planning, quick tasks, orchestration"
echo ""
