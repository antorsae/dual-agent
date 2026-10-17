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
#   ./setup-dual-agent.sh --both    # Install both delegation directions
#   ./setup-dual-agent.sh --all    # Install all components (non-interactive)
#   ./setup-dual-agent.sh --pro-worker  # Install only ChatGPT Pro worker for Codex
#

set -euo pipefail

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
    echo -e "${RED}Error: $*${NC}" >&2
    exit 1
}

INSTALL_NOTIFICATIONS=0
INSTALL_MCP=0
INSTALL_CHATGPT=0
INSTALL_PRO_WORKER=0
INSTALL_CLAUDE_MCP=0

case "${1:-}" in
    --all)
        INSTALL_NOTIFICATIONS=1
        INSTALL_MCP=1
        INSTALL_CHATGPT=1
        INSTALL_PRO_WORKER=1
        INSTALL_CLAUDE_MCP=1
        ;;
    --codex-mcp|--mcp) INSTALL_MCP=1 ;;
    --claude-mcp) INSTALL_CLAUDE_MCP=1 ;;
    --both) INSTALL_MCP=1; INSTALL_CLAUDE_MCP=1 ;;
    --pro-worker|--chatgpt-pro-worker) INSTALL_PRO_WORKER=1 ;;
    --help|-h)
        echo "Usage: $0 [option]"
        echo "Without arguments, choose integrations from the installation menu."
        echo "  --codex-mcp  Use Codex from Claude Code (MCP tools and skill)"
        echo "  --claude-mcp Use Claude from Codex (MCP tools and skill)"
        echo "  --both       Install both delegation integrations"
        echo "  --pro-worker Install the ChatGPT Pro worker for Codex"
        echo "  --all        Install every integration and notification support"
        echo "  --mcp        Alias for --codex-mcp"
        exit 0
        ;;
    "")
        while true; do
            echo "Choose integrations to install (1 = selected, 0 = unselected):"
            echo "  1) [$INSTALL_MCP] Use Codex from Claude Code (MCP tools and skill)"
            echo "  2) [$INSTALL_CLAUDE_MCP] Use Claude from Codex (MCP tools and skill)"
            echo "  3) [$INSTALL_CHATGPT] Review with ChatGPT from Claude Code (Chrome)"
            echo "  4) [$INSTALL_PRO_WORKER] Use the ChatGPT Pro worker from Codex"
            echo "  5) [$INSTALL_NOTIFICATIONS] Desktop notification support"
            echo "  a) Select all    n) Select none    c) Confirm"
            if ! read -r -n 1 -p "Toggle [1-5] or confirm [c]: " choice; then
                fail "No selection received. Use --codex-mcp, --claude-mcp, --both, --pro-worker, or --all for unattended setup."
            fi
            echo ""
            case "$choice" in
                1) INSTALL_MCP=$((1 - INSTALL_MCP)) ;;
                2) INSTALL_CLAUDE_MCP=$((1 - INSTALL_CLAUDE_MCP)) ;;
                3) INSTALL_CHATGPT=$((1 - INSTALL_CHATGPT)) ;;
                4) INSTALL_PRO_WORKER=$((1 - INSTALL_PRO_WORKER)) ;;
                5) INSTALL_NOTIFICATIONS=$((1 - INSTALL_NOTIFICATIONS)) ;;
                a|A) INSTALL_NOTIFICATIONS=1; INSTALL_MCP=1; INSTALL_CHATGPT=1; INSTALL_PRO_WORKER=1; INSTALL_CLAUDE_MCP=1 ;;
                n|N) INSTALL_NOTIFICATIONS=0; INSTALL_MCP=0; INSTALL_CHATGPT=0; INSTALL_PRO_WORKER=0; INSTALL_CLAUDE_MCP=0 ;;
                c|C) break ;;
                *) echo "Invalid choice" ;;
            esac
        done
        ;;
    *) fail "Unknown option: $1. Use --help for usage." ;;
esac

if [ "$INSTALL_NOTIFICATIONS$INSTALL_MCP$INSTALL_CHATGPT$INSTALL_PRO_WORKER$INSTALL_CLAUDE_MCP" = "00000" ]; then
    echo "Nothing selected. Exiting."
    exit 0
fi

detect_os
MISSING=0
if [ "$INSTALL_MCP" -eq 1 ] || [ "$INSTALL_CHATGPT" -eq 1 ]; then
    check_install claude "Install from: https://code.claude.com/docs/en/setup" || MISSING=1
