# Dual Agent Development Environment

Let **Claude Code delegate to Codex**, and **Codex delegate to Claude**, through MCP. Each task has its own prompt, project directory, execution mode, saved result, and cancellation control. Optional integrations also let either agent use ChatGPT through a browser.

## Installation

Install Node.js with npm, Claude Code, and Codex CLI. Authenticate both CLIs, then run:

```bash
./setup-dual-agent.sh
```

Setup asks which integrations to install:

| Choice | Integration |
|--------|-------------|
| 1 | Use Codex from Claude Code — MCP tools and skill |
| 2 | Use Claude from Codex — MCP tools and skill |
| 3 | Review with ChatGPT from Claude Code — Chrome integration |
| 4 | Use the ChatGPT Pro worker from Codex |
| 5 | Desktop notification support |

Toggle the choices you want, then press `c` to install. Select **1 and 2** for
both delegation directions. Each delegation choice installs its MCP server registration
and host skill; neither delegation direction depends on a browser integration.

Restart Claude Code and Codex to discover the tools and their companion skills. You can describe the work normally:

```text
Get an independent review of this authentication change.
Have Claude critique the migration plan.
Ask Codex to implement this bounded API change.
```

The MCP tools accept a different prompt on every call. The installed skills guide each host to use the other model for useful independent reviews and bounded tasks, then collect and check the result. Tool selection remains the host agent's decision; no fixed shell prompt or terminal pane is needed.

Setup prefers `codex-pool` for Codex work, falling back to `codex`. Override the executables when needed:

```bash
CODEX_BIN=/absolute/path/to/codex CLAUDE_BIN=/absolute/path/to/claude ./setup-dual-agent.sh
```

Each worker uses its own CLI authentication and model configuration. The Claude worker keeps subscription authentication available and does not use `--bare`.

## MCP tools

| Task | From Claude Code | From Codex |
|------|------------------|------------|
| Code review | `delegate_codex_review` | `delegate_claude_review` |
| Implementation | `delegate_codex_implement` | `delegate_claude_implement` |
| Plan review | `delegate_codex_plan_review` | `delegate_claude_plan_review` |
| Custom task | `delegate_codex` | `delegate_claude` |
| Status and result | `delegate_codex_status` | `delegate_claude_status` |
| Recent jobs | `delegate_codex_list` | `delegate_claude_list` |
| Cancellation | `delegate_codex_cancel` | `delegate_claude_cancel` |

Delegation inputs are `prompt` (or `plan` for plan review), `cwd`, optional `files`, optional `mode`, `wait`, and `timeout_ms`. `files` accepts an array or a comma-separated string.

`cwd` must be an absolute project directory. The Claude host can supply it through `CLAUDE_PROJECT_DIR` when omitted. Codex callers should pass it explicitly. Both the canonical project path and the workspace used for locking are returned with the job.

Review, plan-review, and custom tasks default to **read-only**. Implementation defaults to **edit**. A custom editing task must explicitly select `mode: "edit"`.

```json
{
  "prompt": "Review authentication error handling and report concrete defects",
  "cwd": "/absolute/path/to/project",
  "files": ["src/auth.ts"],
  "mode": "read-only"
}
```

## Results, waiting, and cancellation

A call returns a persistent task ID immediately by default. Continue with the corresponding status tool:

```json
{
  "task_id": "the-returned-uuid",
  "wait_ms": 30000
}
```

The status call waits up to 30 seconds, returning sooner when the job finishes. This works within ordinary MCP request timeouts and avoids rapid polling. `wait: true` on the original delegation call is also available for short tasks; long tasks should use background submission and bounded status waits.

Tasks time out after two hours by default. `timeout_ms` overrides this. The cancel tool accepts `task_id` and can request cancellation from another live instance of the same provider's server. Cancellation stops the worker process group and retains diagnostics.

Jobs live under `~/.local/state/dual-agent/jobs/<uuid>/`. `XDG_STATE_HOME` changes the state base; `DUAL_AGENT_STATE_DIR` overrides the complete `dual-agent` directory. Setup persists the same absolute state path in both MCP registrations so they share results and locks.

Each job saves `job.json`, `result.md`, `stdout.log`, and `stderr.log`. Completed results survive server restart. Tool responses include file paths and a bounded excerpt of large answers; the full result remains on disk. Closing a server interrupts its unfinished jobs. An unexpected crash is reconciled on status/list access; tasks are not automatically retried.

