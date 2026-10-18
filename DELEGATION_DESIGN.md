# Delegation implementation

Both MCP directions share one job manager and local state store. The host supplies the task prompt on every call. Codex and Claude remain ordinary child processes; there is no database, long-lived queue service, or terminal-based communication.

## Job lifecycle

1. Validate the request, resolve an absolute project directory, and identify the canonical Git worktree root (or the directory itself for non-Git projects).
2. Save a new UUID job and acquire an exclusive workspace lock for edit mode.
3. Mark startup in metadata, launch the worker, record its process identity, and send the task through stdin.
4. Save stdout/stderr separately. Capture Codex's final-message file or parse Claude's JSON answer and session ID.
5. Stop remaining worker descendants, atomically save the final status/result, and release the edit lock after cleanup is confirmed.

Project selection uses explicit `cwd`, then `CLAUDE_PROJECT_DIR`, then the
server's inherited working directory. This lets a host omit `cwd` for its
current project while retaining an absolute-path override for other projects.
The fallback follows the server's launch directory, not later host directory
changes. All paths still pass through validation and canonicalization.

`jobs/<uuid>/job.json` stores the provider, task, paths, mode, timestamps, owner, worker identity, status, and error. Result and log files live alongside it. The root defaults to `~/.local/state/dual-agent`, honors `XDG_STATE_HOME`, and can be overridden with `DUAL_AGENT_STATE_DIR`. Both host registrations use the same absolute root.

The original call returns a job ID by default. Status calls can wait up to 30 seconds, avoiding dependence on unusually long MCP request timeouts. Jobs continue while their server is alive; completed results are accessible after restart. A large result is returned as an excerpt with the complete file path.

The Codex MCP server also emits Claude Code channel events from the job manager's
completion callback, after finalizing job state. Events include the job ID, type,
terminal status, and duration; the host retrieves the full result through the
status tool. Claude must explicitly enable the channel for the current session.
The reverse server continues to use bounded status waits. Events are best effort
and are not persisted or replayed, so reconnecting hosts recover results through
status/list.

## Cancellation and interruption

A cancel tool writes a request into the job directory. The owning server notices it within its polling interval and stops the live worker process group, escalating termination when necessary. This also lets another live server instance request cancellation. Shutdown interrupts this server's jobs; it does not affect other owners' tasks.

A dead owner is detected during status/list reads. Such a job becomes `interrupted`, with no automatic retry. The caller should inspect any existing edits before explicitly submitting more work.

Linux owner identity includes the boot ID and process start time, avoiding confusion after PID reuse. Other systems conservatively use process liveness. Recovery never terminates a process using a PID read from disk. The state directory is intended to be local to one host; records from another host are treated conservatively.

If a worker or its process group might still be alive, its edit lock is retained. A crash during the narrow interval before the worker identity was recorded is also treated conservatively. Once termination can be established, an interrupted job's lock can be reclaimed. An ambiguous startup or corrupt metadata requires operator inspection; deleting a lock without checking for a live editor is unsafe.

## Workspace locking

Locks use an exclusive filesystem operation and contain the owning job ID. Stale-lock recovery is serialized so competing reclaimers cannot remove a new owner's lock. An interrupted recovery guard is retained for inspection, rather than guessed away.

All providers and the standalone Codex wrapper share these locks. Git subdirectories and symlink aliases resolve to the same worktree lock. Non-Git callers should use the same top-level project directory consistently. Separate Git worktrees can be chosen explicitly for concurrent editing.

The orchestrating agent must also avoid writing to the same workspace during a delegated edit. These locks coordinate delegated workers, not arbitrary editors or shell commands outside this project.

## Execution modes

Review, plan-review, and custom tasks default to `read-only`. Implementations default to `edit`; callers can explicitly set `mode`.

The caller authorizes the project directory. Codex workers pass
`--skip-git-repo-check` so this decision also works outside Git repositories.
The override is per invocation and does not update global project trust or
translate permissions between Claude and Codex.

Codex uses its read-only sandbox with approval escalation disabled for read-only tasks, and automatic approval review for editing. Claude exposes only file-reading tools in read-only mode, and file editing/Bash tools under automatic permission review for editing. Claude's tool restriction does not add an OS sandbox around CLI startup customizations. Permission denials are reported as a failed job, preserving the answer and logs for inspection.

Provider settings and project instructions remain native to the installed CLIs. Workers receive an instruction to complete the task themselves. Claude starts with an empty MCP configuration and disabled skills, while Codex disables all delegation servers. This prevents recursive handoffs.

## Host discovery and prompts

`codex-delegate` exposes Codex tools to Claude Code; `claude-delegate` exposes Claude tools to Codex; `rosalind-delegate` exposes the same Codex-backed tools to both hosts while selecting the `rosalind_delegate` Codex profile. Each has review, implementation, plan-review, custom, status, list, and cancel tools.

The installed host skills describe when an independent review is useful and how to gather a result. They guide proactive selection for substantial work while avoiding unnecessary delegation for trivial tasks. The host still decides whether to call a tool. Users do not maintain a fixed prompt or type a subprocess command.

`.agent-collab` is retired. MCP carries requests/results, state files provide persistence, and `AGENTS.md`/`CLAUDE.md` provide project guidance.
