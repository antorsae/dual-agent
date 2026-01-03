# Dual Agent Development Environment

A collaborative development environment that pairs **Claude Code** (Anthropic) with **Codex CLI** (OpenAI) in a split tmux session, enabling you to leverage the strengths of both AI models.

## Why Two Agents?

| Claude Code (Primary) | Codex CLI (Secondary) |
|-----------------------|----------------------|
| Fast iteration & prototyping | Deep, thorough code review |
| Planning & orchestration | Complex algorithm implementation |
| Quick fixes & refactoring | Security vulnerability analysis |
| Context switching & multitasking | Meticulous edge case handling |

By combining both, you get rapid development velocity with rigorous quality checks.

## Prerequisites

- [tmux](https://github.com/tmux/tmux) - Terminal multiplexer
- [Claude Code](https://github.com/anthropics/claude-code) - Anthropic's CLI
- [Codex CLI](https://github.com/openai/codex) - OpenAI's CLI
- [jq](https://stedolan.github.io/jq/) - JSON processor

```bash
# macOS
brew install tmux jq

# Claude Code & Codex CLI - follow their respective installation guides
```

## Installation

```bash
git clone https://github.com/antorsae/dual-agent.git
cd dual-agent
./setup-dual-agent.sh
```

This will:
- Install Claude skills to `~/.claude/skills/`
- Install Codex skills to `~/.codex/skills/`
- Configure Claude Code permissions for seamless collaboration
- Initialize the `.agent-collab/` directory for inter-agent communication

## Usage

```bash
# Start the dual-agent environment
./start-dual-agent.sh

# Or with custom session name and project directory
./start-dual-agent.sh my-session /path/to/project
```

### Tmux Key Bindings

| Keys | Action |
|------|--------|
| `Ctrl-b ←/→` | Switch between Claude and Codex panes |
| `Ctrl-b d` | Detach from session |
| `Ctrl-b z` | Zoom current pane (fullscreen toggle) |

### Claude Skills (Left Pane)

| Skill | Purpose |
|-------|---------|
| `/codex-review` | Send code to Codex for deep review |
| `/codex-implement` | Delegate complex implementation to Codex |
| `/codex-plan-review` | Get Codex's critique on your plan |
| `/codex-read` | Read Codex's response |
| `/codex-status` | Check collaboration status |

### Codex Skills (Right Pane)

| Skill | Purpose |
|-------|---------|
| `/read-task` | Pick up task from Claude |
| `/respond` | Manually send response to Claude |
| `/claude-status` | Check collaboration status |

---

## Detailed Execution Example

### Scenario: Implementing a Rate Limiter with Security Review

You need to implement a production-grade distributed rate limiter. This is a perfect use case for dual-agent collaboration because:

1. **Claude** can quickly scaffold the implementation and orchestrate the workflow
2. **Codex** can perform deep security analysis and catch edge cases

### Step 1: Start the Environment

```bash
cd your-project
./start-dual-agent.sh
```

You now see two panes: Claude (left) and Codex (right).

### Step 2: Describe the Task to Claude

In the Claude pane:

```
You: I need to implement a token bucket rate limiter that:
- Supports distributed systems (Redis-backed)
- Has per-user and global limits
- Handles clock skew gracefully
- Is resistant to race conditions
```

Claude responds and starts planning:

```
Claude: I'll help you implement a distributed rate limiter. Let me create a plan:

1. Design the token bucket algorithm with Redis
2. Implement atomic operations to prevent race conditions
3. Add per-user and global limit tiers
4. Handle clock synchronization issues

Let me start with the implementation...

[Claude writes rate_limiter.py]

I've implemented the rate limiter. Since this is security-critical code
handling distributed state, I'm delegating to Codex for a thorough review.

Delegating to Codex for deep code review...
Task sent. I'll present the findings when ready.
```

### Step 3: Automatic Codex Review

Behind the scenes:
1. Claude writes the task to `.agent-collab/requests/task.md`
2. Claude triggers Codex via tmux
3. Codex picks up the task with `/read-task`
4. Codex performs deep analysis

In the Codex pane, you see:

```
Codex: Reading task from Claude...

Task Type: CODE_REVIEW
Analyzing rate_limiter.py for:
- Race conditions in distributed operations
- Security vulnerabilities
- Edge cases and failure modes

[Codex performs thorough line-by-line analysis]

Writing response...
Response ready. Claude can retrieve it with /codex-read.
```

### Step 4: Claude Presents Findings

Claude automatically retrieves and presents the review:

````text
Claude: Codex completed the review. Here are the findings:

## Critical Issues

1. **Race Condition in Token Refill** (Line 45-52)
   The current implementation has a TOCTOU vulnerability:
   ```python
   # Current (vulnerable)
   tokens = redis.get(key)
   if tokens < max_tokens:
       redis.set(key, tokens + refill_rate)
   ```

   **Fix:** Use Redis WATCH/MULTI/EXEC or Lua scripting:
   ```python
   lua_script = """
   local tokens = tonumber(redis.call('GET', KEYS[1]) or 0)
   local max = tonumber(ARGV[1])
   local refill = tonumber(ARGV[2])
   if tokens < max then
       tokens = math.min(tokens + refill, max)
       redis.call('SET', KEYS[1], tokens)
   end
   return tokens
   """
   ```

2. **Clock Skew Not Handled** (Line 78)
   Using `time.time()` without NTP consideration can cause
   token leakage across nodes.

   **Fix:** Use Redis TIME command for consistent timestamps.

## Security Concerns

1. Key enumeration possible if user IDs are sequential
2. No protection against Redis connection exhaustion

## Recommendations

1. Implement exponential backoff for Redis reconnection
2. Add metrics/alerting for rate limit violations
3. Consider sliding window for smoother limiting

Shall I apply these fixes?
````

### Step 5: Claude Applies Fixes

```
You: Yes, apply all the fixes

Claude: Applying Codex's recommendations...

[Claude edits rate_limiter.py with the Lua script approach]
[Claude adds Redis TIME-based timestamps]
[Claude implements connection pooling with backoff]

Done. The rate limiter now:
✓ Uses atomic Lua operations (no race conditions)
✓ Uses Redis server time (clock skew resistant)
✓ Has connection resilience with exponential backoff

Would you like me to send the updated code for another review pass?
```

---

## Architecture

```
┌───────────────────┬───────────────────┐
│    Claude Code    │     Codex CLI     │
│  (Primary Agent)  │ (Secondary Agent) │
├───────────────────┼───────────────────┤
│ • Orchestrates    │ • Deep analysis   │
│ • Plans           │ • Security review │
│ • Quick tasks     │ • Complex impl    │
│ • Delegates       │ • Edge cases      │
└─────────┬─────────┴─────────┬─────────┘
          │                   │
          │  .agent-collab/   │
          │ ┌───────────────┐ │
          └►│ status        │◄┘
            │ requests/     │
            │ responses/    │
            │ context/      │
            └───────────────┘
```

### Communication Protocol

1. **Claude** writes task to `requests/task.md`
2. **Claude** sets `status` to `pending`
3. **Claude** triggers Codex via tmux
4. **Codex** sets `status` to `working`
5. **Codex** completes task, writes to `responses/response.md`
6. **Codex** sets `status` to `done`
7. **Claude** reads response and presents to user
8. **Claude** resets `status` to `idle`

## Configuration

### Shared Context

Edit `.agent-collab/context/shared.md` to provide both agents with project context:

```markdown
# Shared Project Context

## Project Overview
E-commerce platform using FastAPI + Redis + PostgreSQL

## Architecture Decisions
- All auth uses JWT with refresh rotation
- Redis for rate limiting and session storage
- PostgreSQL for persistent data

## Conventions
- Type hints required on all functions
- Pydantic models for all API schemas
- pytest for testing

## Current Focus
Implementing authentication system
```

### Proactive Reviews

By default, Claude will automatically delegate to Codex for review after significant implementations. To disable this, edit the skill description in `~/.claude/skills/codex-review/SKILL.md`.

## Troubleshooting

### Codex not receiving tasks

1. Check tmux pane numbers: `tmux list-panes`
2. Ensure Codex is running in pane 1
3. Manually trigger: `tmux send-keys -t 1 '/read-task' Enter`

### Permission prompts appearing

Re-run setup to ensure permissions are configured:
```bash
./setup-dual-agent.sh
```

### Status stuck

Reset manually:
```bash
echo "idle" > .agent-collab/status
```

## License

MIT
