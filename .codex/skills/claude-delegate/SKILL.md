---
name: claude-delegate
description: Use Claude through MCP for an independent code review, plan critique, second opinion, debugging analysis, or a bounded implementation task. Use when Claude is requested, or proactively when another model's review would materially improve a complex change. No shell command or fixed prompt is needed.
---

# Delegate to Claude

Use the `claude-delegate` MCP server. Choose `delegate_claude_review`,
`delegate_claude_plan_review`, `delegate_claude_implement`, or `delegate_claude`.
Write the prompt for the current task, with requirements, relevant files, and
acceptance criteria. Do not ask the user to supply a command or repeat context.

Pass `cwd` as the absolute project directory. Review, plan-review, and custom
tasks default to `read-only`; implementation defaults to `edit`. For a custom
task that needs edits, explicitly set `mode: "edit"`.

An independent review is useful after a complex implementation or when choosing
between substantial approaches. Skip delegation for trivial changes or when
the user asks to work without it. Use implementation delegation only for a
bounded task; do not edit the same workspace while Claude owns its edit lock.

The call returns a persistent task ID by default. Continue with
`delegate_claude_status` and `wait_ms: 30000` until the job finishes, doing
independent work between calls where possible. Do not leave the user with only
"task started" unless they requested background work. Use `delegate_claude_list`
to recover a task ID and `delegate_claude_cancel` when the work should stop.

Inspect the result, changes, errors, and verification. A completed worker is
evidence to integrate, not a substitute for checking the user's objective.
If status is `interrupted`, inspect existing changes before retrying. Never
delete an edit lock to force another worker to start.

Tasks and results use MCP and the external job store. Do not create or read
`.agent-collab` request, response, or status files.
