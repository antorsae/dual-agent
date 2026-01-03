#!/bin/bash
#
# Dual Agent Development Environment Launcher
# Starts Claude Code and Codex CLI in a split tmux session
#

set -e

SESSION_NAME="${1:-dual-agent}"
PROJECT_DIR="${2:-$(pwd)}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}Error: project directory not found: $PROJECT_DIR${NC}"
    exit 1
fi

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
AGENT_COLLAB_DIR="$PROJECT_DIR/.agent-collab"
AGENT_COLLAB_DIR_ESCAPED=$(printf %q "$AGENT_COLLAB_DIR")

echo -e "${GREEN}Starting Dual Agent Development Environment${NC}"
echo -e "Session: ${YELLOW}$SESSION_NAME${NC}"
echo -e "Project: ${YELLOW}$PROJECT_DIR${NC}"
echo ""

# Check dependencies
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed${NC}"
        exit 1
    fi
}

check_command tmux
check_command claude
check_command codex

check_tmux_version() {
    local version major minor
    version=$(tmux -V | awk '{print $2}')
    major=$(echo "$version" | awk -F. '{print $1}')
    minor=$(echo "$version" | awk -F. '{print $2}' | sed -E 's/[^0-9].*//')

    if [ -z "$major" ] || [ -z "$minor" ]; then
        echo -e "${RED}Error: Unable to parse tmux version: $version${NC}"
        return 1
    fi

    if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 6 ]; }; then
        echo -e "${RED}Error: tmux 2.6+ required (found $version)${NC}"
        return 1
    fi
}

check_tmux_version

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo -e "${RED}Error: tmux session '$SESSION_NAME' already exists.${NC}"
    echo -e "Use a different name or attach with: tmux attach -t $SESSION_NAME"
    exit 1
fi

session_lock="$PROJECT_DIR/.agent-collab/session"
if [ -f "$session_lock" ]; then
    locked_session=$(cat "$session_lock")
    if [ -n "$locked_session" ] && tmux has-session -t "$locked_session" 2>/dev/null; then
        echo -e "${RED}Error: project already has an active session: $locked_session${NC}"
        echo -e "Detach or stop that session before starting another for this project."
        exit 1
    fi
fi

# Initialize .agent-collab if it doesn't exist
if [ ! -d "$PROJECT_DIR/.agent-collab" ]; then
    echo -e "${YELLOW}Initializing .agent-collab directory...${NC}"
    mkdir -p "$PROJECT_DIR/.agent-collab"/{requests,responses,context}
    echo "idle" > "$PROJECT_DIR/.agent-collab/status"
    echo "# Shared Project Context" > "$PROJECT_DIR/.agent-collab/context/shared.md"
    echo "# No pending tasks" > "$PROJECT_DIR/.agent-collab/requests/task.md"
    echo "# No responses yet" > "$PROJECT_DIR/.agent-collab/responses/response.md"
fi

# Create new tmux session
tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR"

echo "$SESSION_NAME" > "$session_lock"

# Rename the first window
tmux rename-window -t "$SESSION_NAME:0" "agents"

# Split vertically (left/right)
tmux split-window -h -t "$SESSION_NAME:0" -c "$PROJECT_DIR"

# Configure panes
# Pane 0 (left): Claude Code - primary agent
# Pane 1 (right): Codex - secondary agent

# Set pane titles (requires tmux 2.6+)
tmux select-pane -t "$SESSION_NAME:0.0" -T "Claude (Primary)"
tmux select-pane -t "$SESSION_NAME:0.1" -T "Codex (Secondary)"

# Start Claude in left pane
tmux send-keys -t "$SESSION_NAME:0.0" "export AGENT_COLLAB_DIR=$AGENT_COLLAB_DIR_ESCAPED" Enter
tmux send-keys -t "$SESSION_NAME:0.0" "echo -e '${GREEN}=== CLAUDE CODE (Primary Agent) ===${NC}'" Enter
tmux send-keys -t "$SESSION_NAME:0.0" "echo 'Skills: /codex-review, /codex-implement, /codex-plan-review, /codex-read, /codex-status'" Enter
tmux send-keys -t "$SESSION_NAME:0.0" "echo ''" Enter
tmux send-keys -t "$SESSION_NAME:0.0" "claude" Enter

# Start Codex in right pane with max settings
tmux send-keys -t "$SESSION_NAME:0.1" "export AGENT_COLLAB_DIR=$AGENT_COLLAB_DIR_ESCAPED" Enter
tmux send-keys -t "$SESSION_NAME:0.1" "echo -e '${YELLOW}=== CODEX (Secondary Agent) ===${NC}'" Enter
tmux send-keys -t "$SESSION_NAME:0.1" "echo 'Skills: /read-task, /respond, /claude-status'" Enter
tmux send-keys -t "$SESSION_NAME:0.1" "echo ''" Enter
# Codex with full-auto mode for maximum capability
tmux send-keys -t "$SESSION_NAME:0.1" "codex --full-auto" Enter

# Focus on Claude pane (left)
tmux select-pane -t "$SESSION_NAME:0.0"

# Enable pane border status to show titles
tmux set-option -t "$SESSION_NAME" pane-border-status top
tmux set-option -t "$SESSION_NAME" pane-border-format " #{pane_title} "

echo -e "${GREEN}Environment ready!${NC}"
echo ""
echo -e "Attaching to session. Key bindings:"
echo -e "  ${YELLOW}Ctrl-b + Left/Right${NC}  - Switch between panes"
echo -e "  ${YELLOW}Ctrl-b + d${NC}           - Detach from session"
echo -e "  ${YELLOW}Ctrl-b + z${NC}           - Zoom current pane"
echo ""
echo -e "Claude Skills: ${GREEN}/codex-review${NC}, ${GREEN}/codex-implement${NC}, ${GREEN}/codex-plan-review${NC}, ${GREEN}/codex-read${NC}"
echo -e "Codex Skills:  ${GREEN}/read-task${NC}, ${GREEN}/respond${NC}, ${GREEN}/claude-status${NC}"
echo ""

# Attach to the session
tmux attach-session -t "$SESSION_NAME"
