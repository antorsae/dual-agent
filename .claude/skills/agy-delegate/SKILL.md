---
name: agy-delegate
description: Use Antigravity through MCP for an independent code review, plan critique, second opinion, debugging analysis, or a bounded implementation task. Antigravity runs natively through agy with the model selected during setup.
---

# Delegate to Antigravity

Use `delegate_agy_review`, `delegate_agy_plan_review`,
`delegate_agy_implement`, or `delegate_agy` from the
`agy-delegate` MCP server.
Write the prompt for the current request and pass relevant file paths. Omit
`cwd` to use `CLAUDE_PROJECT_DIR` when set, otherwise the directory where the host
launched the server. Pass an absolute `cwd` when targeting another project or if
the host has changed projects since launch.

Review, plan-review, and custom tasks default to `read-only`; implementation
defaults to `edit`. Explicitly choose `mode: "edit"` for a custom editing task.
Do not edit the same workspace while a delegated implementation owns its lock.
Skip delegation for trivial changes or when the user asks to work without it.

Before launching a review, save the complete parent and backend/submodule diffs
and required external notes inside the allowed worktree, for example under
`tmp/agy-review/`. Record the compared commits and include staged, unstaged, and
new files. A parent gitlink does not include the child repository's changes.
Copy the content itself; symlinks to external Git metadata or `/tmp` notes remain
outside the sandbox. Pass the saved paths as context and tell AGY to review the
saved diff plus current source without requiring external Git metadata. Keep
read-only mode and existing permissions. Report any missing context as a limit.

Read-only jobs can run tests and experiments in an isolated writable scratch
directory while project files remain read-only. Temporary files and common test
caches are redirected there. Keep `mode: "read-only"` for reviews that execute
tests; redirect other outputs or copy inputs into scratch when needed. The tool
response exposes `paths.scratch`, retained with the job results.

If this session explicitly enabled the `agy-delegate` channel, do independent
work while waiting for its completion event. On a
`<channel source="agy-delegate" task_id="...">` event, call
`delegate_agy_status` with that task ID to collect the result. No channel reply
is needed; do not present a result twice if a waiting call already collected it.
When channel delivery is unavailable or uncertain, continue with
`delegate_agy_status` and `wait_ms: 30000` until completion, doing independent
work between calls where possible. Events are not replayed after a restart.

A task ID or running status is not the completed answer. Use
`delegate_agy_list` to recover IDs and `delegate_agy_cancel` to stop work.
Leave `timeout_ms` unset unless the user asks for a limit: it kills the worker
and discards its answer, and reviews can take from minutes to over an hour.
Inspect the returned findings, changes, and tests before reporting completion.
Inspect changes from an interrupted job before retrying; never delete a lock
to force a new worker.

Use MCP and the external job store for communication. `.agent-collab` is retired.
