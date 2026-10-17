---
name: codex-delegate
description: Use Codex through MCP for an independent code review, plan critique, second opinion, debugging analysis, or a bounded implementation task. Use when Codex is requested, or proactively when another model's review would materially improve a complex change.
---

# Delegate to Codex

Use `delegate_codex_review`, `delegate_codex_plan_review`,
`delegate_codex_implement`, or `delegate_codex` from the `codex-delegate` MCP server.
Write the prompt for the current request and pass relevant file paths and the
absolute project directory in `cwd`. The server can also use `CLAUDE_PROJECT_DIR`.

Review, plan-review, and custom tasks default to `read-only`; implementation
defaults to `edit`. Explicitly choose `mode: "edit"` for a custom editing task.
Do not edit the same workspace while a delegated implementation owns its lock.
Skip delegation for trivial changes or when the user asks to work without it.

Continue with `delegate_codex_status` and `wait_ms: 30000` until completion,
doing independent work between calls where possible. A task ID or running
status is not the completed answer. Use `delegate_codex_list` to recover IDs,
and `delegate_codex_cancel` to stop work. Inspect the returned findings,
changes, and tests before reporting completion. Inspect changes from an
interrupted job before retrying; never delete a lock to force a new worker.

Use MCP and the external job store for communication. `.agent-collab` is retired.
