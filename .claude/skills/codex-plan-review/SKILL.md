---
name: codex-plan-review
description: Send implementation plan to Codex for critique and validation. Use when user says review plan, codex plan review, or wants architectural feedback.
---

# Codex Plan Review Skill

Send an implementation plan to Codex for critical analysis and validation.

## When to Use

- Before implementing complex features
- When architectural decisions need validation
- User wants second opinion on approach

## Steps

### 1. Gather the Plan

Ensure plan includes:
- Overall approach
- Step-by-step strategy
- Files to create/modify
- Key architectural decisions
- Potential risks

If no plan exists, help user create one first.

### 2. Write Review Request

Write to `.agent-collab/requests/task.md`:

```markdown
# Task Request for Codex

## Task Type: PLAN_REVIEW

## Timestamp
[Current timestamp]

## Plan Title
[Brief title]

## The Plan
[Full plan content]

## Review Questions
- Is this approach sound?
- Are there edge cases not considered?
- Is the architecture appropriate?
- Are there simpler alternatives?
- What are the risks?

## Specific Concerns
[Areas of uncertainty]

## Constraints
[Constraints to respect]
```

### 3. Update Status

Write `pending` to `.agent-collab/status`

### 4. Trigger Codex

```bash
tmux send-keys -t 1 '$read-task' && sleep 0.5 && tmux send-keys -t 1 Enter Enter
```

### 5. Notify User

Tell user briefly that plan was sent to Codex for review.

### 6. Wait for Codex (Background Polling)

Start a background polling loop to wait for Codex to complete. Run this bash command using the Bash tool with `run_in_background: true`:

```bash
while [ "$(cat .agent-collab/status)" != "done" ]; do sleep 3; done; echo "CODEX_COMPLETE"
```

IMPORTANT: Use background execution so you can continue helping the user while waiting.

### 7. Auto-Read Response

When poll completes, automatically:
1. Read `.agent-collab/responses/response.md`
2. Present Codex's critique clearly
3. Suggest plan refinements based on feedback
4. Reset `.agent-collab/status` to `idle`
