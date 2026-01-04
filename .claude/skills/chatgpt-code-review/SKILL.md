---
name: chatgpt-code-review
description: Review code using GPT-5.2 Pro via Claude Code's Chrome integration. Use when the user asks to review code with ChatGPT, use their ChatGPT Pro subscription, get GPT-5.2 Pro to review code, or wants a second opinion from GPT. Requires Claude Code running with --chrome flag and user logged into chat.com. Triggers on "review with ChatGPT", "ChatGPT Pro review", "GPT-5.2 Pro code review", "get GPT's opinion".
---

# ChatGPT Code Review via Chrome

Review code using GPT-5.2 Pro through Claude Code's Chrome browser integration.

---

## METHOD: FILE UPLOAD (NOT TEXT INJECTION)

**Upload files directly to ChatGPT. Do NOT paste code into the prompt.**

**LIMITATION: Claude cannot interact with native OS file dialogs.** The file picker that opens when clicking "Add files" is an OS-level dialog.

**Workflow:**
1. Claude navigates to ChatGPT and selects GPT-5.2 Pro
2. Claude tells user the file path to upload
3. **User manually uploads the file** (drag-drop or CMD+U)
4. Claude enters the prompt text
5. Submit

This avoids all newline/escaping issues by keeping code in the uploaded file.

---

## Prerequisites

1. Claude Code with Chrome integration: `claude --chrome`
2. Claude in Chrome extension installed (v1.0.36+)
3. User logged into chat.com in Chrome
4. ChatGPT Pro subscription (for GPT-5.2 Pro access)

---

## Workflow

### Step 1: Navigate to ChatGPT

1. Navigate to `https://chat.com`
2. Wait for page load
3. Verify logged in (chat interface visible)

### Step 2: Select GPT-5.2 Pro

1. Click model selector dropdown
2. Select **"GPT-5.2 Pro"** (or "Pro" option)
3. Accept any warnings about extended thinking time

### Step 3: Upload the File(s) - REQUIRES USER ACTION

**Claude cannot interact with native OS file dialogs. The user must upload the file manually.**

1. Tell the user: "Please upload the file manually. I'll provide the prompt."
2. Provide the full file path for the user to upload:
   ```
   File to upload: /path/to/mandelbrot.cpp
   ```
3. Wait for user confirmation that the file is uploaded
4. OR: Ask user to drag-drop the file onto the ChatGPT input area

**Alternative - Check if file is already attached:**
- Look for file attachment indicators in the chat input area
- If user says "file uploaded" or "ready", proceed to Step 4

### Step 4: Type the Prompt

Type your question/context in the prompt field. Reference the uploaded file by name:

```
Analyze the uploaded mandelbrot.cpp for performance optimization opportunities.

Context:
- Current render time: ~22 seconds for 1200x800 at zoom 1.2e18
- All optimizations (SA, BLA, block, cache) show minimal speedup
- Need 10-20x improvement

Focus on:
1. Why is SA showing 0% skip rate?
2. Bottlenecks in the perturbation loop
3. Specific code changes for 10-20x speedup
```

**The prompt is just context/questions. The code is in the uploaded file.**

### Step 5: Submit and Return

1. Click send button or press ENTER
2. Verify message was sent (appears in chat with file attachment)
3. **Do NOT wait for completion** - GPT-5.2 Pro takes 5-30+ minutes
4. Return to user:

> "Submitted to GPT-5.2 Pro with mandelbrot.cpp attached. This typically takes 5-30 minutes.
> You can continue working — just ask me to 'fetch ChatGPT results' when ready."

### Step 6: Fetch Results (on user request)

When user asks to fetch/check results:

1. Navigate to the ChatGPT tab
2. Check if generation is complete (no spinner, no "Stop generating" button)
3. If still generating: report status
4. If complete: extract and return the response

---

## Multiple Files

To upload multiple files:

1. Press CMD+U
2. Select multiple files (CMD+click or SHIFT+click)
3. Or repeat the upload process for each file

Reference all files in your prompt:
```
Analyze the uploaded files:
- mandelbrot.cpp (main renderer)
- simd_utils.h (SIMD helpers)
- Makefile (build config)
```

---

## Error Recovery

| Issue | Action |
|-------|--------|
| File upload not working | Try CMD+U instead of clicking (+) |
| File too large | ChatGPT accepts files up to 512MB - this should not happen |
| Not logged in | Ask user to log in, retry |
| Model unavailable | Fall back to GPT-5.2 Thinking |
| Can't find ChatGPT tab | Ask user which tab has the response |

---

## Non-Blocking Workflow

**GPT-5.2 Pro can take 5-30+ minutes. Use a submit-then-fetch pattern:**

1. **Submit**: Upload file, enter prompt, submit, return immediately
2. **Fetch**: When user asks, check if complete and retrieve response

Do NOT block waiting for GPT to finish.
