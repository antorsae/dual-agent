---
name: codex-review
description: Send code to Codex for deep review and bug finding. Use this PROACTIVELY after writing significant code, completing implementations, or when complex code needs analysis. Also use when user explicitly says codex review, delegate review, or wants thorough code analysis.
---

# Codex Review Skill

Send code to the Codex agent (running in tmux pane 1) for deep code review.

## When to Use

- User wants thorough code review
- User says "codex review" or "delegate review"
- Complex code needs security/bug analysis

## Steps

Before any file operations, resolve the `.agent-collab` directory so commands work outside the project root:

```bash
AGENT_COLLAB_DIR="${AGENT_COLLAB_DIR:-}"
if [ -n "$AGENT_COLLAB_DIR" ]; then
  if [ -d "$AGENT_COLLAB_DIR/.agent-collab" ]; then
    AGENT_COLLAB_DIR="$AGENT_COLLAB_DIR/.agent-collab"
  elif [ ! -d "$AGENT_COLLAB_DIR" ]; then
    AGENT_COLLAB_DIR=""
  fi
fi

if [ -z "$AGENT_COLLAB_DIR" ]; then
  AGENT_COLLAB_DIR="$(pwd)"
  while [ "$AGENT_COLLAB_DIR" != "/" ] && [ ! -d "$AGENT_COLLAB_DIR/.agent-collab" ]; do
    AGENT_COLLAB_DIR="$(dirname "$AGENT_COLLAB_DIR")"
  done
  AGENT_COLLAB_DIR="$AGENT_COLLAB_DIR/.agent-collab"
fi
```

If `$AGENT_COLLAB_DIR` does not exist, stop and ask for the project root.

### 1. Gather Code to Review

Ask user what to review if not specified:
- Specific file(s)
- Recent changes (git diff)
- A code block they provide

### 2. Write Task Request

Write to `$AGENT_COLLAB_DIR/requests/task.md`:

```markdown
# Task Request for Codex

## Task Type: CODE_REVIEW

## Timestamp
[Current timestamp]

## Files to Review
[List files with FULL ABSOLUTE paths, e.g. /Users/antor/project/src/main.cpp]

**NOTE: Codex runs in the same working directory and CAN read these files directly.
Do NOT copy file contents here. Just list the paths and Codex will read them.**

## Review Focus
- Look for bugs, edge cases, logic errors
- Check for security vulnerabilities
- Identify performance issues
- Suggest improvements

## Specific Concerns
[Any areas user wants examined]
```

### 3. Update Status

Write `pending` to `$AGENT_COLLAB_DIR/status`

### 4. Trigger Codex

Run this bash command to trigger Codex in the other pane:

```bash
tmux send-keys -t 1 '$read-task' && sleep 0.5 && tmux send-keys -t 1 Enter Enter
```

### 5. Notify User

Tell user briefly that the review was delegated to Codex.

### 6. Wait for Codex (Background Polling)

Start a background polling loop to wait for Codex to complete. Run this EXACT bash command (with `$AGENT_COLLAB_DIR/status`) using the Bash tool with `run_in_background: true`:

```bash
while [ "$(cat "$AGENT_COLLAB_DIR/status")" != "done" ]; do sleep 3; done; echo "CODEX_COMPLETE"
```

CRITICAL: Use the resolved `$AGENT_COLLAB_DIR/status` path so polling works outside the project root. Use background execution so you can continue helping the user while waiting.

### 7. Auto-Read Response

When the background poll completes (returns "CODEX_COMPLETE"), automatically:
1. Read `$AGENT_COLLAB_DIR/responses/response.md`
2. Present findings to user with clear formatting
3. Reset `$AGENT_COLLAB_DIR/status` to `idle`

This should happen seamlessly - user sees the delegation message, then later sees the results appear automatically.
