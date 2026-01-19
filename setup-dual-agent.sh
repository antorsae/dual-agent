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

# Check for required tools
echo -e "${YELLOW}Checking system...${NC}"
detect_os
echo ""

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
check_install tmux "$(get_install_hint tmux)" || MISSING=1
check_install claude "Install from: https://github.com/anthropics/claude-code" || MISSING=1
check_install codex "Install from: https://github.com/openai/codex" || MISSING=1
check_install jq "$(get_install_hint jq)" || MISSING=1
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

# Install notification dependencies based on OS
echo -e "${YELLOW}Checking notification support...${NC}"

install_notifications() {
    case "$OS" in
        macos)
            # macOS has osascript built-in
            echo -e "  ${GREEN}[OK]${NC} osascript (built-in)"
            ;;
        linux)
            if command -v notify-send &> /dev/null; then
                echo -e "  ${GREEN}[OK]${NC} notify-send"
            else
                echo -e "  ${YELLOW}[MISSING]${NC} notify-send - needed for desktop notifications"

                # Try to install automatically
                case "$PKG_MANAGER" in
                    apt)
                        echo -e "  ${BLUE}[INFO]${NC} Installing libnotify-bin..."
                        sudo apt-get install -y libnotify-bin && echo -e "  ${GREEN}[OK]${NC} notify-send installed" || echo -e "  ${RED}[WARN]${NC} Failed to install, notifications won't work"
                        ;;
                    dnf|yum)
                        echo -e "  ${BLUE}[INFO]${NC} Installing libnotify..."
                        sudo $PKG_MANAGER install -y libnotify && echo -e "  ${GREEN}[OK]${NC} notify-send installed" || echo -e "  ${RED}[WARN]${NC} Failed to install, notifications won't work"
                        ;;
                    pacman)
                        echo -e "  ${BLUE}[INFO]${NC} Installing libnotify..."
                        sudo pacman -S --noconfirm libnotify && echo -e "  ${GREEN}[OK]${NC} notify-send installed" || echo -e "  ${RED}[WARN]${NC} Failed to install, notifications won't work"
                        ;;
                    zypper)
                        echo -e "  ${BLUE}[INFO]${NC} Installing libnotify-tools..."
                        sudo zypper install -y libnotify-tools && echo -e "  ${GREEN}[OK]${NC} notify-send installed" || echo -e "  ${RED}[WARN]${NC} Failed to install, notifications won't work"
                        ;;
                    apk)
                        echo -e "  ${BLUE}[INFO]${NC} Installing libnotify..."
                        sudo apk add libnotify && echo -e "  ${GREEN}[OK]${NC} notify-send installed" || echo -e "  ${RED}[WARN]${NC} Failed to install, notifications won't work"
                        ;;
                    *)
                        echo -e "  ${YELLOW}[WARN]${NC} Please install libnotify manually for desktop notifications"
                        ;;
                esac
            fi
            ;;
        windows)
            echo -e "  ${YELLOW}[INFO]${NC} Windows detected. For notifications, install BurntToast:"
            echo -e "           ${BLUE}Install-Module -Name BurntToast${NC}"
            ;;
        *)
            echo -e "  ${YELLOW}[WARN]${NC} Unknown OS - notifications may not work"
            ;;
    esac
}

install_notifications
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

# Check for additional Codex configurations (e.g., ~/.codex-api/)
ADDITIONAL_CODEX_DIRS=()
for codex_dir in "$HOME"/.codex*/; do
    # Skip the main ~/.codex/ directory we already handled
    if [ "$codex_dir" = "$HOME/.codex/" ]; then
        continue
    fi
    # Check if this directory has a config.toml
    if [ -f "${codex_dir}config.toml" ]; then
        ADDITIONAL_CODEX_DIRS+=("$codex_dir")
    fi
done

if [ ${#ADDITIONAL_CODEX_DIRS[@]} -gt 0 ] && [ -d "$SCRIPT_DIR/.codex/skills" ]; then
    echo ""
    echo -e "${YELLOW}Found additional Codex configurations:${NC}"
    for codex_dir in "${ADDITIONAL_CODEX_DIRS[@]}"; do
        echo -e "  - ${BLUE}${codex_dir}${NC}"
    done
    echo ""
    read -p "Install Codex skills to these directories as well? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for codex_dir in "${ADDITIONAL_CODEX_DIRS[@]}"; do
            skills_dir="${codex_dir}skills"
            mkdir -p "$skills_dir"
            for skill_dir in "$SCRIPT_DIR/.codex/skills"/*/; do
                if [ -f "${skill_dir}SKILL.md" ]; then
                    skill_name=$(basename "$skill_dir")
                    mkdir -p "$skills_dir/$skill_name"
                    cp -r "$skill_dir"* "$skills_dir/$skill_name/"
                    echo -e "  ${GREEN}[OK]${NC} Installed skill '$skill_name' to ${codex_dir}"
                fi
            done
        done
    else
        echo -e "  ${YELLOW}[SKIP]${NC} Skipping additional Codex directories"
    fi
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

# Configure permissions in settings.json
if [ -f "$CLAUDE_SETTINGS" ]; then
    # File exists - merge permissions
    EXISTING=$(cat "$CLAUDE_SETTINGS")

    if echo "$EXISTING" | jq -e '.permissions.allow' > /dev/null 2>&1; then
        MERGED=$(echo "$EXISTING" | jq --argjson new "$DUAL_AGENT_PERMISSIONS" '
            .permissions.allow = (.permissions.allow + $new | unique)
        ')
    else
        MERGED=$(echo "$EXISTING" | jq --argjson new "$DUAL_AGENT_PERMISSIONS" '
            .permissions.allow = $new
        ')
    fi

    echo "$MERGED" > "$CLAUDE_SETTINGS"
    echo -e "  ${GREEN}[OK]${NC} Merged permissions into existing config"
else
    # Create new settings file with permissions only
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

# Add MCP server using claude mcp add (Claude Code v2.1+)
MCP_SERVER_PATH="$AGENT_DIR/dist/mcp.js"
if [ -f "$MCP_SERVER_PATH" ]; then
    echo -e "${YELLOW}Configuring MCP server...${NC}"
    # Remove existing server first (ignore errors if it doesn't exist)
    claude mcp remove codex-delegate --scope user 2>/dev/null || true
    # Add the MCP server globally
    if claude mcp add --scope user codex-delegate -- node "$MCP_SERVER_PATH" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Added codex-delegate MCP server (global)"
    else
        echo -e "  ${YELLOW}[WARN]${NC} Failed to add MCP server via CLI, trying manual config..."
        # Fallback: add to ~/.claude.json manually
        CLAUDE_JSON="$HOME/.claude.json"
        if [ -f "$CLAUDE_JSON" ]; then
            EXISTING=$(cat "$CLAUDE_JSON")
            UPDATED=$(echo "$EXISTING" | jq --arg path "$MCP_SERVER_PATH" '
                .mcpServers["codex-delegate"] = {
                    "type": "stdio",
                    "command": "node",
                    "args": [$path],
                    "env": {}
                }
            ')
            echo "$UPDATED" > "$CLAUDE_JSON"
            echo -e "  ${GREEN}[OK]${NC} Added MCP server to ~/.claude.json"
        fi
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
