---
name: claude-status
description: Check collaboration status from Codex side. Use when user says claude status, check status, or collaboration status.
---

# Claude Status Skill

Check the collaboration status from the Codex side.

## Steps

### 1. Read Status

Read `.agent-collab/status` and report:
- `idle`: No active task
- `pending`: Claude sent task, waiting for pickup with `/read-task`
- `working`: Currently processing a task
- `done`: Finished, waiting for Claude to read with `/codex-read`

### 2. Show Pending Task

If status is `pending`, read and summarize `.agent-collab/requests/task.md`:
- What Claude is asking
- Task type
- Key details

### 3. Suggest Action

Based on status:
- `pending`: Run /read-task to pick up the task
- `working`: Continue working on current task
- `done`: Waiting for Claude - user should run /codex-read in Claude pane
- `idle`: No pending tasks, waiting for Claude to delegate
