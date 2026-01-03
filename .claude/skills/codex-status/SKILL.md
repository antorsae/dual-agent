---
name: codex-status
description: Check the current status of Codex collaboration. Use when user says codex status, check codex, or collaboration status.
---

# Codex Status Skill

Check the current state of the Claude-Codex collaboration.

## Steps

### 1. Read Status

Read `.agent-collab/status` and report:
- `idle`: No active task, ready for requests
- `pending`: Task sent, waiting for Codex
- `working`: Codex actively processing
- `done`: Codex finished, response ready

### 2. Show Current Task

If status is not `idle`, read and summarize `.agent-collab/requests/task.md`:
- Task type
- Brief description

### 3. Show Response Preview

If status is `done`, show brief preview of `.agent-collab/responses/response.md`

### 4. Suggest Action

Based on status:
- `idle`: Ready to delegate with /codex-review, /codex-implement, or /codex-plan-review
- `pending`: Check Codex pane or wait
- `working`: Codex is working, wait for completion
- `done`: Use /codex-read to see results
