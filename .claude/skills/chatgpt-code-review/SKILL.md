---
name: chatgpt-code-review
description: Review code using GPT-5.2 Pro via Claude Code's Chrome integration. Use when the user asks to review code with ChatGPT, use their ChatGPT Pro subscription, get GPT-5.2 Pro to review code, or wants a second opinion from GPT. Requires Claude Code running with --chrome flag and user logged into chat.com. Triggers on "review with ChatGPT", "ChatGPT Pro review", "GPT-5.2 Pro code review", "get GPT's opinion".
---

# ChatGPT Code Review via Chrome

Review code using GPT-5.2 Pro through Claude Code's Chrome browser integration.

---

## METHOD: JSON-ENCODED TEXT INJECTION

Inject the complete code into ChatGPT's prompt using JavaScript with JSON encoding to preserve newlines.

**The key insight:** Use `JSON.stringify()` on the file content, then `JSON.parse()` in the injected JavaScript. This correctly preserves all newlines and special characters.

---

## Prerequisites

1. Claude Code with Chrome integration: `claude --chrome`
2. Claude in Chrome extension installed (v1.0.36+)
3. User logged into chat.com in Chrome
4. ChatGPT Pro subscription (for GPT-5.2 Pro access)

---

## Workflow

### Step 1: Read the Complete File

Read the ENTIRE file. If too large for one read, read in chunks and concatenate.

```
content = Read(file.cpp)  // Get ALL content
```

### Step 2: Navigate to ChatGPT

1. Navigate to `https://chat.com`
2. Wait for page load
3. Verify logged in

### Step 3: Select GPT-5.2 Pro

1. Click model selector dropdown
2. Select **"GPT-5.2 Pro"**

### Step 4: Build and Execute JavaScript

**USE THIS EXACT ALGORITHM:**

```python
import json

def build_javascript(file_content: str, context: str) -> str:
    """
    Build JavaScript that injects the prompt into ChatGPT.
    Uses JSON encoding to preserve ALL newlines and special characters.
    """
    # Combine context and code into one prompt
    full_prompt = f"""{context}

Complete source code:
```
{file_content}
```"""

    # JSON.stringify handles ALL escaping correctly
    json_encoded = json.dumps(full_prompt)

    # Build JavaScript that parses the JSON to get the string with real newlines
    javascript = f"""var el = document.querySelector('#prompt-textarea');
var text = JSON.parse({json_encoded});
el.innerText = text;
el.dispatchEvent(new Event('input', {{bubbles: true}}));"""

    return javascript
```

**Example output:**
```javascript
var el = document.querySelector('#prompt-textarea');
var text = JSON.parse("Analyze this code:\\n\\n```\\n#include <stdio.h>\\nint main() {\\n    return 0;\\n}\\n```");
el.innerText = text;
el.dispatchEvent(new Event('input', {bubbles: true}));
```

The `\n` inside the JSON string is correct - `JSON.parse()` converts them to real newlines.

### Step 5: Submit

1. Click send button or press ENTER
2. Verify message was sent
3. Return immediately - do NOT wait for completion

> "Submitted to GPT-5.2 Pro. This typically takes 5-30 minutes.
> Ask me to 'fetch ChatGPT results' when ready."

### Step 6: Fetch Results (on user request)

1. Navigate to ChatGPT tab
2. Check if complete (no spinner)
3. Extract and return response

---

## Error Recovery

| Issue | Action |
|-------|--------|
| Code appears as single line | You did NOT use JSON.parse(). Re-read Step 4. |
| Not logged in | Ask user to log in |
| Model unavailable | Fall back to GPT-5.2 Thinking |

---

## Non-Blocking Workflow

GPT-5.2 Pro takes 5-30+ minutes. Submit and return immediately. Fetch results when user asks.
