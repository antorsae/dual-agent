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

# Initialize .agent-collab if it doesn't exist
if [ ! -d "$PROJECT_DIR/.agent-collab" ]; then
    echo -e "${YELLOW}Initializing .agent-collab directory...${NC}"
    mkdir -p "$PROJECT_DIR/.agent-collab"/{requests,responses,context}
    echo "idle" > "$PROJECT_DIR/.agent-collab/status"
    echo "# Shared Project Context" > "$PROJECT_DIR/.agent-collab/context/shared.md"
    echo "# No pending tasks" > "$PROJECT_DIR/.agent-collab/requests/task.md"
    echo "# No responses yet" > "$PROJECT_DIR/.agent-collab/responses/response.md"
fi

# Kill existing session if it exists
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Create new tmux session
tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR"

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
tmux send-keys -t "$SESSION_NAME:0.0" "echo -e '${GREEN}=== CLAUDE CODE (Primary Agent) ===${NC}'" Enter
tmux send-keys -t "$SESSION_NAME:0.0" "echo 'Skills: /codex-review, /codex-implement, /codex-plan-review, /codex-read, /codex-status'" Enter
tmux send-keys -t "$SESSION_NAME:0.0" "echo ''" Enter
tmux send-keys -t "$SESSION_NAME:0.0" "claude" Enter

# Start Codex in right pane with max settings
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
