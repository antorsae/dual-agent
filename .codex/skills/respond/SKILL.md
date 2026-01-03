---
name: respond
description: Manually write response back to Claude. Use if read-task did not auto-complete or to finalize response.
---

# Respond Skill

Manually write response back to Claude.

## When to Use

- If `/read-task` didn't auto-complete
- To finalize or modify a response
- To manually send findings to Claude

## Steps

### 1. Gather Response

If task not yet completed, finish it now.

Collect all findings, code, or analysis.

### 2. Write Response

Write to `.agent-collab/responses/response.md`:

```markdown
# Codex Response

## Task Type
[CODE_REVIEW | IMPLEMENT | PLAN_REVIEW]

## Completed At
[Current timestamp]

## Summary
[Brief summary]

## Detailed Findings/Output
[Full response content]
```

### 3. Update Status

Write `done` to `.agent-collab/status`

### 4. Confirm

Tell user: "Response written. Claude can now use /codex-read to retrieve it."
