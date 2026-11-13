# Delegation servers and CLI

`mcp.ts` exposes Codex delegation to Claude Code, and `codexCodexMcp.ts` exposes it to Codex. `claudeMcp.ts` exposes Claude delegation to Codex. `rosalindMcp.ts` exposes a Codex profile and `agyMcp.ts` exposes native Antigravity to Claude Code, with `rosalindCodexMcp.ts` and `agyCodexMcp.ts` for Codex hosts. They all use `delegationMcp.ts`, `jobs.ts`, `jobStore.ts`, and `runner.ts` for the same request lifecycle, persistent results, and workspace locking.

## Build and registration

```bash
npm ci
npm run build
```

Run the repository's `./setup-dual-agent.sh` to choose integrations interactively.
Choice 1 installs Codex delegation for Claude Code; choice 2 installs Claude
delegation for Codex; choice 3 installs Rosalind delegation for both hosts;
choice 4 installs Codex delegation for Codex; choice 5 installs native Antigravity for both hosts and asks which available model to use.
Each includes the MCP registration and companion host skill. Select the choices
you need, or use `--both` for the two original directions. For manual
registration, use the same absolute state directory in all commands:

```bash
claude mcp add --scope user codex-delegate \
  --env CODEX_BIN=codex \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/mcp.js

codex mcp add claude-delegate \
  --env CLAUDE_BIN=/absolute/path/to/claude \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/claudeMcp.js

claude mcp add --scope user rosalind-delegate \
  --env CODEX_BIN=codex-pool \
  --env CODEX_HOME=/absolute/path/to/codex-home \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/rosalindMcp.js

codex mcp add rosalind-delegate \
  --env CODEX_BIN=codex-pool \
  --env CODEX_HOME=/absolute/path/to/codex-home \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/rosalindCodexMcp.js

claude mcp add --scope user agy-delegate \
  --env AGY_BIN=/absolute/path/to/agy \
  --env AGY_MODEL=MODEL_ID \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/agyMcp.js

codex mcp add agy-delegate \
  --env AGY_BIN=/absolute/path/to/agy \
  --env AGY_MODEL=MODEL_ID \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/agyCodexMcp.js

codex mcp add codex-delegate \
  --env CODEX_BIN=codex-pool \
  --env CODEX_HOME=/absolute/path/to/codex-home \
  --env DUAL_AGENT_STATE_DIR=/absolute/path/to/dual-agent-state \
  -- node /FULL/PATH/TO/agent/dist/codexCodexMcp.js
```

Codex gives MCP servers only a minimal environment. If a Codex model provider
reads its API key from a variable (`env_key`), add `env_vars = ["THAT_VARIABLE"]`
under the relevant `[mcp_servers.codex-delegate]` or `[mcp_servers.rosalind-delegate]`
table in Codex's `config.toml`. `codex mcp add` has no option for this; setup adds it.

Restart the hosts to discover the tools. `npm run mcp`, `npm run codex-codex-mcp`,
`npm run claude-mcp`, `npm run rosalind-mcp`, `npm run rosalind-codex-mcp`,
`npm run agy-mcp`, and `npm run agy-codex-mcp`
are the corresponding stdio entrypoints. Setup also persists `CODEX_HOME` for
the Codex worker, and `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_EFFORT_LEVEL` for the
Claude worker when configured; a saved effort is kept when setup reruns without it.

Rosalind requires `$CODEX_HOME/rosalind_delegate.config.toml` (default:
`~/.codex/rosalind_delegate.config.toml`). Setup preserves the existing profile
and sends one live request through it by default.

Antigravity uses the native `agy` executable and an explicit model ID from
`agy models`. Setup prompts for the model and persists `AGY_MODEL` and `AGY_BIN`
in both host registrations. Use `--agy-model MODEL_ID` or `AGY_MODEL` for
unattended installation; reruns can reuse the saved registration value.
The Codex host forwards `GEMINI_API_KEY` when present for native API-key setups;
normal Google sign-in uses Antigravity's cached credentials.

