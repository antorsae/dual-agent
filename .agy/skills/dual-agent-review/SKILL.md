---
name: dual-agent-review
description: Ask an installed Codex, Claude, Rosalind or Antigravity reviewer for an independent code review or plan critique from the AGY TUI and collect its findings.
---

# Delegate a review

Use the requested worker's MCP server (`codex-delegate`, `claude-delegate`,
`rosalind-delegate` or `agy-delegate`). Choose `delegate_<worker>_review` with
`prompt` for code, or `delegate_<worker>_plan_review` with `plan` for a design.
Pass the absolute project directory as `cwd`, plus the relevant file paths,
requirements and questions. Reviews run read-only. For Antigravity reviewing a
linked worktree, stage the required diffs and notes inside it. Use
`delegate_agy_models` when selecting a different Antigravity model for the job.

Submission returns a task ID. Use the same server's `delegate_<worker>_status`
with that ID and `wait_ms: 30000` until it finishes. Leave `timeout_ms` at the
worker default unless the user requests a limit. Use `_list` to recover a review
ID and `_cancel` when the review should stop. Report the verified findings and
any limits from the saved result.
