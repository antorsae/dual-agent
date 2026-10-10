---
name: chatgpt-code-review
description: Review code using ChatGPT via Claude Code's Chrome integration, with the model, reasoning effort, and speed from ~/.codex/config.toml. Use when the user asks to review code with ChatGPT, use their ChatGPT Pro subscription, or wants a second opinion from GPT. Requires Claude Code running with --chrome flag and user logged into chat.com. Triggers on "review with ChatGPT", "ChatGPT Pro review", "GPT code review", "get GPT's opinion".
---

# ChatGPT Code Review via Chrome

Review code using ChatGPT through Claude Code's Chrome browser integration, with the same model settings Codex uses.

---

## METHOD: JSON-ENCODED TEXT INJECTION

Inject the complete code into ChatGPT's prompt using JavaScript with JSON encoding to preserve newlines.

**The key insight:** Use `JSON.stringify()` on the file content, then `JSON.parse()` in the injected JavaScript. This correctly preserves all newlines and special characters.

---

## Prerequisites

1. Claude Code with Chrome integration: `claude --chrome`
2. Claude in Chrome extension installed (v1.0.36+)
3. User logged into chat.com in Chrome
4. A ChatGPT plan that offers the model configured in `~/.codex/config.toml`

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

### Step 3: Select the Codex Model Settings

1. Read `model`, `model_reasoning_effort`, and `service_tier` from `~/.codex/config.toml` (`$CODEX_HOME/config.toml` if set). Skip any that are unset.
2. Look up the model's `display_name` in `~/.codex/models_cache.json` (`models[].slug`). ChatGPT may show a shorter name, e.g. "Astra" for `gpt-6-astra`.
3. Open the model picker and select the model, then the reasoning level (`low` = Light, `xhigh` = Extra High, `max` = Max, `ultra` = Ultra), then the speed (`fast` = Fast, `ultrafast` = Ultrafast). If the picker only shows a Power slider, open **Advanced**.
4. If ChatGPT doesn't offer a setting, keep its current value and tell the user which settings were used.

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

> "Submitted to ChatGPT (<model>, <reasoning>). High-effort reviews can take 5-30 minutes.
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
| Configured model or setting not offered | Keep ChatGPT's current choice and tell the user what was used |

---

## Non-Blocking Workflow

High-effort reasoning can take 5-30+ minutes. Submit and return immediately. Fetch results when user asks.
