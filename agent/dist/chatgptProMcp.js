#!/usr/bin/env node
/**
 * MCP Server for ChatGPT Pro browser handoff.
 *
 * It supports two modes:
 * - automated Playwright browser control using a persistent ChatGPT profile
 * - manual fallback that prepares a durable prompt and opens/copies it
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";
const DEFAULT_MODEL = "GPT-5.5 Pro";
const DEFAULT_TASK_DIR = process.env.CHATGPT_PRO_TASK_DIR ||
    join(homedir(), ".codex", "chatgpt-pro-worker");
const DEFAULT_BROWSER_PROFILE_DIR = process.env.CHATGPT_PRO_BROWSER_PROFILE ||
    join(DEFAULT_TASK_DIR, "browser-profile");
const CHATGPT_URL = process.env.CHATGPT_PRO_URL || "https://chatgpt.com/";
const DEFAULT_AUTOMATION_TIMEOUT_MS = parseInt(process.env.CHATGPT_PRO_TIMEOUT_MS || String(30 * 60 * 1000), 10);
let interactiveLoginContext = null;
const server = new Server({
    name: "chatgpt-pro-worker",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
const TOOLS = [
    {
        name: "login_status",
        description: "Check whether the persistent Playwright browser profile appears logged in to ChatGPT.",
        inputSchema: {
            type: "object",
            properties: {
                headless: {
                    type: "boolean",
                    description: "Run the browser headless. Default: true on Linux without DISPLAY, false otherwise.",
                },
            },
        },
    },
    {
        name: "open_pro_login",
        description: "Open ChatGPT in the persistent browser profile for one-time login. Requires a local display or remote GUI/VNC session.",
        inputSchema: {
            type: "object",
            properties: {
                headless: {
                    type: "boolean",
                    description: "Run headless. Use false for interactive login. Default: false.",
                },
            },
        },
    },
    {
        name: "submit_pro_task",
        description: "Prepare or run an arbitrary coding task with ChatGPT GPT-5.5 Pro. In automated mode, submits through Playwright and saves the response.",
        inputSchema: {
            type: "object",
            properties: {
                task: {
                    type: "string",
                    description: "The full task for ChatGPT Pro to perform.",
                },
                context: {
                    type: "string",
                    description: "Relevant repo context, diffs, file excerpts, logs, constraints, and assumptions.",
                },
                task_type: {
                    type: "string",
                    description: "Task type such as implement, debug, refactor, plan, review, research, or custom.",
                },
                expected_output: {
                    type: "string",
                    description: "Desired output contract: unified_diff, files, commands, plan, analysis, or custom.",
                },
                title: {
                    type: "string",
                    description: "Short title for the task.",
                },
                model: {
                    type: "string",
                    description: "ChatGPT model to ask the user to select. Default: GPT-5.5 Pro.",
                },
                open_browser: {
                    type: "boolean",
                    description: "Open ChatGPT in the default browser. Default: true.",
                },
                copy_to_clipboard: {
                    type: "boolean",
                    description: "Copy the prepared prompt to the system clipboard. Default: true.",
                },
                automate: {
                    type: "boolean",
                    description: "Use Playwright to submit to ChatGPT and capture the response. Default: true.",
                },
                wait: {
                    type: "boolean",
                    description: "When automate is true, wait for the response before returning. Default: true.",
                },
                headless: {
                    type: "boolean",
                    description: "Run the browser headless. Default: true on Linux without DISPLAY, false otherwise.",
                },
                timeout_ms: {
                    type: "number",
                    description: "Maximum time to wait for ChatGPT response.",
                },
            },
            required: ["task"],
        },
    },
    {
        name: "await_pro_task",
        description: "Wait for an automated ChatGPT Pro job to finish and return the saved result.",
        inputSchema: {
            type: "object",
            properties: {
                job_id: {
                    type: "string",
                    description: "Job id returned by submit_pro_task.",
                },
                timeout_ms: {
                    type: "number",
                    description: "Maximum time to wait.",
                },
            },
            required: ["job_id"],
        },
    },
    {
        name: "save_pro_result",
        description: "Save a ChatGPT Pro response for a submitted job so Codex can apply or summarize it.",
        inputSchema: {
            type: "object",
            properties: {
                job_id: {
                    type: "string",
                    description: "Job id returned by submit_pro_task.",
                },
                response: {
                    type: "string",
                    description: "The complete response copied from ChatGPT Pro.",
                },
            },
            required: ["job_id", "response"],
        },
    },
    {
        name: "get_pro_task",
        description: "Get status, prompt path, and saved result for a ChatGPT Pro job.",
        inputSchema: {
            type: "object",
            properties: {
                job_id: {
                    type: "string",
                    description: "Job id returned by submit_pro_task.",
                },
            },
            required: ["job_id"],
        },
    },
    {
        name: "show_pro_prompt",
        description: "Return the prepared prompt for a ChatGPT Pro job.",
        inputSchema: {
            type: "object",
            properties: {
                job_id: {
                    type: "string",
                    description: "Job id returned by submit_pro_task.",
                },
            },
            required: ["job_id"],
        },
    },
    {
        name: "list_pro_tasks",
        description: "List recent ChatGPT Pro jobs.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
];
function argString(args, key, fallback = "") {
    const value = args[key];
    return typeof value === "string" ? value.trim() : fallback;
}
function argBool(args, key, fallback) {
    const value = args[key];
    return typeof value === "boolean" ? value : fallback;
}
function argNumber(args, key, fallback) {
    const value = args[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function defaultHeadless() {
    if (process.env.CHATGPT_PRO_HEADLESS) {
        return ["1", "true", "yes", "on"].includes(process.env.CHATGPT_PRO_HEADLESS.toLowerCase());
    }
    if (platform() === "linux") {
        return !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
    }
    return false;
}
async function ensureTaskDir() {
    await mkdir(DEFAULT_TASK_DIR, { recursive: true });
}
async function ensureBrowserProfileDir() {
    await mkdir(DEFAULT_BROWSER_PROFILE_DIR, { recursive: true });
}
function jobDir(jobId) {
    return join(DEFAULT_TASK_DIR, jobId);
}
function metaPath(jobId) {
    return join(jobDir(jobId), "meta.json");
}
async function readMeta(jobId) {
    const raw = await readFile(metaPath(jobId), "utf-8");
    return JSON.parse(raw);
}
async function writeMeta(meta) {
    await writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2) + "\n");
}
function canOpenInteractiveBrowser() {
    if (platform() !== "linux")
        return true;
    return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
function outputContract(expectedOutput) {
    switch (expectedOutput.toLowerCase()) {
        case "unified_diff":
            return `Return:
1. A short implementation summary.
2. A unified diff that can be applied with git apply.
3. Test commands to run.
4. Any assumptions or missing context.

If you cannot produce a safe patch from the provided context, say exactly what context is missing.`;
        case "files":
            return `Return complete file contents for each file that should be created or replaced, with paths and integration notes.`;
        case "commands":
            return `Return exact shell commands, expected outputs, and rollback notes.`;
        case "plan":
            return `Return a concise implementation plan with risks, file touch points, and validation steps.`;
        case "analysis":
            return `Return a structured analysis with findings ordered by severity or importance.`;
        default:
            return `Return the most useful output for the requested task. Be explicit about assumptions and missing context.`;
    }
}
function buildPrompt(params) {
    return `You are ${params.model}, acting as an external senior coding worker for Codex.

Task type: ${params.taskType}
Expected output: ${params.expectedOutput}

Operating rules:
- Work only from the context provided below.
- Prefer concrete patches, commands, and exact file paths over abstract advice.
- Do not claim you ran tests or inspected files unless that evidence is included.
- If the task asks for implementation, produce an apply-ready patch when possible.
- Keep non-essential explanation brief.

Output contract:
${outputContract(params.expectedOutput)}

User task:
${params.task}

Context from Codex:
${params.context || "(No additional context provided.)"}
`;
}
async function spawnWithInput(command, args, input) {
    return new Promise((resolve) => {
        const proc = spawn(command, args, {
            stdio: ["pipe", "ignore", "pipe"],
        });
        let stderr = "";
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        proc.on("error", (err) => {
            resolve(err.message);
        });
        proc.on("close", (code) => {
            resolve(code === 0 ? "ok" : stderr.trim() || `exit code ${code}`);
        });
        proc.stdin.end(input);
    });
}
async function copyToClipboard(text) {
    const os = platform();
    if (os === "darwin") {
        return spawnWithInput("pbcopy", [], text);
    }
    if (os === "win32") {
        return spawnWithInput("cmd", ["/c", "clip"], text);
    }
    const attempts = [
        ["wl-copy", []],
        ["xclip", ["-selection", "clipboard"]],
        ["xsel", ["--clipboard", "--input"]],
    ];
    for (const [command, args] of attempts) {
        const status = await spawnWithInput(command, args, text);
        if (status === "ok") {
            return "ok";
        }
    }
    return "clipboard unavailable: install wl-clipboard, xclip, or xsel";
}
function openBrowser() {
    const os = platform();
    let command;
    let args;
    if (os === "darwin") {
        command = "open";
        args = [CHATGPT_URL];
    }
    else if (os === "win32") {
        command = "cmd";
        args = ["/c", "start", "", CHATGPT_URL];
    }
    else {
        command = "xdg-open";
        args = [CHATGPT_URL];
    }
    try {
        const proc = spawn(command, args, {
            detached: true,
            stdio: "ignore",
        });
        proc.unref();
        return "ok";
    }
    catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}
async function launchChatGptContext(options) {
    await ensureBrowserProfileDir();
    return chromium.launchPersistentContext(DEFAULT_BROWSER_PROFILE_DIR, {
        headless: options.headless,
        viewport: { width: 1440, height: 1000 },
        args: [
            "--disable-dev-shm-usage",
            "--no-default-browser-check",
            "--no-first-run",
        ],
    });
}
async function getActivePage(context) {
    const existing = context.pages()[0];
    if (existing)
        return existing;
    return context.newPage();
}
async function saveScreenshot(page, file) {
    try {
        await page.screenshot({ path: file, fullPage: true });
        return file;
    }
    catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}
async function findComposer(page) {
    const selectors = [
        "#prompt-textarea",
        "[data-testid='prompt-textarea']",
        "div[contenteditable='true'][role='textbox']",
        "div[contenteditable='true']",
        "textarea",
    ];
    for (const selector of selectors) {
        const locator = page.locator(selector).last();
        try {
            await locator.waitFor({ state: "visible", timeout: 2500 });
            return locator;
        }
        catch {
            // Try the next selector.
        }
    }
    return null;
}
async function isLoggedIn(page) {
    const composer = await findComposer(page);
    if (composer)
        return true;
    const loginIndicators = [
        "text=/log in/i",
        "text=/sign up/i",
        "button:has-text('Log in')",
        "button:has-text('Sign up')",
    ];
    for (const selector of loginIndicators) {
        try {
            if ((await page.locator(selector).count()) > 0) {
                return false;
            }
        }
        catch {
            // Ignore selector differences.
        }
    }
    return false;
}
async function selectModel(page, model) {
    const candidates = [
        "button[data-testid='model-switcher-dropdown-button']",
        "button[aria-label*='model' i]",
        "button:has-text('GPT')",
    ];
    for (const selector of candidates) {
        const button = page.locator(selector).first();
        try {
            await button.waitFor({ state: "visible", timeout: 2500 });
            await button.click();
            const modelOption = page.getByText(model, { exact: false }).first();
            await modelOption.waitFor({ state: "visible", timeout: 4000 });
            await modelOption.click();
            return `selected ${model}`;
        }
        catch {
            try {
                await page.keyboard.press("Escape");
            }
            catch {
                // Ignore.
            }
        }
    }
    return `could not confirm model selection; continuing with current ChatGPT model`;
}
async function fillComposer(page, prompt) {
    const composer = await findComposer(page);
    if (!composer) {
        throw new Error("ChatGPT composer not found; login may be required");
    }
    await composer.click();
    const tagName = await composer.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === "textarea") {
        await composer.fill(prompt);
    }
    else {
        await page.keyboard.insertText(prompt);
    }
}
async function clickSend(page) {
    const selectors = [
        "button[data-testid='send-button']",
        "button[aria-label*='Send' i]",
        "button:has(svg)",
    ];
    for (const selector of selectors) {
        const button = page.locator(selector).last();
        try {
            await button.waitFor({ state: "visible", timeout: 2500 });
            if (await button.isEnabled()) {
                await button.click();
                return;
            }
        }
        catch {
            // Try the next selector.
        }
    }
    await page.keyboard.press("Enter");
}
async function waitForAssistantResponse(page, timeoutMs) {
    const started = Date.now();
    let lastText = "";
    let stableSince = Date.now();
    while (Date.now() - started < timeoutMs) {
        const assistantMessages = page.locator("[data-message-author-role='assistant']");
        const count = await assistantMessages.count().catch(() => 0);
        if (count > 0) {
            const text = (await assistantMessages.nth(count - 1).innerText().catch(() => "")).trim();
            if (text && text !== lastText) {
                lastText = text;
                stableSince = Date.now();
            }
            const stopVisible = (await page
                .locator("button[aria-label*='Stop' i], button:has-text('Stop')")
                .count()
                .catch(() => 0)) > 0;
            if (lastText && !stopVisible && Date.now() - stableSince > 3000) {
                return lastText;
            }
        }
        await page.waitForTimeout(1000);
    }
    throw new Error(`Timed out waiting for ChatGPT response after ${timeoutMs}ms`);
}
async function checkLoginStatus(args) {
    const headless = argBool(args, "headless", defaultHeadless());
    await ensureTaskDir();
    const usingExistingContext = Boolean(interactiveLoginContext);
    const context = interactiveLoginContext || (await launchChatGptContext({ headless }));
    const page = await getActivePage(context);
    try {
        await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2500);
        const loggedIn = await isLoggedIn(page);
        const screenshotFile = join(DEFAULT_TASK_DIR, "login-status.png");
        await saveScreenshot(page, screenshotFile);
        return `# ChatGPT Login Status

Logged in: ${loggedIn ? "yes" : "no"}
Mode: ${usingExistingContext ? "existing headed session" : headless ? "headless" : "headed"}
Profile: ${DEFAULT_BROWSER_PROFILE_DIR}
Screenshot: ${screenshotFile}
URL: ${page.url()}

${loggedIn ? "The profile appears ready for automated Pro tasks." : "Login is required before automated Pro tasks can run."}`;
    }
    finally {
        if (!usingExistingContext) {
            await context.close();
        }
    }
}
async function openProLogin(args) {
    const headless = argBool(args, "headless", false);
    await ensureTaskDir();
    if (!headless && !canOpenInteractiveBrowser()) {
        return `# Cannot Open Interactive Browser

This host has no GUI display configured.

Profile path: ${DEFAULT_BROWSER_PROFILE_DIR}

To log in, use one of these:
1. Run this MCP server on a workstation with a desktop browser, install with \`./setup-dual-agent.sh --pro-worker\`, then run \`open_pro_login\` and log in once.
2. Use SSH X forwarding or a VNC/noVNC desktop on this host, then call \`open_pro_login\` with \`headless=false\`.
3. Copy a compatible already-authenticated Chromium profile into:
   ${DEFAULT_BROWSER_PROFILE_DIR}

Headless mode can check an existing session, but it cannot complete interactive login, CAPTCHA, passkey, or 2FA flows.`;
    }
    if (interactiveLoginContext) {
        await interactiveLoginContext.close().catch(() => undefined);
        interactiveLoginContext = null;
    }
    const context = await launchChatGptContext({ headless });
    const page = await getActivePage(context);
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (headless) {
        const screenshotFile = join(DEFAULT_TASK_DIR, "login-headless.png");
        await saveScreenshot(page, screenshotFile);
        await context.close();
        return `Opened ChatGPT in headless mode and saved a screenshot: ${screenshotFile}

Headless mode is useful only to inspect an existing session. Use a GUI/VNC/X-forwarded session for first login.`;
    }
    interactiveLoginContext = context;
    return `Opened ChatGPT for interactive login.

Browser profile: ${DEFAULT_BROWSER_PROFILE_DIR}

Complete login in the opened browser and keep the session signed in. After login, run \`login_status\` to verify. The browser was intentionally left open.`;
}
async function runAutomatedProTask(params) {
    if (interactiveLoginContext) {
        await interactiveLoginContext.close().catch(() => undefined);
        interactiveLoginContext = null;
    }
    const context = await launchChatGptContext({ headless: params.headless });
    const page = await getActivePage(context);
    const screenshotFile = join(jobDir(params.meta.id), "screenshot.png");
    try {
        params.meta.status = "running";
        params.meta.automationStatus = "running";
        params.meta.updatedAt = new Date().toISOString();
        await writeMeta(params.meta);
        await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2500);
        if (!(await isLoggedIn(page))) {
            await saveScreenshot(page, screenshotFile);
            throw new Error(`ChatGPT login required. Open a GUI/VNC/X-forwarded browser and run open_pro_login. Screenshot: ${screenshotFile}`);
        }
        const modelStatus = await selectModel(page, params.model);
        await fillComposer(page, params.prompt);
        await clickSend(page);
        const response = await waitForAssistantResponse(page, params.timeoutMs);
        await writeFile(params.meta.resultFile, response);
        params.meta.status = "complete";
        params.meta.automationStatus = modelStatus;
        params.meta.conversationUrl = page.url();
        params.meta.screenshotFile = await saveScreenshot(page, screenshotFile);
        params.meta.updatedAt = new Date().toISOString();
        delete params.meta.error;
        await writeMeta(params.meta);
        return params.meta;
    }
    catch (err) {
        params.meta.status = "failed";
        params.meta.automationStatus = "failed";
        params.meta.error = err instanceof Error ? err.message : String(err);
        params.meta.screenshotFile = await saveScreenshot(page, screenshotFile);
        params.meta.conversationUrl = page.url();
        params.meta.updatedAt = new Date().toISOString();
        await writeMeta(params.meta);
        throw err;
    }
    finally {
        await context.close();
    }
}
async function submitProTask(args) {
    const task = argString(args, "task");
    if (!task) {
        throw new Error("task is required");
    }
    const context = argString(args, "context");
    const taskType = argString(args, "task_type", "custom") || "custom";
    const expectedOutput = argString(args, "expected_output", taskType === "implement" ? "unified_diff" : "custom") ||
        "custom";
    const model = argString(args, "model", DEFAULT_MODEL) || DEFAULT_MODEL;
    const title = argString(args, "title") ||
        task
            .replace(/\s+/g, " ")
            .slice(0, 80);
    const automate = argBool(args, "automate", true);
    const shouldOpenBrowser = argBool(args, "open_browser", !automate);
    const shouldCopyToClipboard = argBool(args, "copy_to_clipboard", !automate);
    const wait = argBool(args, "wait", true);
    const headless = argBool(args, "headless", defaultHeadless());
    const timeoutMs = argNumber(args, "timeout_ms", DEFAULT_AUTOMATION_TIMEOUT_MS);
    await ensureTaskDir();
    const jobId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const dir = jobDir(jobId);
    await mkdir(dir, { recursive: true });
    const prompt = buildPrompt({
        task,
        context,
        taskType,
        expectedOutput,
        model,
    });
    const promptFile = join(dir, "prompt.md");
    const resultFile = join(dir, "result.md");
    await writeFile(promptFile, prompt);
    const clipboardStatus = shouldCopyToClipboard
        ? await copyToClipboard(prompt)
        : "skipped";
    const browserStatus = shouldOpenBrowser ? openBrowser() : "skipped";
    const now = new Date().toISOString();
    const meta = {
        id: jobId,
        title,
        taskType,
        expectedOutput,
        model,
        createdAt: now,
        updatedAt: now,
        status: "submitted",
        promptFile,
        resultFile,
        clipboardStatus,
        browserStatus,
        automationStatus: automate ? "pending" : "manual",
    };
    await writeMeta(meta);
    if (automate) {
        const run = runAutomatedProTask({
            meta,
            prompt,
            model,
            headless,
            timeoutMs,
        });
        if (wait) {
            const completed = await run;
            const response = await readFile(completed.resultFile, "utf-8");
            return `# ChatGPT Pro Task Complete

Job ID: \`${jobId}\`
Title: ${title}
Model: ${model}
Task type: ${taskType}
Expected output: ${expectedOutput}
Automation: ${completed.automationStatus}
Conversation: ${completed.conversationUrl || "(unknown)"}
Result file: ${completed.resultFile}
Screenshot: ${completed.screenshotFile || "(none)"}

## Result

${response}`;
        }
        run.catch((err) => {
            console.error(`[chatgpt-pro-worker] Job ${jobId} failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return `# ChatGPT Pro Task Started

Job ID: \`${jobId}\`
Title: ${title}
Model: ${model}
Task type: ${taskType}
Expected output: ${expectedOutput}
Mode: automated ${headless ? "headless" : "headed"}

Use \`await_pro_task\` or \`get_pro_task\` with this job id to retrieve the result.`;
    }
    return `# ChatGPT Pro Task Submitted

Job ID: \`${jobId}\`
Title: ${title}
Model: ${model}
Task type: ${taskType}
Expected output: ${expectedOutput}

Prompt file: ${promptFile}
Result file: ${resultFile}
Clipboard: ${clipboardStatus}
Browser: ${browserStatus}
Automation: manual fallback

Next steps:
1. In ChatGPT, select **${model}**.
2. Paste the clipboard contents into the prompt box.
3. Submit the task.
4. When ChatGPT finishes, paste the full response back to Codex and call \`save_pro_result\` with this job id.
5. Then call \`get_pro_task\` so Codex can apply, test, or summarize the result.`;
}
async function saveProResult(args) {
    const jobId = argString(args, "job_id");
    const response = argString(args, "response");
    if (!jobId)
        throw new Error("job_id is required");
    if (!response)
        throw new Error("response is required");
    const meta = await readMeta(jobId);
    await writeFile(meta.resultFile, response);
    meta.status = "complete";
    meta.updatedAt = new Date().toISOString();
    await writeMeta(meta);
    return `Saved ChatGPT Pro result for job \`${jobId}\` to ${meta.resultFile}.`;
}
async function awaitProTask(args) {
    const jobId = argString(args, "job_id");
    if (!jobId)
        throw new Error("job_id is required");
    const timeoutMs = argNumber(args, "timeout_ms", DEFAULT_AUTOMATION_TIMEOUT_MS);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const meta = await readMeta(jobId);
        if (meta.status === "complete") {
            const result = await readFile(meta.resultFile, "utf-8");
            return `# ChatGPT Pro Job Complete

Job ID: \`${jobId}\`
Title: ${meta.title}
Model: ${meta.model}
Task type: ${meta.taskType}
Expected output: ${meta.expectedOutput}
Conversation: ${meta.conversationUrl || "(unknown)"}
Result file: ${meta.resultFile}
Screenshot: ${meta.screenshotFile || "(none)"}

## Result

${result}`;
        }
        if (meta.status === "failed") {
            return `# ChatGPT Pro Job Failed

Job ID: \`${jobId}\`
Title: ${meta.title}
Error: ${meta.error || "unknown error"}
Screenshot: ${meta.screenshotFile || "(none)"}
Conversation: ${meta.conversationUrl || "(unknown)"}`;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return `Timed out waiting for ChatGPT Pro job \`${jobId}\` after ${timeoutMs}ms. Use get_pro_task to check status later.`;
}
async function getProTask(args) {
    const jobId = argString(args, "job_id");
    if (!jobId)
        throw new Error("job_id is required");
    const meta = await readMeta(jobId);
    const hasResult = existsSync(meta.resultFile);
    const result = hasResult ? await readFile(meta.resultFile, "utf-8") : "";
    return `# ChatGPT Pro Job ${meta.id}

Status: ${meta.status}
Title: ${meta.title}
Model: ${meta.model}
Task type: ${meta.taskType}
Expected output: ${meta.expectedOutput}
Automation: ${meta.automationStatus}
Created: ${meta.createdAt}
Updated: ${meta.updatedAt}
Conversation: ${meta.conversationUrl || "(unknown)"}
Screenshot: ${meta.screenshotFile || "(none)"}
Error: ${meta.error || "(none)"}

Prompt file: ${meta.promptFile}
Result file: ${meta.resultFile}

${hasResult ? `## Result\n\n${result}` : "No result saved yet. Paste the ChatGPT response with `save_pro_result`."}`;
}
async function showProPrompt(args) {
    const jobId = argString(args, "job_id");
    if (!jobId)
        throw new Error("job_id is required");
    const meta = await readMeta(jobId);
    const prompt = await readFile(meta.promptFile, "utf-8");
    return `# Prompt for ${jobId}\n\n${prompt}`;
}
async function listProTasks() {
    await ensureTaskDir();
    const entries = await readdir(DEFAULT_TASK_DIR, { withFileTypes: true });
    const metas = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        try {
            metas.push(await readMeta(entry.name));
        }
        catch {
            // Ignore incomplete task directories.
        }
    }
    metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (metas.length === 0) {
        return "No ChatGPT Pro jobs found.";
    }
    return [
        "# ChatGPT Pro Jobs",
        "",
        ...metas.slice(0, 25).map((meta) => {
            return `- \`${meta.id}\` [${meta.status}] ${meta.taskType}: ${meta.title}`;
        }),
    ].join("\n");
}
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {});
    try {
        switch (name) {
            case "login_status":
                return { content: [{ type: "text", text: await checkLoginStatus(args) }] };
            case "open_pro_login":
                return { content: [{ type: "text", text: await openProLogin(args) }] };
            case "submit_pro_task":
                return { content: [{ type: "text", text: await submitProTask(args) }] };
            case "await_pro_task":
                return { content: [{ type: "text", text: await awaitProTask(args) }] };
            case "save_pro_result":
                return { content: [{ type: "text", text: await saveProResult(args) }] };
            case "get_pro_task":
                return { content: [{ type: "text", text: await getProTask(args) }] };
            case "show_pro_prompt":
                return { content: [{ type: "text", text: await showProPrompt(args) }] };
            case "list_pro_tasks":
                return { content: [{ type: "text", text: await listProTasks() }] };
            default:
                return {
                    content: [{ type: "text", text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[chatgpt-pro-worker] MCP server running on stdio (v0.1.0)");
}
main().catch((err) => {
    console.error("[chatgpt-pro-worker] Fatal error:", err);
    process.exit(1);
});
