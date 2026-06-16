# agent MCP servers

This package contains MCP servers and CLI helpers for the dual-agent environment.

## codex-delegate

MCP server that gives Claude Code direct access to Codex CLI.

**No API keys needed here. No tmux. No file-based communication. Just spawns `codex` directly.**

## How It Works

```
Claude Code
    │
    │  "review auth.ts using codex"
    ▼
codex-delegate MCP Server
    │
    │  spawn("codex", ["exec", "--full-auto", prompt])
    ▼
Codex CLI (fresh process, uses its own auth)
    │
    │  analysis/implementation
    ▼
Results returned to Claude
```

Each tool call spawns a fresh Codex process. Context is passed in the prompt.

## Setup

### Prerequisites

Codex CLI installed and working:

```bash
# Verify codex is installed and authenticated
codex "hello"
```

### Install

```bash
cd agent
npm install
npm run build
```

### Configure Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "codex-delegate": {
      "command": "node",
      "args": ["/FULL/PATH/TO/agent/dist/mcp.js"]
    }
  }
}
```

Then restart Claude Code.

## Usage

Just ask Claude naturally:

```
Review src/auth.ts for security vulnerabilities using codex

Have codex implement a rate limiter

Ask codex to review my migration plan
```

## Available Tools

| Tool | Description |
|------|-------------|
| `delegate_codex_review` | Code review (security, bugs, performance) |
| `delegate_codex_implement` | Implement features |
| `delegate_codex_plan_review` | Review implementation plans |
| `delegate_codex` | Any custom prompt |

Tool names are prefixed with `delegate_` to avoid collision with `/codex-*` skills.

## chatgpt-pro-worker

MCP server that prepares and runs arbitrary coding tasks in ChatGPT GPT-5.5 Pro through Playwright Chromium.

It uses a persistent Chromium profile at `~/.codex/chatgpt-pro-worker/browser-profile`.

1. Codex gathers context and calls `submit_pro_task`.
2. The MCP server writes a durable job under `~/.codex/chatgpt-pro-worker/`.
3. It opens ChatGPT in Playwright Chromium and submits the prompt.
4. It waits for the response and saves the result.
5. Codex applies, tests, or summarizes the Pro result.

### One-Time Login

ChatGPT login still requires an interactive browser session. On a desktop machine, install the worker, run `open_pro_login`, and log in once.

On a headless machine, use SSH X forwarding, VNC/noVNC, or copy a compatible authenticated Chromium profile into:

```text
~/.codex/chatgpt-pro-worker/browser-profile
```

After login, headless automation can use the saved profile.

### Configure Codex MCP

```bash
codex mcp add chatgpt-pro-worker -- node /FULL/PATH/TO/agent/dist/chatgptProMcp.js
```

### Available Tools

| Tool | Description |
|------|-------------|
| `login_status` | Check whether the persistent ChatGPT profile is logged in |
| `open_pro_login` | Open ChatGPT for one-time login in the persistent profile |
| `submit_pro_task` | Submit a Pro task through Playwright Chromium |
| `await_pro_task` | Wait for an automated task result |
| `save_pro_result` | Save a completed ChatGPT Pro response |
| `get_pro_task` | Read job status and saved result |
| `show_pro_prompt` | Show the prepared Pro prompt |
| `list_pro_tasks` | List recent Pro jobs |

## CLI Usage (Optional)

```bash
node dist/cli.js review "check auth.ts for security issues"
node dist/cli.js implement "add rate limiting"
node dist/cli.js custom "explain the caching system"
```

## Troubleshooting

### Tools not available in Claude

```bash
# Check config
cat ~/.claude/settings.json | jq '.mcpServers'

# Restart Claude Code
claude
```

### Codex errors

```bash
# Verify codex works directly
codex "hello"
```