## Workspace behavior

Only one delegated editing job can own a workspace at a time, across both providers and server instances. Git projects lock the worktree root, so subdirectories and symlink aliases share the same lock. Non-Git projects lock the specified canonical directory.

A conflicting edit is rejected with the active task ID. The host agent should also stop editing that workspace while its worker edits it. The lock cannot prevent changes by an unrelated editor. Use a separate Git worktree explicitly when parallel editing is necessary.

Codex reviews run in its read-only sandbox with approval escalation disabled. Claude reviews receive only `Read`, `Glob`, and `Grep` tools. Claude edits use automatic permission review; unavailable permissions or denied tool calls produce a failed job with the available result for inspection. Claude's read-only mode is a tool restriction, not an additional operating-system sandbox around its startup hooks or extensions.

Workers are told to complete their assigned task themselves. Claude workers load no configured MCP servers; Codex workers disable the two delegation servers to avoid recursive handoffs. Project guidance continues to use the native `AGENTS.md` and `CLAUDE.md` conventions.

`.agent-collab` is retired. Existing files stay ignored as legacy data, but the runtime does not read, initialize, or overwrite them. See [DELEGATION_DESIGN.md](DELEGATION_DESIGN.md) for lifecycle and recovery details.

## Unattended installation

These explicit options skip the interactive questions:

| Option | Installs |
|--------|----------|
| `--both` | Both delegation MCP servers and their host skills |
| `--codex-mcp` (or `--mcp`) | Codex delegation for Claude Code |
| `--claude-mcp` | Claude delegation for Codex |
| `--pro-worker` | ChatGPT Pro browser worker for Codex |
| `--all` | All integrations and notification dependencies |

Build, browser installation, and registration errors stop setup with the underlying diagnostic. Setup does not write project context or `.gitignore` files.

## Optional browser integrations

Select component 3 and start `claude --chrome` to use `/chatgpt-code-review`. This requires the Claude in Chrome extension and a signed-in ChatGPT browser session. Known limitation: this legacy browser skill's JSON injection snippet can throw on ordinary prompt text.

For Codex's Playwright worker, install `--pro-worker`, restart Codex, and use `$chatgpt-pro-worker`. Call `open_pro_login` once and complete login in the persistent profile at `~/.codex/chatgpt-pro-worker/browser-profile`, then call `login_status`. First login requires a desktop display, SSH X forwarding, or VNC.

The browser integrations attempt to select the model, reasoning effort, and speed from `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`). Selection is best effort; inspect the job's `Automation` field. This browser worker retains its separate existing job storage.

## Standalone Codex CLI

```bash
CODEX_BIN=codex node /FULL/PATH/TO/agent/dist/cli.js review "Check auth" --cwd /path/to/project --files src/auth.ts --output review.md
CODEX_BIN=codex node /FULL/PATH/TO/agent/dist/cli.js custom "Implement the agreed fix" --cwd /path/to/project --mode edit
```

This CLI shares the delegation job store and edit locks. Its default timeout is five minutes. Options work before or after the prompt; `--file` accepts a Markdown task, `--output` saves a Markdown response, and `--no-stream` buffers diagnostics while printing the final answer at completion. `--help` lists the options.

## Troubleshooting and removal

```bash
claude mcp get codex-delegate
codex mcp get claude-delegate
```

Claude's user-scope registration is managed in `~/.claude.json`; Codex's is in its config directory. The registration commands and server entrypoints are documented in [agent/README.md](agent/README.md).

For a blocked edit, inspect the active job and cancel it if appropriate. After an interrupted process, inspect existing changes before retrying. The lock remains if a worker might still be alive or its termination is unknown; recovery does not kill processes based on stored PIDs. Corrupt locks and interrupted lock recovery require inspection rather than automatic deletion.

```bash
./uninstall-dual-agent.sh
```

Uninstall removes both delegation registrations, the optional Pro worker registration, installed skills, and legacy terminal settings. It preserves project files, saved job data, and browser profiles.

## Development

```bash
cd agent
npm ci
npx playwright install chromium
npm test
```

Tests use fake agent executables, temporary state directories, and local browser pages. They do not submit model requests or alter actual MCP registrations. Generated dependencies and build output are ignored by Git.

## License

MIT
