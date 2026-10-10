# agent MCP servers

This package contains MCP servers and CLI helpers for the dual-agent environment.

## codex-delegate

MCP server that gives Claude Code direct access to Codex CLI.

**No API keys needed here. No tmux. No file-based communication. Just spawns `codex-pool` directly.**

## How It Works

```
Claude Code
    │
    │  "review auth.ts using codex"
    ▼
codex-delegate MCP Server
    │
    │  spawn("codex-pool", ["exec", "--approve-for-me", prompt])
    ▼
codex-pool (fresh process, uses its own auth and ~/.codex/config.toml)
    │
    │  analysis/implementation
    ▼
Results returned to Claude
```

Each tool call spawns a fresh Codex process. Context is passed in the prompt.

## Setup

### Prerequisites

`codex-pool` on your PATH and working (set `CODEX_BIN` to run a different Codex binary):

```bash
# Verify codex-pool is installed and authenticated
codex-pool exec "hello"
```

The setup script saves `CODEX_BIN` in the MCP server's environment so the override also applies after restarting Claude. For a manual registration, include it in the server's `env` object.

### Install

```bash
cd agent
npm install
npm run build
```

Run `npm test` for the picker and installer regression checks. These require Playwright Chromium (`npx playwright install chromium`), Bash, and jq; they use local fixtures and do not change your MCP registrations.

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

MCP server that prepares and runs arbitrary coding tasks in ChatGPT through Playwright Chromium.

It uses a persistent Chromium profile at `~/.codex/chatgpt-pro-worker/browser-profile`.

1. Codex gathers context and calls `submit_pro_task`.
2. The MCP server writes a durable job under `~/.codex/chatgpt-pro-worker/`.
3. It opens ChatGPT in Playwright Chromium, selects the configured model settings, and submits the prompt.
4. It waits for the response and saves the result.
5. Codex applies, tests, or summarizes the Pro result.

### Model Selection

The worker selects what Codex uses: `model`, `model_reasoning_effort`, and `service_tier` from `~/.codex/config.toml` (`$CODEX_HOME/config.toml` if set). Labels come from Codex's model catalog cache, `models_cache.json`: `gpt-6-astra` becomes GPT-6-Astra, `max` becomes Max, and `ultrafast` becomes Ultrafast. `submit_pro_task` accepts `model`, `reasoning_effort`, and `service_tier` to override them for one task.

Selection is best effort. Unavailable or disabled settings keep their current value. The job's `Automation` status distinguishes confirmed selections from clicks whose result could not be verified. `model-picker.png` in the job directory shows the picker when a setting was missing or unconfirmed.

### One-Time Login

ChatGPT login still requires an interactive browser session. On a desktop machine, install the worker, run `open_pro_login`, and log in once.

On a headless machine, use SSH X forwarding, VNC/noVNC, or copy a compatible authenticated Chromium profile into:

```text
~/.codex/chatgpt-pro-worker/browser-profile
```

After login, headless automation can use the saved profile.

### Configure Codex MCP

```bash
codex mcp add chatgpt-pro-worker --env "CODEX_HOME=${CODEX_HOME:-$HOME/.codex}" -- node /FULL/PATH/TO/agent/dist/chatgptProMcp.js
```

The setup script also saves this `CODEX_HOME` value explicitly: Codex does not pass it to MCP servers by default. Re-register the worker if you move to a different Codex config directory.

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
# Verify codex-pool works directly
codex-pool exec "hello"
```
