---
name: chatgpt-code-review
description: Review code using GPT-5.2 Pro via Claude Code's Chrome integration. Use when the user asks to review code with ChatGPT, use their ChatGPT Pro subscription, get GPT-5.2 Pro to review code, or wants a second opinion from GPT. Requires Claude Code running with --chrome flag and user logged into chat.com. Triggers on "review with ChatGPT", "ChatGPT Pro review", "GPT-5.2 Pro code review", "get GPT's opinion".
---

# ChatGPT Code Review via Chrome

Review code using GPT-5.2 Pro through Claude Code's Chrome browser integration.

---

## MANDATORY: Single Message with Complete Code

**STOP. READ THESE RULES BEFORE PROCEEDING.**

### Rule 1: ONE MESSAGE ONLY

Send exactly ONE message to ChatGPT containing BOTH the context AND the complete code.

```
❌ WRONG: Message 1: "Here's the problem..." → Message 2: "Here's the code..."
✅ CORRECT: Single message: "Here's the problem... [COMPLETE CODE HERE]"
```

### Rule 2: SEND THE ACTUAL CODE

Send the COMPLETE, VERBATIM source code. Do NOT:
- Summarize the code
- Send "key sections" or excerpts
- Pre-analyze or describe what the code does
- Send pseudo-code or simplified versions
- Truncate large files

```
❌ WRONG: "The SA validity check (line 720-731) does: [description]"
❌ WRONG: "// Key perturbation loop (simplified): ..."
✅ CORRECT: [Paste the actual 3862 lines of code verbatim]
```

If the file is too large to read at once, read it in chunks and concatenate ALL chunks into the prompt.

### Rule 3: NEWLINE HANDLING

When building prompts, you MUST use `String.fromCharCode(10)` for ALL newlines.

**NEVER use `\n` in strings.** The literal characters `\n` will NOT create newlines.

```javascript
// ❌ WRONG - Creates a SINGLE LINE:
var text = 'Line 1\nLine 2\nLine 3';

// ✅ CORRECT - Use String.fromCharCode(10):
var nl = String.fromCharCode(10);
var text = 'Line 1' + nl + 'Line 2' + nl + 'Line 3';

// ✅ ALSO CORRECT - Array with join:
var nl = String.fromCharCode(10);
var text = ['Line 1', 'Line 2', 'Line 3'].join(nl);
```

**Before submitting JavaScript, verify:**
- [ ] Sending exactly ONE message (not multiple)
- [ ] Code is COMPLETE and VERBATIM (not summarized)
- [ ] `var nl = String.fromCharCode(10);` is declared at the top
- [ ] Every newline uses `+ nl +` concatenation or `.join(nl)`
- [ ] NO literal `\n` appears anywhere in the JavaScript code

---

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

**Build ONE prompt containing EVERYTHING:**
1. Brief context (what the problem is)
2. The user's question or focus area
3. The COMPLETE, VERBATIM source code in markdown code blocks

**DO NOT:**
- Split into multiple messages
- Summarize or excerpt the code
- Pre-analyze or describe the code
- Send pseudo-code instead of actual code

If reading a large file requires multiple Read calls, concatenate ALL content into a single variable before building the prompt.

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

**Use JavaScript injection to enter multi-line text. Other methods fail:**

| Method                | Works? | Notes                               |
|-----------------------|--------|-------------------------------------|
| SHIFT+ENTER           | ✅     | Too slow for long text              |
| form_input tool       | ❌     | Doesn't render in ChatGPT's React   |
| Clipboard API + paste | ❌     | Permission issues                   |
| JavaScript innerText  | ✅     | **Best solution**                   |

**JavaScript template for prompt entry:**

```javascript
// MANDATORY: Declare nl and bt at the top
var nl = String.fromCharCode(10);
var bt = String.fromCharCode(96);    // backtick

var el = document.querySelector('#prompt-textarea');

// THE COMPLETE SOURCE CODE - verbatim, NOT summarized
// If file has 3862 lines, ALL 3862 lines go here
var code = '#include <stdio.h>' + nl +
           '#include <math.h>' + nl +
           '' + nl +
           'int main() {' + nl +
           '    // ... ALL the actual code ...' + nl +
           '    return 0;' + nl +
           '}';
// ^^^ This should be the COMPLETE file contents, not excerpts!

// Build SINGLE prompt with context + FULL code
var text = [
    'You are an expert C++ performance engineer.',
    '',
    '## Problem',
    '[User\'s description of the issue]',
    '',
    '## Question',
    '[What the user wants analyzed]',
    '',
    '## Complete Source Code',
    bt+bt+bt+'cpp',
    code,   // <-- THE FULL, VERBATIM CODE
    bt+bt+bt
].join(nl);

el.innerText = text;
el.dispatchEvent(new Event('input', {bubbles: true}));
```

**Key points:**
- `var nl = String.fromCharCode(10);` MUST be first line
- `code` variable must contain the COMPLETE file, not excerpts
- Send ONE message with context + full code together
- Use `array.join(nl)` for prompt structure
- Use `+ nl +` concatenation for code content
- `dispatchEvent` with `input` event triggers React state update

**REMINDER: See "MANDATORY" section at top - ONE message, COMPLETE code, proper newlines.**

After JavaScript execution, click the send button or press ENTER to submit.

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
| **Sent multiple messages** | **WRONG. Delete chat, start over. Send ONE message with context + full code.** |
| **Code was summarized/excerpted** | **WRONG. You must send COMPLETE, VERBATIM source code. Re-read MANDATORY section.** |
| **Code appears as single line** | **YOU USED `\n` INSTEAD OF `String.fromCharCode(10)`. Rebuild with `var nl = String.fromCharCode(10);`** |
| Not logged in | Ask user to log in, retry |
| Model unavailable | Fall back to GPT-5.2 Thinking |
| Generation interrupted | New chat and resubmit |
| JavaScript selector fails | Page may have updated; inspect for new selector |
| Can't find ChatGPT tab | Ask user which tab has the response |
| Rate limited | Wait and retry |
