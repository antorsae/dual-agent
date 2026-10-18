# Dual Agent Development Environment

Let **Claude Code delegate to Codex**, **Codex delegate to Claude**, and either host delegate to Codex through the **Rosalind** profile, through MCP. Each task has its own prompt, project directory, execution mode, saved result, and cancellation control.

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
| 3 | Use Rosalind (Codex profile) from Claude Code and Codex |

Toggle the choices you want, then press `c` to install. Select **1 and 2** for
both delegation directions. Choose 3 to install the Rosalind server in both hosts.
Each delegation choice installs its MCP server registration and host skill.

Restart Claude Code and Codex to discover the tools and their companion skills. You can describe the work normally:

```text
Get an independent review of this authentication change.
Have Claude critique the migration plan.
Ask Codex to implement this bounded API change.
Use Rosalind to get a second review under its separate Codex profile.
```

The MCP tools accept a different prompt on every call. The installed skills guide each host to use the other model for useful independent reviews and bounded tasks, then collect and check the result. Tool selection remains the host agent's decision; no fixed shell prompt or terminal pane is needed.

Setup prefers `codex-pool` for Codex work, falling back to `codex`. Override the executables when needed:

```bash
CODEX_BIN=/absolute/path/to/codex CLAUDE_BIN=/absolute/path/to/claude ./setup-dual-agent.sh
```

Each worker uses its own CLI authentication and model configuration. The Claude worker keeps subscription authentication available and does not use `--bare`.

Rosalind setup requires the Codex profile file
`$CODEX_HOME/rosalind_delegate.config.toml` (default:
`~/.codex/rosalind_delegate.config.toml`). Setup validates the existing profile
and does not create or overwrite it. To perform a real one-request verification,
run `./setup-dual-agent.sh --rosalind-mcp --verify-rosalind-profile`; the check is
skipped by default so installation does not make a model request unexpectedly.

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

Rosalind exposes the same seven tools in both hosts, using the `delegate_rosalind`
prefix:

| Task | From Claude Code | From Codex |
|------|------------------|------------|
| Code review | `delegate_rosalind_review` | `delegate_rosalind_review` |
| Implementation | `delegate_rosalind_implement` | `delegate_rosalind_implement` |
| Plan review | `delegate_rosalind_plan_review` | `delegate_rosalind_plan_review` |
| Custom task | `delegate_rosalind` | `delegate_rosalind` |
| Status and result | `delegate_rosalind_status` | `delegate_rosalind_status` |
| Recent jobs | `delegate_rosalind_list` | `delegate_rosalind_list` |
| Cancellation | `delegate_rosalind_cancel` | `delegate_rosalind_cancel` |

Rosalind runs the selected `codex-pool` or `codex` executable with the
`-p rosalind_delegate` profile.

Delegation inputs are `prompt` (or `plan` for plan review), `cwd`, optional `files`, optional `mode`, `wait`, and `timeout_ms`. `files` accepts an array or a comma-separated string.

`cwd` is optional. When omitted, the server uses `CLAUDE_PROJECT_DIR` if set,
otherwise the directory where the host launched the MCP server. Pass an absolute
`cwd` to target another project or if the host changes projects after launch.
Both the canonical project path and the workspace used for locking are returned
with the job.

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

A call returns a persistent task ID immediately by default. For automatic Codex
completion events in Claude Code, start an interactive session with:

```bash
claude --dangerously-load-development-channels server:codex-delegate
```

For Rosalind completion events, use the corresponding server name:

```bash
claude --dangerously-load-development-channels server:rosalind-delegate
```