Rosalind and Antigravity perform live checks by default. `--skip-profile-checks`
skips both; `--skip-rosalind-profile-check` and `--skip-agy-check` skip one.
Installing Antigravity removes legacy Gemini registrations and skills only after
the new registrations succeed. Its status/list tools can still read legacy jobs.

## Tool contract

The prefix is `delegate_codex`, `delegate_claude`, `delegate_rosalind`, or `delegate_agy`:

| Suffix | Inputs |
|--------|--------|
| none | `prompt`, project/options below |
| `_review` | `prompt`, project/options below |
| `_implement` | `prompt`, project/options below |
| `_plan_review` | `plan`, project/options below |
| `_status` | `task_id`, optional `wait_ms` from 0 to 30000 |
| `_list` | optional `limit` from 1 to 100 (default 20) |
| `_cancel` | `task_id` |

Project/options: optional absolute `cwd`, `files` (array or comma-separated string), `mode` (`read-only` or `edit`), `wait` (default false), and `timeout_ms` (default 7200000). Implementation defaults to edit; other tasks default to read-only. For Codex, Rosalind, and Antigravity, read-only preserves the workspace while allowing tests and experiments in per-job scratch. Unknown arguments and invalid values are errors before execution.

The project directory is resolved from explicit `cwd`, then `CLAUDE_PROJECT_DIR`,
then the MCP server's inherited working directory. Stdio hosts normally launch
the server in the session's project. Pass `cwd` explicitly for another project,
or when the host changes projects after the server has started. Symlinks are
resolved before choosing the workspace lock.

Results include text and structured content: task ID, status, provider, execution mode, project/workspace, error, session ID, log/result paths, and a result excerpt. The text also shows elapsed time, output bytes, and, while the job runs, the time since the worker's last output. Large answers are capped at 64000 characters in the tool response, with the complete result on disk.

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

Use `server:rosalind-delegate` for Rosalind's completion channel or
`server:agy-delegate` for Antigravity's.

