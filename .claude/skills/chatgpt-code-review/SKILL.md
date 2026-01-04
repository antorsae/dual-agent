---
name: chatgpt-code-review
description: Review code using GPT-5.2 Pro via Claude Code's Chrome integration. Use when the user asks to review code with ChatGPT, use their ChatGPT Pro subscription, get GPT-5.2 Pro to review code, or wants a second opinion from GPT. Requires Claude Code running with --chrome flag and user logged into chat.com. Triggers on "review with ChatGPT", "ChatGPT Pro review", "GPT-5.2 Pro code review", "get GPT's opinion".
---

# ChatGPT Code Review via Chrome

Review code using GPT-5.2 Pro through Claude Code's Chrome browser integration.

## Prerequisites

1. Claude Code with Chrome integration: `claude --chrome`
2. Claude in Chrome extension installed (v1.0.36+)
3. User logged into chat.com in Chrome
4. ChatGPT Pro subscription (for GPT-5.2 Pro access)

Verify Chrome connection: run `/chrome` in Claude Code.

## Context Window

**GPT-5.2 has a 200k token input context.** Maximize content usage:
- Include full source files, not snippets
- Add relevant context files (tests, configs, dependencies)
- Include documentation or comments that provide context
- Send entire classes/modules rather than isolated functions

Do not truncate or summarize code unnecessarily — use the full context capacity.

## Non-Blocking Workflow

**GPT-5.2 Pro can take 5-30+ minutes. Use a submit-then-fetch pattern to avoid blocking Claude CLI.**

### Phase 1: Submit (non-blocking)

1. Navigate to chat.com
2. Start new chat, select GPT-5.2 Pro
3. Enter and submit the prompt
4. **Immediately return control to user**
5. Tell user: "Submitted to GPT-5.2 Pro. Check the browser tab or ask me to 'fetch ChatGPT results' when ready."

### Phase 2: Fetch (on user request)

When user says "fetch ChatGPT results", "get the ChatGPT response", "check if ChatGPT is done", etc.:

1. Navigate to the ChatGPT tab
2. Check if generation is complete (no spinner, no "Stop generating" button)
3. If complete: extract and return the response
4. If still generating: report status and estimated progress if visible

## Workflow Details

### Step 1: Prepare the Review Prompt

Build the prompt text with these components:
- System instruction for code review
- Focus area (security/performance/bugs/general)
- The code wrapped in markdown code blocks
- Language identifier if known

### Step 2: Navigate to ChatGPT

1. Navigate to `https://chat.com`
2. Wait for page load
3. Verify logged in (chat interface visible, not login form)

If login required, ask user to authenticate manually, then continue.

### Step 3: Start New Chat & Select GPT-5.2 Pro

1. Click "New chat" button
2. Locate model selector dropdown
3. Select **"GPT-5.2 Pro"** (or "Pro" under GPT-5.2 options)
4. Accept any warnings about extended thinking time

### Step 4: Enter the Prompt via JavaScript

**CRITICAL: Use JavaScript injection to enter multi-line text. Other methods fail:**

| Method                | Works? | Notes                               |
|-----------------------|--------|-------------------------------------|
| SHIFT+ENTER           | ✅     | Too slow for long text              |
| form_input tool       | ❌     | Doesn't render in ChatGPT's React   |
| Clipboard API + paste | ❌     | Permission issues                   |
| JavaScript innerText  | ✅     | **Best solution**                   |

**JavaScript template for prompt entry:**

```javascript
var el = document.querySelector('#prompt-textarea');
var nl = String.fromCharCode(10);    // newline
var bt = String.fromCharCode(96);    // backtick

// Code can be multi-line - newlines within strings are preserved
var code = 'line1' + nl + 'line2' + nl + 'line3';

var text = [
    'You are an expert code reviewer. Provide a thorough review.',
    '',
    'Structure your review as:',
    '1. **Summary**: Brief overall assessment',
    '2. **Critical Issues**: Bugs, security vulnerabilities, logic errors', 
    '3. **Improvements**: Suggestions for better practices',
    '4. **Positive Aspects**: What is done well',
    '',
    '[FOCUS_INSTRUCTION]',
    '',
    'Code to review:',
    bt+bt+bt+'[LANGUAGE]',
    code,   // multi-line content - newlines preserved
    bt+bt+bt
].join(nl);

el.innerText = text;
el.dispatchEvent(new Event('input', {bubbles: true}));
```

**Key points:**
- `String.fromCharCode(10)` for newlines (avoids escaping issues)
- `String.fromCharCode(96)` for backticks
- `dispatchEvent` with `input` event triggers React state update
- Selector is `#prompt-textarea`
- **Newlines within strings are preserved** — no need to split into separate array elements

After JavaScript execution, click the send button or press ENTER to submit.

### CRITICAL: Use Actual Newline Characters

**The most common mistake is using literal `\n` (two characters: backslash + n) instead of actual newline characters (char code 10).**

❌ **WRONG** — literal backslash-n (will appear as single line):
```javascript
var code = 'line1\\nline2\\nline3';
```

✅ **CORRECT** — actual newline characters:
```javascript
var nl = String.fromCharCode(10);
var code = 'line1' + nl + 'line2' + nl + 'line3';
```

✅ **ALSO CORRECT** — template literal with real line breaks:
```javascript
var code = `line1
line2
line3`;
```

### Step 5: Submit and Return Immediately

1. Click send or press ENTER to submit the prompt
2. Verify the message was sent (appears in chat)
3. **Do NOT wait for completion**
4. Return to user with message:

> "Submitted your code review request to GPT-5.2 Pro. This typically takes 5-30 minutes. 
> You can continue working — just ask me to 'fetch ChatGPT results' when you want to check."

### Step 6: Fetch Results (when user requests)

When user asks to fetch/check results:

1. Navigate to the ChatGPT tab (or find it if multiple tabs)
2. Check completion status:
   - Look for spinning/thinking indicator
   - Check for "Stop generating" button presence
   - Check if response text is fully rendered

3. If **still generating**:
   > "GPT-5.2 Pro is still thinking. Check back in a few minutes."

4. If **complete**:
   - Extract the full response text from the assistant message
   - Return to user in Claude CLI

## Focus Instructions

Insert the appropriate line based on user's requested focus:
- **general**: "Cover correctness, readability, maintainability, and best practices."
- **security**: "Focus on security vulnerabilities, injection risks, auth issues, data handling."
- **performance**: "Focus on bottlenecks, algorithmic efficiency, memory usage."
- **bugs**: "Focus on potential bugs, edge cases, error handling, logic errors."

## Escaping Source Code

When embedding source code, **escape special characters**:

| Character | Escape as |
|-----------|-----------|
| `\`       | `\\`      |
| `'`       | `\'`      |
| `` ` ``   | Use `String.fromCharCode(96)` or `\`` |

## Error Recovery

| Issue | Action |
|-------|--------|
| Not logged in | Ask user to log in, retry |
| Model unavailable | Fall back to GPT-5.2 Thinking |
| Generation interrupted | New chat and resubmit |
| JavaScript selector fails | Page may have updated; inspect for new selector |
| Code appears as single line | Newlines are literal `\n` not char code 10; use `String.fromCharCode(10)` |
| Can't find ChatGPT tab | Ask user which tab has the response |
| Rate limited | Wait and retry |
