# Delegation servers and CLI

`mcp.ts` exposes Codex delegation to Claude Code. `claudeMcp.ts` exposes Claude delegation to Codex. Both use `delegationMcp.ts`, `jobs.ts`, `jobStore.ts`, and `runner.ts` for the same request lifecycle, persistent results, and workspace locking.

## Build and registration

```bash
npm ci
npm run build
```

Run the repository's `./setup-dual-agent.sh` to choose integrations interactively.
Choice 1 installs Codex delegation for Claude Code; choice 2 installs Claude
delegation for Codex. Each includes the MCP registration and companion host
skill. Select both choices to install both directions, or use `--both` for an
unattended installation. For manual registration, use the same absolute state
directory in both commands:

```bash
claude mcp add --scope user codex-delegate \
  --env CODEX_BIN=codex \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/mcp.js

codex mcp add claude-delegate \
  --env CLAUDE_BIN=/absolute/path/to/claude \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/claudeMcp.js
```

Restart the hosts to discover the tools. `npm run mcp` and `npm run claude-mcp` are the corresponding stdio entrypoints. Setup also persists `CODEX_HOME` for the Codex worker, and `CLAUDE_CONFIG_DIR` for the Claude worker when configured.

## Tool contract

The prefix is `delegate_codex` or `delegate_claude`:

| Suffix | Inputs |
|--------|--------|
| none | `prompt`, project/options below |
| `_review` | `prompt`, project/options below |
| `_implement` | `prompt`, project/options below |
| `_plan_review` | `plan`, project/options below |
| `_status` | `task_id`, optional `wait_ms` from 0 to 30000 |
| `_list` | optional `limit` from 1 to 100 (default 20) |
| `_cancel` | `task_id` |

Project/options: optional absolute `cwd`, `files` (array or comma-separated string), `mode` (`read-only` or `edit`), `wait` (default false), and `timeout_ms` (default 7200000). Implementation defaults to edit; other tasks default to read-only. Unknown arguments and invalid values are errors before execution.

The project directory is resolved from explicit `cwd`, then `CLAUDE_PROJECT_DIR`,
then the MCP server's inherited working directory. Stdio hosts normally launch
the server in the session's project. Pass `cwd` explicitly for another project,
or when the host changes projects after the server has started. Symlinks are
resolved before choosing the workspace lock.

Results include text and structured content: task ID, status, provider, execution mode, project/workspace, error, session ID, log/result paths, and a result excerpt. Large answers are capped at 64000 characters in the tool response, with the complete result on disk.

Status values are `running`, `completed`, `failed`, `cancelled`, and `interrupted`. Submit long tasks in background and collect results through channel events or `_status` with a bounded wait. Completed answers remain accessible from a new server instance. `_cancel` writes a cancellation request that the owning server handles using its live child-process handle.

## Completion notifications (channels)

