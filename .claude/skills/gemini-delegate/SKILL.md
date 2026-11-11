---
name: gemini-delegate
description: Use Gemini through MCP for an independent code review, plan critique, second opinion, debugging analysis, or a bounded implementation task. Gemini runs Codex with the gemini profile.
---

# Delegate to Gemini

Use `delegate_gemini_review`, `delegate_gemini_plan_review`,
`delegate_gemini_implement`, or `delegate_gemini` from the
`gemini-delegate` MCP server.
Write the prompt for the current request and pass relevant file paths. Omit
`cwd` to use `CLAUDE_PROJECT_DIR` when set, otherwise the directory where the host
launched the server. Pass an absolute `cwd` when targeting another project or if
the host has changed projects since launch.

Review, plan-review, and custom tasks default to `read-only`; implementation
defaults to `edit`. Explicitly choose `mode: "edit"` for a custom editing task.
Do not edit the same workspace while a delegated implementation owns its lock.
Skip delegation for trivial changes or when the user asks to work without it.

If this session explicitly enabled the `gemini-delegate` channel, do independent
work while waiting for its completion event. On a
`<channel source="gemini-delegate" task_id="...">` event, call
`delegate_gemini_status` with that task ID to collect the result. No channel reply
is needed; do not present a result twice if a waiting call already collected it.
When channel delivery is unavailable or uncertain, continue with
`delegate_gemini_status` and `wait_ms: 30000` until completion, doing independent
work between calls where possible. Events are not replayed after a restart.

A task ID or running status is not the completed answer. Use
`delegate_gemini_list` to recover IDs and `delegate_gemini_cancel` to stop work.
Leave `timeout_ms` unset unless the user asks for a limit: it kills the worker
and discards its answer, and reviews can take from minutes to over an hour.
Inspect the returned findings, changes, and tests before reporting completion.
Inspect changes from an interrupted job before retrying; never delete a lock
to force a new worker.

Use MCP and the external job store for communication. `.agent-collab` is retired.