fi
if [ "$INSTALL_MCP" -eq 1 ] || [ "$INSTALL_PRO_WORKER" -eq 1 ] || [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    check_install node "Install from: https://nodejs.org" || MISSING=1
    check_install npm "Install Node.js with npm" || MISSING=1
fi
if [ "$INSTALL_PRO_WORKER" -eq 1 ] || [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    check_install codex "Install from: https://github.com/openai/codex" || MISSING=1
fi
if [ "$INSTALL_MCP" -eq 1 ]; then
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

# Install notification dependencies based on OS
if [ "$INSTALL_NOTIFICATIONS" -eq 1 ]; then
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
fi

AGENT_DIR="$SCRIPT_DIR/agent"
DELEGATE_STATE_DIR="${DUAL_AGENT_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/dual-agent}"
case "$DELEGATE_STATE_DIR" in /*) ;; *) fail "DUAL_AGENT_STATE_DIR must be an absolute path." ;; esac
DELEGATE_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

install_skill() {
    local source="$1" destination="$2"
    [ -f "$source/SKILL.md" ] || fail "Skill not found: $source/SKILL.md"
    mkdir -p "$destination"
    cp -R "$source/." "$destination/"
    echo -e "  ${GREEN}[OK]${NC} Installed skill: $destination"
}

if [ "$INSTALL_MCP" -eq 1 ] || [ "$INSTALL_PRO_WORKER" -eq 1 ] || [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    [ -d "$AGENT_DIR" ] || fail "Agent package not found: $AGENT_DIR"
    echo -e "${YELLOW}Building agent MCP servers...${NC}"
    if ! (cd "$AGENT_DIR" && npm ci && npm run build); then
        fail "Agent install/build failed. Fix the error above and rerun setup."
    fi
fi

if [ "$INSTALL_MCP" -eq 1 ]; then
    MCP_SERVER_PATH="$AGENT_DIR/dist/mcp.js"
    [ -f "$MCP_SERVER_PATH" ] || fail "MCP build output not found: $MCP_SERVER_PATH"
    claude mcp remove codex-delegate --scope user 2>/dev/null || true
    if ! claude mcp add --scope user codex-delegate --env "CODEX_BIN=$DELEGATE_CODEX_BIN" --env "DUAL_AGENT_STATE_DIR=$DELEGATE_STATE_DIR" --env "CODEX_HOME=$DELEGATE_CODEX_HOME" -- node "$MCP_SERVER_PATH"; then
        fail "Could not register codex-delegate. Fix the Claude CLI error above and rerun setup."
    fi
    install_skill "$SCRIPT_DIR/.claude/skills/codex-delegate" "$HOME/.claude/skills/codex-delegate"
    echo -e "  ${GREEN}[OK]${NC} Registered codex-delegate for Claude (user scope)"
fi

if [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    CLAUDE_MCP_SERVER_PATH="$AGENT_DIR/dist/claudeMcp.js"
    [ -f "$CLAUDE_MCP_SERVER_PATH" ] || fail "MCP build output not found: $CLAUDE_MCP_SERVER_PATH"
    CLAUDE_SERVER_ENV=(--env "CLAUDE_BIN=$DELEGATE_CLAUDE_BIN" --env "DUAL_AGENT_STATE_DIR=$DELEGATE_STATE_DIR")
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
        CLAUDE_SERVER_ENV+=(--env "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR")
    fi
    codex mcp remove claude-delegate 2>/dev/null || true
    if ! codex mcp add claude-delegate "${CLAUDE_SERVER_ENV[@]}" -- node "$CLAUDE_MCP_SERVER_PATH"; then
        fail "Could not register claude-delegate. Fix the Codex CLI error above and rerun setup."
    fi
    install_skill "$SCRIPT_DIR/.codex/skills/claude-delegate" "$DELEGATE_CODEX_HOME/skills/claude-delegate"
fi

if [ "$INSTALL_PRO_WORKER" -eq 1 ]; then
    PRO_MCP_SERVER_PATH="$AGENT_DIR/dist/chatgptProMcp.js"
    [ -f "$PRO_MCP_SERVER_PATH" ] || fail "MCP build output not found: $PRO_MCP_SERVER_PATH"
    echo -e "${YELLOW}Installing Playwright Chromium...${NC}"
    if ! (cd "$AGENT_DIR" && npx playwright install chromium); then
        fail "Chromium installation failed. Fix the error above and rerun setup."
    fi
    # Codex filters inherited environment variables, so persist this explicitly.
    PRO_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
    codex mcp remove chatgpt-pro-worker 2>/dev/null || true
    if ! codex mcp add chatgpt-pro-worker --env "CODEX_HOME=$PRO_CODEX_HOME" -- node "$PRO_MCP_SERVER_PATH"; then
        fail "Could not register chatgpt-pro-worker. Fix the Codex CLI error above and rerun setup."
    fi
    install_skill "$SCRIPT_DIR/.codex/skills/chatgpt-pro-worker" "$PRO_CODEX_HOME/skills/chatgpt-pro-worker"
fi

if [ "$INSTALL_CHATGPT" -eq 1 ]; then
    install_skill "$SCRIPT_DIR/.claude/skills/chatgpt-code-review" "$HOME/.claude/skills/chatgpt-code-review"
fi

echo ""
echo -e "${GREEN}Setup Complete!${NC}"
if [ "$INSTALL_MCP" -eq 1 ]; then
    echo "Restart Claude Code, then ask it to review or implement something using Codex."
    echo "Tools: delegate_codex_review, delegate_codex_implement, delegate_codex_plan_review, delegate_codex"
    echo "Jobs: delegate_codex_status, delegate_codex_list, delegate_codex_cancel"
    echo "Check registration: claude mcp get codex-delegate"
fi
if [ "$INSTALL_CHATGPT" -eq 1 ]; then
    echo "Start claude --chrome, then use /chatgpt-code-review."
    echo "Requires the Claude in Chrome extension and a signed-in ChatGPT browser session."
fi
if [ "$INSTALL_PRO_WORKER" -eq 1 ]; then
    echo 'Restart Codex, then use $chatgpt-pro-worker.'
    echo "Run open_pro_login for the one-time ChatGPT login, then login_status to verify."
fi
if [ "$INSTALL_CLAUDE_MCP" -eq 1 ]; then
    echo "Restart Codex to load Claude's review, implementation, plan-review, and custom task tools."
    echo "Jobs: delegate_claude_status, delegate_claude_list, delegate_claude_cancel"
    echo "Check registration: codex mcp get claude-delegate"
fi