Accept the local-development confirmation at startup. The development flag is
ignored with `-p` or the Agent SDK. Channels require claude.ai or Console API-key
authentication; Bedrock, Vertex, and Foundry are unsupported. Team/Enterprise
organizations and Console organizations using managed settings must enable
channels. See the [channel reference](https://code.claude.com/docs/en/channels-reference).

With channels explicitly enabled, Claude can do independent work and collect
the result when notified. Otherwise, keep using status calls with
`wait_ms: 30000` until the job finishes. The server cannot tell whether Claude
enabled or received its channel events. The reverse `claude-delegate` server and
the Codex-hosted `codex-delegate` registration use status waits; they do not
advertise Claude's channel capability to Codex.

The Claude-hosted `rosalind-delegate` and `agy-delegate` servers use the same
channel behavior with `delegate_rosalind_status` and `delegate_agy_status`.
Their Codex-hosted registrations use bounded status
waits and do not advertise the Claude channel capability.

Events carry `task_id`, `task_type`, `status`, and `duration`. They describe
`completed`, `failed`, `cancelled`, or `interrupted` jobs using the same persisted
job state as the status tool. Notification delivery is best effort: a closed
connection or crash can prevent an event, and old events are not replayed after
restart. Recover those results with the status/list tools. A result already
collected through a waiting call does not need to be presented again.

## Worker behavior

Prompts travel on stdin, avoiding shell interpolation and argument-size limits. Each task starts a fresh provider session; its returned session ID is retained as metadata. There is no automatic conversation resume or replay of interrupted edits.

- Codex: `exec --skip-git-repo-check --json --output-last-message ...`. Read-only jobs use a unique named filesystem permission profile: read access to the filesystem, write access only to job scratch, network disabled, and `approval_policy=never`. `--strict-config` prevents unsupported profile configuration from being silently ignored. Editing uses `--approve-for-me`. Rosalind adds `-p rosalind_delegate`. Plain Codex jobs pass no model profile, so they use the default model configuration of the registered `CODEX_HOME`. All delegation MCP servers are disabled in the child invocation.
- Antigravity: native `agy --input-format stream-json --output-format stream-json --model ...`. The prompt is one JSON user event on stdin. Read-only jobs run from scratch with the original workspace allowed for reads and denied for writes, using `proceed-in-sandbox`. Editing uses native `auto` mode. Session-only permission settings deny MCP calls. Parse `init.conversation_id` and the final `result` envelope; non-success status and denied tool calls fail the job even if the CLI exits zero.
- Claude: `--print --output-format stream-json --verbose`, strict empty MCP configuration, and disabled skills/Chrome. Read-only jobs expose `Read,Glob,Grep` with `dontAsk` and allow reads anywhere (`Read(//**)`), matching Codex's read-only sandbox; without that rule, `dontAsk` denies reads outside the project. Editing jobs expose file tools and Bash with automatic permission review. Calls that still require an unanswered permission are denied, and reported permission denials fail the job. Authentication and model configuration come from the installed Claude CLI.

The host authorizes the project directory passed to the worker. Codex's separate
Git-directory check is skipped so delegation works in non-Git projects too.
This does not change the job's read-only/edit policy, copy Claude's tool-permission
rules, or write entries to Codex's project trust configuration.

Stdout and stderr are logged separately from the final answer. Codex uses its final-message file. Claude's event stream supplies the session ID at startup, which cancelled jobs keep, and the answer in its final `result` event; the stream shows progress every few seconds, even while Claude thinks. Failed jobs retain any available final result and diagnostics.

Read-only Codex jobs keep the original project as `cwd` and create
`jobs/<uuid>/scratch` outside the canonical workspace. The worker receives
`DUAL_AGENT_SCRATCH_DIR`, `TMPDIR`/`TMP`/`TEMP`, `XDG_CACHE_HOME`,
`PYTHONPYCACHEPREFIX`, `COVERAGE_FILE`, and `npm_config_cache` pointing into scratch.
`PYTEST_ADDOPTS` preserves existing arguments and appends the scratch cache location.
The prompt tells the worker to redirect other generated files or copy the required
inputs into scratch. Read-only reviews can run tests without selecting edit mode.
Scratch files are retained with the job and returned as `paths.scratch` for inspection.
Antigravity uses the same cache variables but runs from scratch, with the original project path supplied in the prompt. Claude's read-only jobs keep their existing file-tool restriction.

Antigravity's allowed source tree does not automatically include external Git
metadata, `/tmp` notes, or dependencies behind outside-worktree symlinks. The host
must stage required notes and complete parent/submodule patches (including new
files and base commit IDs) inside the allowed worktree before review. The review
prompt should require the saved diff plus source, not external Git commands.
Native terminal `denied_actions` are reported as failed/incomplete work even when
the CLI returns `SUCCESS`, exits zero, or produces a partial answer.

## State and locks

Default state is `~/.local/state/dual-agent`, honoring `XDG_STATE_HOME`, or the complete `DUAL_AGENT_STATE_DIR` override. Use a local directory shared by all registrations. Each job stores `job.json`, `result.md`, `stdout.log`, and `stderr.log`; cancellation requests and Codex's final-message staging file are internal job files.

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

## Tests

```bash
npm test
```

The suite covers all delegation servers, persistence, cancellation/process cleanup, locking, validation, CLI behavior, and installer/uninstaller behavior. Agent tests use fake executables. Installer tests require Bash and jq; workspace tests require Git.

To test the real filesystem sandbox without a model request, use an installed
Codex with named permission-profile support and a Python environment with pytest:

```bash
DUAL_AGENT_SANDBOX_BIN=codex DUAL_AGENT_TEST_PYTHON=/path/to/python node --test tests/sandbox.test.mjs
```

This opt-in check runs pytest and SQLite, verifies cache redirection, and checks
that writes to source files, job metadata, and symlinks targeting the workspace fail.
