---
name: chatgpt-pro-worker
description: Delegate arbitrary implementation, debugging, refactoring, planning, review, or custom coding tasks to ChatGPT GPT-5.5 Pro through the chatgpt-pro-worker MCP server. Use when the user asks to use ChatGPT Pro, GPT-5.5 Pro, or a Pro subagent/worker for a task.
---

# ChatGPT Pro Worker

Use ChatGPT GPT-5.5 Pro as an external coding worker through the `chatgpt-pro-worker` MCP server.

This skill is for arbitrary tasks, not only review. It can be used for implementation, debugging, refactoring, planning, analysis, and custom work.

## Requirements

- The `chatgpt-pro-worker` MCP server is installed in Codex.
- The user has a ChatGPT Pro subscription.
- The Playwright Chromium profile is logged into ChatGPT Pro.

If login state is unknown, call `login_status` first. If not logged in, call `open_pro_login` and tell the user to complete one-time login in the persistent Chromium profile.

## Workflow

### 1. Determine Task Type

Classify the user request:

- `implement`: create or change code
- `debug`: diagnose and fix an observed failure
- `refactor`: rewrite code while preserving behavior
- `plan`: produce an implementation plan
- `review`: inspect code or a plan
- `research`: answer with external knowledge or product behavior
- `custom`: anything else

For `implement`, `debug`, and `refactor`, prefer `expected_output = unified_diff`.

### 2. Gather Context

Prepare compact but sufficient context:

- User request and acceptance criteria
- Relevant file paths and excerpts
- Current diff, if applicable
- Failing command output or logs, if debugging
- Project conventions and constraints
- Tests to run after applying changes
- Assumptions and missing context

Do not paste the entire repository unless the user explicitly asks. Include enough context for GPT-5.5 Pro to produce a useful result.

### 3. Submit To ChatGPT Pro

Call the MCP tool `submit_pro_task` with:

- `task`: a precise, standalone task
- `context`: the gathered repo context
- `task_type`: one of the task types above
- `expected_output`: `unified_diff` for implementation-like tasks
- `model`: `GPT-5.5 Pro`
- `automate`: `true`
- `wait`: `true` unless the user wants to continue while Pro works

The tool will create a job, automate ChatGPT through Playwright Chromium, and save the response.

Tell the user:

- The job id
- Whether the task completed or is still running
- Where screenshots/results were saved if automation fails

### 4. Save Result

For automated tasks, call `get_pro_task` or `await_pro_task` to read the saved result.

If automation fails and the user completes the task manually in ChatGPT, call `save_pro_result` with the job id and full response.

### 5. Apply Or Integrate

For implementation-like tasks:

1. Inspect the Pro result.
2. If it contains a unified diff, apply it carefully.
3. If it contains file replacements, edit the files manually.
4. Run relevant tests or build commands.
5. Fix integration issues locally.
6. Report the final local changes and verification.

Do not claim the task is done just because GPT-5.5 Pro returned a patch. The work is done only after Codex applies and verifies it locally.

For non-implementation tasks, summarize or integrate the result into the current answer.

## Prompt Shape

The MCP server wraps the task with instructions for GPT-5.5 Pro to act as an external senior coding worker. For implementation-like tasks, it asks for:

1. Short implementation summary
2. Apply-ready unified diff
3. Test commands
4. Assumptions or missing context

## Safety Notes

- Do not store ChatGPT credentials.
- Do not bypass login, CAPTCHA, passkey, 2FA, or account checks.
- Use the persistent Chromium profile for session state; do not copy secrets into prompts.
- If the Pro response is unsafe, incomplete, or inconsistent with the repo, do not apply it blindly.
