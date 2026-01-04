# codex-delegate

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
    │  spawn("codex", ["--full-auto", prompt])
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