Claude can then do independent work and fetch the saved result when the event
arrives. See [channel setup and requirements](agent/README.md#completion-notifications-channels).
Without an enabled channel, including when Codex delegates to Claude, continue
with the corresponding status tool:

```json
{
  "task_id": "the-returned-uuid",
  "wait_ms": 30000
}
```

The status call waits up to 30 seconds, returning sooner when the job finishes. This works within ordinary MCP request timeouts and avoids rapid polling. `wait: true` on the original delegation call is also available for short tasks; long tasks should use background submission with channel events or bounded status waits.

Tasks time out after two hours by default. `timeout_ms` overrides this. The cancel tool accepts `task_id` and can request cancellation from another live instance of the same provider's server. Cancellation stops the worker process group and retains diagnostics.

Jobs live under `~/.local/state/dual-agent/jobs/<uuid>/`. `XDG_STATE_HOME` changes the state base; `DUAL_AGENT_STATE_DIR` overrides the complete `dual-agent` directory. Setup persists the same absolute state path in all MCP registrations so they share results and locks.

Each job saves `job.json`, `result.md`, `stdout.log`, and `stderr.log`. Completed results survive server restart. Tool responses include file paths and a bounded excerpt of large answers; the full result remains on disk. Closing a server interrupts its unfinished jobs. An unexpected crash is reconciled on status/list access; tasks are not automatically retried.

## Workspace behavior

Only one delegated editing job can own a workspace at a time, across all providers and server instances. Git projects lock the worktree root, so subdirectories and symlink aliases share the same lock. Non-Git projects lock the specified canonical directory.

A conflicting edit is rejected with the active task ID. The host agent should also stop editing that workspace while its worker edits it. The lock cannot prevent changes by an unrelated editor. Use a separate Git worktree explicitly when parallel editing is necessary.

Codex workers accept the project directory selected by the host, including
directories outside Git repositories. They do not require a second Git-directory
check. This shares the host's directory choice; each CLI still applies its own
tool permissions and project-configuration trust rules.

Codex reviews run in its read-only sandbox with approval escalation disabled. Claude reviews receive only `Read`, `Glob`, and `Grep` tools. Claude edits use automatic permission review; unavailable permissions or denied tool calls produce a failed job with the available result for inspection. Claude's read-only mode is a tool restriction, not an additional operating-system sandbox around its startup hooks or extensions.

Workers are told to complete their assigned task themselves. Claude workers load no configured MCP servers; Codex workers disable all three delegation servers to avoid recursive handoffs. Project guidance continues to use the native `AGENTS.md` and `CLAUDE.md` conventions.

`.agent-collab` is retired. Existing files stay ignored as legacy data, but the runtime does not read, initialize, or overwrite them. See [DELEGATION_DESIGN.md](DELEGATION_DESIGN.md) for lifecycle and recovery details.

## Unattended installation

These explicit options skip the interactive questions:

| Option | Installs |
|--------|----------|
| `--both` | Both delegation MCP servers and their host skills |
| `--codex-mcp` (or `--mcp`) | Codex delegation for Claude Code |
| `--claude-mcp` | Claude delegation for Codex |
| `--rosalind-mcp` | Rosalind delegation for Claude Code and Codex |
| `--all` | All delegation integrations |

Build and registration errors stop setup with the underlying diagnostic. Setup does not write project context or `.gitignore` files.

Installation commands are quiet by default and save their output to a temporary
log. Set `DUAL_AGENT_VERBOSE=1` to stream command output, or set
`DUAL_AGENT_INSTALL_LOG=/path/to/install.log` to choose the log path.

## Standalone Codex CLI

```bash
CODEX_BIN=codex node /FULL/PATH/TO/agent/dist/cli.js review "Check auth" --cwd /path/to/project --files src/auth.ts --output review.md
CODEX_BIN=codex node /FULL/PATH/TO/agent/dist/cli.js custom "Implement the agreed fix" --cwd /path/to/project --mode edit
```

This CLI shares the delegation job store and edit locks. Its default timeout is five minutes. Options work before or after the prompt; `--file` accepts a Markdown task, `--output` saves a Markdown response, and `--no-stream` buffers diagnostics while printing the final answer at completion. `--help` lists the options.

## Troubleshooting and removal

```bash
claude mcp get codex-delegate
claude mcp get rosalind-delegate
codex mcp get claude-delegate
codex mcp get rosalind-delegate
```

Claude's user-scope registration is managed in `~/.claude.json`; Codex's is in its config directory. The registration commands and server entrypoints are documented in [agent/README.md](agent/README.md).

For a blocked edit, inspect the active job and cancel it if appropriate. After an interrupted process, inspect existing changes before retrying. The lock remains if a worker might still be alive or its termination is unknown; recovery does not kill processes based on stored PIDs. Corrupt locks and interrupted lock recovery require inspection rather than automatic deletion.

```bash
./uninstall-dual-agent.sh
```

Uninstall removes all delegation registrations and installed skills. It preserves project files and saved job data.

## Development

```bash
cd agent
npm ci
npm test
```

Tests use fake agent executables and temporary state directories. They do not submit model requests or alter actual MCP registrations. Generated dependencies and build output are ignored by Git.

## License

MIT
