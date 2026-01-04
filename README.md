# Dual Agent Development Environment

A collaborative development environment that pairs **Claude Code** (Anthropic) with **Codex CLI** (OpenAI) and **ChatGPT Pro** (GPT-5.2 Pro), enabling you to leverage the strengths of multiple AI models.

## Why Multiple Agents?

| Claude Code (Primary) | Codex CLI | ChatGPT Pro (GPT-5.2) |
|-----------------------|-----------|----------------------|
| Fast iteration & prototyping | Deep, thorough code review | Extended thinking for complex analysis |
| Planning & orchestration | Complex algorithm implementation | 200k context for large codebases |
| Quick fixes & refactoring | Security vulnerability analysis | Second opinion on architecture |
| Context switching & multitasking | Meticulous edge case handling | Long-running deep reviews (5-30 min) |

By combining multiple models, you get rapid development velocity with rigorous quality checks and diverse perspectives.

## Prerequisites

- [tmux](https://github.com/tmux/tmux) - Terminal multiplexer
- [Claude Code](https://github.com/anthropics/claude-code) - Anthropic's CLI
- [Codex CLI](https://github.com/openai/codex) - OpenAI's CLI
- [jq](https://stedolan.github.io/jq/) - JSON processor
- [Node.js](https://nodejs.org) - For the MCP server

```bash
# macOS
brew install tmux jq node

# Claude Code & Codex CLI - follow their respective installation guides
```

## Installation

```bash
git clone https://github.com/antorsae/dual-agent.git
cd dual-agent
./setup-dual-agent.sh
```

This will:
- Build the codex-delegate MCP server
- Install Claude skills to `~/.claude/skills/`
- Install Codex skills to `~/.codex/skills/`
- Configure Claude Code with MCP server and permissions
- Initialize the `.agent-collab/` directory

---

## Three Ways to Use

### Option 1: MCP Tools (Recommended)

After running setup, Claude Code has Codex tools available directly. Just ask naturally:

```
You: Review src/auth.ts for security vulnerabilities using codex

You: Have codex implement a rate limiter for the API

You: Ask codex to review my migration plan
```

**Available MCP Tools:**

| Tool | Description |
|------|-------------|
| `delegate_codex_review` | Code review (security, bugs, performance) |
| `delegate_codex_implement` | Implement features with Codex |
| `delegate_codex_plan_review` | Review implementation plans |
| `delegate_codex` | Send any custom prompt to Codex |

### Option 2: Tmux Dual-Pane

For interactive side-by-side work with both agents visible:

```bash
./start-dual-agent.sh
```

This opens a split tmux session with Claude (left) and Codex (right).

**Skills:**

| Claude Skills | Codex Skills |
|---------------|--------------|
| `/codex-review` | `/read-task` |
| `/codex-implement` | `/respond` |
| `/codex-plan-review` | `/claude-status` |
| `/codex-read` | |
| `/codex-status` | |

### Option 3: ChatGPT Code Review (Chrome)

Use GPT-5.2 Pro via Claude Code's Chrome integration for deep, extended-thinking code reviews:

```bash
# Start Claude Code with Chrome integration
claude --chrome
```

Then ask naturally:

```
You: Review src/auth.ts with ChatGPT

You: Get GPT-5.2 Pro to review this migration plan
```

**Prerequisites:**
- Claude Code with `--chrome` flag
- Claude in Chrome extension (v1.0.36+)
- Logged into chat.com with ChatGPT Pro subscription

**Workflow:**
1. Claude submits the code review request to GPT-5.2 Pro
2. Returns immediately (non-blocking) - GPT-5.2 can take 5-30 minutes
3. Ask Claude to "fetch ChatGPT results" when ready

**Skill:** `/chatgpt-code-review`

---

## Quick Start

### MCP Tools (Simplest)

```bash
# 1. Run setup
./setup-dual-agent.sh

# 2. Restart Claude Code to load MCP tools
claude

# 3. Use naturally
> Review src/auth.ts for security issues using codex
```

### Tmux Dual-Pane

```bash
# 1. Run setup
./setup-dual-agent.sh

# 2. Start dual-agent environment
./start-dual-agent.sh

# 3. In Claude pane, use skills
> /codex-review
```

---

## Detailed Example: Security Review

### Using MCP Tools

```
You: I just implemented authentication. Review src/auth.ts using codex
     for security vulnerabilities.

Claude: I'll use the delegate_codex_review tool to have Codex analyze this file...

[Claude calls delegate_codex_review tool]

Claude: Codex found the following issues:

## Critical Issues

1. **SQL Injection (Line 45)**
   The query uses string concatenation instead of parameterized queries.

   Fix:
   ```python
   cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
   ```

2. **Weak Password Hashing (Line 78)**
   Using MD5 instead of bcrypt/argon2.

...
```

### Using Tmux Dual-Pane

```
[Claude Pane]
You: Review src/auth.ts for security issues

Claude: I'll delegate this to Codex for a thorough security review.
        Delegating to Codex...

[Codex Pane - automatically receives task]
Codex: Reading task from Claude...
       Analyzing src/auth.ts for security vulnerabilities...
       [Deep analysis]
       Response ready.

[Claude Pane - automatically reads response]
Claude: Codex completed the review. Here are the findings:
        [Presents Codex's analysis]
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              Claude Code                                    │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐ │
│  │  MCP Tools       │  │  Skills (tmux)   │  │  Skills (Chrome)          │ │
│  │  delegate_codex_*│  │  /codex-review   │  │  /chatgpt-code-review     │ │
│  └────────┬─────────┘  └────────┬─────────┘  └─────────────┬─────────────┘ │
└───────────┼─────────────────────┼──────────────────────────┼───────────────┘
            │                     │                          │
            ▼                     ▼                          ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐
│  codex-delegate   │  │  .agent-collab/   │  │  Chrome + chat.com        │
│  MCP Server       │  │  (file-based IPC) │  │  (browser automation)     │
│                   │  │                   │  │                           │
│  Spawns codex CLI │  │  requests/task.md │  │  JavaScript injection     │
└─────────┬─────────┘  └─────────┬─────────┘  └─────────────┬─────────────┘
          │                      │                          │
          ▼                      ▼                          ▼
┌───────────────────────────────────────┐  ┌────────────────────────────────┐
│             Codex CLI                 │  │        GPT-5.2 Pro             │
│                                       │  │                                │
│  Deep code review • Implementation    │  │  Extended thinking (5-30 min)  │
│  Security analysis • Plan review      │  │  200k context • Deep analysis  │
└───────────────────────────────────────┘  └────────────────────────────────┘
```

---

## Configuration

### Shared Context

Edit `.agent-collab/context/shared.md` to provide both agents with project context:

```markdown
# Shared Project Context

## Project Overview
E-commerce platform using FastAPI + Redis + PostgreSQL

## Architecture Decisions
- All auth uses JWT with refresh rotation
- Redis for rate limiting and session storage

## Conventions
- Type hints required on all functions
- Pydantic models for all API schemas
```

### Claude Settings

The setup script configures `~/.claude/settings.json` with:

```json
{
  "mcpServers": {
    "codex-delegate": {
      "command": "node",
      "args": ["/path/to/dual-agent/agent/dist/mcp.js"]
    }
  },
  "permissions": {
    "allow": [
      "Bash(cat .agent-collab:*)",
      "Bash(tmux send-keys:*)",
      ...
    ]
  }
}
```

---

## Tmux Key Bindings

| Keys | Action |
|------|--------|
| `Ctrl-b ←/→` | Switch between Claude and Codex panes |
| `Ctrl-b d` | Detach from session |
| `Ctrl-b z` | Zoom current pane (fullscreen toggle) |

---

## Troubleshooting

### MCP tools not available

1. Check the setup completed successfully:
   ```bash
   cat ~/.claude/settings.json | jq '.mcpServers'
   ```

2. Restart Claude Code:
   ```bash
   claude
   ```

### Codex not receiving tasks (tmux mode)

1. Check tmux pane numbers: `tmux list-panes`
2. Ensure Codex is running in pane 1
3. Manually trigger: `tmux send-keys -t 1 '/read-task' Enter`

### Status stuck (tmux mode)

```bash
echo "idle" > .agent-collab/status
```

### Codex not working

```bash
# Verify codex is installed and authenticated
codex "hello"
```

---

## Project Structure

```
dual-agent/
├── agent/                    # MCP server & CLI
│   ├── src/
│   │   ├── mcp.ts           # MCP server (delegate_codex_* tools)
│   │   ├── cli.ts           # CLI wrapper
│   │   └── codex.ts         # Codex subprocess spawner
│   └── dist/                # Compiled JS
├── .claude/skills/          # Claude Code skills
│   ├── codex-review/        # /codex-review (tmux mode)
│   ├── codex-implement/     # /codex-implement (tmux mode)
│   ├── codex-plan-review/   # /codex-plan-review (tmux mode)
│   ├── codex-read/          # /codex-read (tmux mode)
│   ├── codex-status/        # /codex-status (tmux mode)
│   └── chatgpt-code-review/ # /chatgpt-code-review (Chrome)
├── .codex/skills/           # Codex CLI skills
├── setup-dual-agent.sh      # Setup script
├── start-dual-agent.sh      # Tmux launcher
└── README.md
```

---

## License

MIT