The `codex-delegate` server pushes a one-way
[Claude Code channel](https://code.claude.com/docs/en/channels) event when a Codex
job finishes. Claude uses the event's task ID to retrieve the saved result with
`delegate_codex_status`. To enable this research-preview feature, launch an
interactive Claude Code session with:

```bash
claude --dangerously-load-development-channels server:codex-delegate
```

Accept the local-development confirmation at startup. The development flag is
ignored with `-p` or the Agent SDK. Channels require claude.ai or Console API-key
authentication; Bedrock, Vertex, and Foundry are unsupported. Team/Enterprise
organizations and Console organizations using managed settings must enable
channels. See the [channel reference](https://code.claude.com/docs/en/channels-reference).

With channels explicitly enabled, Claude can do independent work and collect
the result when notified. Otherwise, keep using status calls with
`wait_ms: 30000` until the job finishes. The server cannot tell whether Claude
enabled or received its channel events. The reverse `claude-delegate` server
uses status waits; it does not advertise Claude's channel capability to Codex.

Events carry `task_id`, `task_type`, `status`, and `duration`. They describe
`completed`, `failed`, `cancelled`, or `interrupted` jobs using the same persisted
job state as the status tool. Notification delivery is best effort: a closed
connection or crash can prevent an event, and old events are not replayed after
restart. Recover those results with the status/list tools. A result already
collected through a waiting call does not need to be presented again.

Desktop notifications remain available for both providers. Set
`DUAL_AGENT_NOTIFICATIONS=0` on the server to disable desktop notifications;
this does not disable channel events.

## Worker behavior

Prompts travel on stdin, avoiding shell interpolation and argument-size limits. Each task starts a fresh provider session; its returned session ID is retained as metadata. There is no automatic conversation resume or replay of interrupted edits.

- Codex: `exec --skip-git-repo-check --json --output-last-message ...`, with a read-only sandbox and `approval_policy=never`, or `--approve-for-me` for editing. Both delegation MCP servers are disabled in the child invocation.
- Claude: `--print --output-format json`, strict empty MCP configuration, and disabled skills/Chrome. Read-only jobs expose `Read,Glob,Grep` with `dontAsk`. Editing jobs expose file tools and Bash with automatic permission review. Calls that still require an unanswered permission are denied, and reported permission denials fail the job. Authentication and model configuration come from the installed Claude CLI.

The host authorizes the project directory passed to the worker. Codex's separate
Git-directory check is skipped so delegation works in non-Git projects too.
This does not change the job's read-only/edit policy, copy Claude's tool-permission
rules, or write entries to Codex's project trust configuration.

Stdout and stderr are logged separately from the final answer. Codex uses its final-message file; Claude's JSON `result` and `session_id` are parsed. Failed jobs retain any available final result and diagnostics.

## State and locks

Default state is `~/.local/state/dual-agent`, honoring `XDG_STATE_HOME`, or the complete `DUAL_AGENT_STATE_DIR` override. Use a local directory shared by both registrations. Each job stores `job.json`, `result.md`, `stdout.log`, and `stderr.log`; cancellation requests and Codex's final-message staging file are internal job files.

Metadata updates are atomic. Editing locks are exclusive and keyed to the canonical Git worktree root, or the explicit directory for a non-Git project. A rejected concurrent edit returns the active job ID. Locks coordinate these workers, not unrelated host/editor writes.

Shutdown stops active worker process groups and records interruption. On later access, a job whose owner died is marked interrupted. A suspected orphan worker keeps its edit lock until termination can be established. Recovery does not signal a process based on a stored PID. Corrupt locks or an interrupted stale-lock recovery fail closed. See [DELEGATION_DESIGN.md](../DELEGATION_DESIGN.md) for details.

## Standalone CLI

```bash
CODEX_BIN=codex node /FULL/PATH/TO/agent/dist/cli.js review "Check auth" --cwd /path/to/project --files src/auth.ts --output review.md
CODEX_BIN=codex node /FULL/PATH/TO/agent/dist/cli.js custom "Apply the agreed fix" --cwd /path/to/project --mode edit
CODEX_BIN=codex node /FULL/PATH/TO/agent/dist/cli.js --file task.md --no-stream
```

The CLI shares job persistence and locking. `--cwd` defaults to the shell's current directory. Options work before or after the prompt. Use `--` before a dash-prefixed prompt. Unknown flags and invalid values are errors.

`--output` writes a separate Markdown response. By default diagnostics stream to stderr and the final answer prints to stdout; `--no-stream` keeps diagnostics in the job logs. `--timeout` accepts 1–2147483647 milliseconds and defaults to five minutes. The process returns nonzero on errors or timeout.

Task files may include `## Task Type` and `## Files`; see [examples/task.md](examples/task.md). Explicit `--files` takes precedence over a file list in the task file.

## Optional ChatGPT Pro worker

The separate `chatgptProMcp.ts` entrypoint prepares and runs tasks in ChatGPT through Playwright Chromium. It retains its existing storage at `~/.codex/chatgpt-pro-worker/` and its persistent browser profile. Install with `./setup-dual-agent.sh --pro-worker`.

Tools: `login_status`, `open_pro_login`, `submit_pro_task`, `await_pro_task`, `save_pro_result`, `get_pro_task`, `show_pro_prompt`, `list_pro_tasks`.

The worker reads model, reasoning effort, and speed from `$CODEX_HOME/config.toml`. Selection is best effort; inspect the `Automation` field and picker screenshots. First login requires an interactive browser. Codex inspects, applies, and tests any generated patch.

## Tests

```bash
npx playwright install chromium
npm test
```

The suite covers both MCP servers, persistence, cancellation/process cleanup, locking, validation, CLI behavior, installer/uninstaller behavior, and browser model selection. Agent tests use fake executables; browser tests use local pages. Installer tests require Bash and jq; workspace tests require Git.
