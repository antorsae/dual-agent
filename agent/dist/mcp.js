#!/usr/bin/env node
/**
 * MCP Server for codex-delegate
 *
 * Exposes Codex delegation as tools that Claude can call directly.
 * Runs tasks in background by default with progress notifications.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { runCodex } from "./codex.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { platform } from "os";
/**
 * Send a desktop notification (cross-platform)
 */
function sendNotification(title, message) {
    const os = platform();
    let cmd;
    if (os === "darwin") {
        // macOS
        const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" sound name "Glass"`;
        cmd = `osascript -e '${script}'`;
    }
    else if (os === "linux") {
        // Linux (requires libnotify / notify-send)
        const escapedTitle = title.replace(/'/g, "'\\''");
        const escapedMessage = message.replace(/'/g, "'\\''");
        cmd = `notify-send '${escapedTitle}' '${escapedMessage}' --urgency=normal`;
    }
    else if (os === "win32") {
        // Windows (PowerShell toast notification)
        const escapedTitle = title.replace(/'/g, "''");
        const escapedMessage = message.replace(/'/g, "''");
        cmd = `powershell -Command "New-BurntToastNotification -Text '${escapedTitle}', '${escapedMessage}'"`;
    }
    else {
        console.error(`[codex-delegate] Notifications not supported on ${os}`);
        return;
    }
    exec(cmd, (err) => {
        if (err) {
            console.error(`[codex-delegate] Notification failed: ${err.message}`);
        }
    });
}
const tasks = new Map();
// Minimum seconds between status checks (while running)
const MIN_CHECK_INTERVAL = 60;
// 2 hour timeout
const DEFAULT_TIMEOUT = 2 * 60 * 60 * 1000;
const server = new Server({
    name: "codex-delegate",
    version: "0.2.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Define available tools
const TOOLS = [
    {
        name: "delegate_codex_review",
        description: "Delegate code review to Codex CLI (runs in background). Returns task ID immediately. Use delegate_codex_status to check progress and get results. Use for security audits, bug finding, performance analysis.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "What to review and what to focus on",
                },
                files: {
                    type: "string",
                    description: "Comma-separated list of files to review (optional)",
                },
                wait: {
                    type: "boolean",
                    description: "If true, wait for completion instead of running in background (default: false)",
                },
            },
            required: ["prompt"],
        },
    },
    {
        name: "delegate_codex_implement",
        description: "Delegate implementation to Codex CLI (runs in background). Returns task ID immediately. Use delegate_codex_status to check progress and get results.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "What to implement, with requirements and constraints",
                },
                files: {
                    type: "string",
                    description: "Comma-separated list of context files (optional)",
                },
                wait: {
                    type: "boolean",
                    description: "If true, wait for completion instead of running in background (default: false)",
                },
            },
            required: ["prompt"],
        },
    },
    {
        name: "delegate_codex_plan_review",
        description: "Delegate plan review to Codex CLI (runs in background). Returns task ID immediately. Use delegate_codex_status to check progress and get results.",
        inputSchema: {
            type: "object",
            properties: {
                plan: {
                    type: "string",
                    description: "The implementation plan to review",
                },
                wait: {
                    type: "boolean",
                    description: "If true, wait for completion instead of running in background (default: false)",
                },
            },
            required: ["plan"],
        },
    },
    {
        name: "delegate_codex",
        description: "Send any prompt to Codex CLI (runs in background). Returns task ID immediately. Use delegate_codex_status to check progress and get results.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "The prompt to send to Codex",
                },
                wait: {
                    type: "boolean",
                    description: "If true, wait for completion instead of running in background (default: false)",
                },
            },
            required: ["prompt"],
        },
    },
    {
        name: "delegate_codex_status",
        description: "Check status of a background Codex task. Returns progress info if running, or full results if completed.",
        inputSchema: {
            type: "object",
            properties: {
                task_id: {
                    type: "string",
                    description: "The task ID returned by a delegate_codex_* call",
                },
            },
            required: ["task_id"],
        },
    },
    {
        name: "delegate_codex_list",
        description: "List all Codex tasks (running and completed).",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
];
// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
/**
 * Start a background task
 */
function startBackgroundTask(taskType, prompt, files) {
    const taskId = randomUUID().slice(0, 8);
    const task = {
        id: taskId,
        type: taskType,
        prompt: prompt.slice(0, 100) + (prompt.length > 100 ? "..." : ""),
        files,
        status: "running",
        startTime: Date.now(),
        progressLines: 0,
        lastChecked: 0,
    };
    tasks.set(taskId, task);
    // Run in background
    runCodex({ type: taskType, prompt, files }, {
        stream: false,
        timeout: DEFAULT_TIMEOUT,
        onProgress: (lines) => {
            task.progressLines = lines;
        },
    }).then((result) => {
        task.status = result.success ? "completed" : "failed";
        task.endTime = Date.now();
        task.result = result;
        console.error(`[codex-delegate] Task ${taskId} ${task.status}`);
        // Send desktop notification
        const duration = formatDuration(task.endTime - task.startTime);
        if (result.success) {
            sendNotification("✅ Codex Task Complete", `Task ${taskId} (${taskType}) finished in ${duration}. Ask Claude: "get codex results"`);
        }
        else {
            sendNotification("❌ Codex Task Failed", `Task ${taskId} (${taskType}) failed after ${duration}. Ask Claude: "check codex status"`);
        }
    }).catch((err) => {
        task.status = "failed";
        task.endTime = Date.now();
        task.result = { success: false, output: "", error: err.message };
        console.error(`[codex-delegate] Task ${taskId} error: ${err.message}`);
        // Send desktop notification for error
        sendNotification("❌ Codex Task Error", `Task ${taskId} crashed: ${err.message.slice(0, 50)}`);
    });
    console.error(`[codex-delegate] Started background task ${taskId} (${taskType})`);
    return taskId;
}
/**
 * Format duration in human-readable form
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60)
        return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // Handle status check
    if (name === "delegate_codex_status") {
        const taskId = args.task_id;
        const task = tasks.get(taskId);
        if (!task) {
            return {
                content: [{ type: "text", text: `Task not found: ${taskId}` }],
                isError: true,
            };
        }
        const elapsed = formatDuration(Date.now() - task.startTime);
        if (task.status === "running") {
            const now = Date.now();
            const secondsSinceLastCheck = (now - task.lastChecked) / 1000;
            // Rate limit: reject if checked too recently
            if (task.lastChecked > 0 && secondsSinceLastCheck < MIN_CHECK_INTERVAL) {
                const waitMore = Math.ceil(MIN_CHECK_INTERVAL - secondsSinceLastCheck);
                return {
                    content: [{
                            type: "text",
                            text: `**RATE LIMITED**: You checked ${Math.floor(secondsSinceLastCheck)}s ago.\n\n` +
                                `⛔ Do NOT check again for ${waitMore} more seconds.\n\n` +
                                `Tell the user: "Codex is still working. I'll check back in a minute, or you can ask me to check status when you're ready."\n\n` +
                                `**DO SOMETHING ELSE NOW. DO NOT CALL THIS TOOL AGAIN.**`,
                        }],
                    isError: true,
                };
            }
            task.lastChecked = now;
            return {
                content: [{
                        type: "text",
                        text: `**Task ${taskId}**: RUNNING\n` +
                            `**Type**: ${task.type}\n` +
                            `**Elapsed**: ${elapsed}\n` +
                            `**Progress**: ${task.progressLines} lines of output\n` +
                            `**Prompt**: ${task.prompt}\n\n` +
                            `⏳ Task is still running. Codex reviews typically take 2-10 minutes.\n\n` +
                            `**STOP. Do not check status again.** Tell the user:\n` +
                            `"Codex is working on it (${elapsed} elapsed, ${task.progressLines} lines so far). ` +
                            `You'll get a desktop notification when it's done, or ask me to 'check codex status' later."\n\n` +
                            `Now help with something else or wait for the user to ask.`,
                    }],
            };
        }
        const duration = formatDuration(task.endTime - task.startTime);
        if (task.status === "completed") {
            return {
                content: [{
                        type: "text",
                        text: `**Task ${taskId}**: COMPLETED\n` +
                            `**Type**: ${task.type}\n` +
                            `**Duration**: ${duration}\n\n` +
                            `## Result\n\n${task.result.output}`,
                    }],
            };
        }
        // Failed
        return {
            content: [{
                    type: "text",
                    text: `**Task ${taskId}**: FAILED\n` +
                        `**Type**: ${task.type}\n` +
                        `**Duration**: ${duration}\n` +
                        `**Error**: ${task.result?.error}\n\n` +
                        `## Output\n\n${task.result?.output || "(no output)"}`,
                }],
            isError: true,
        };
    }
    // Handle list tasks
    if (name === "delegate_codex_list") {
        if (tasks.size === 0) {
            return {
                content: [{ type: "text", text: "No Codex tasks." }],
            };
        }
        const lines = ["# Codex Tasks\n"];
        for (const [id, task] of tasks) {
            const elapsed = formatDuration((task.endTime || Date.now()) - task.startTime);
            const status = task.status === "running" ? "🔄 RUNNING" :
                task.status === "completed" ? "✅ COMPLETED" : "❌ FAILED";
            lines.push(`- **${id}** [${status}] ${task.type} (${elapsed}) - ${task.prompt}`);
        }
        return {
            content: [{ type: "text", text: lines.join("\n") }],
        };
    }
    // Handle delegation tools
    let taskType;
    let prompt;
    let files;
    let wait = false;
    switch (name) {
        case "delegate_codex_review":
            taskType = "review";
            prompt = args.prompt;
            files = args.files
                ?.split(",")
                .map((f) => f.trim());
            wait = args.wait ?? false;
            break;
        case "delegate_codex_implement":
            taskType = "implement";
            prompt = args.prompt;
            files = args.files
                ?.split(",")
                .map((f) => f.trim());
            wait = args.wait ?? false;
            break;
        case "delegate_codex_plan_review":
            taskType = "plan-review";
            prompt = args.plan;
            wait = args.wait ?? false;
            break;
        case "delegate_codex":
            taskType = "custom";
            prompt = args.prompt;
            wait = args.wait ?? false;
            break;
        default:
            return {
                content: [{ type: "text", text: `Unknown tool: ${name}` }],
                isError: true,
            };
    }
    // Background mode (default)
    if (!wait) {
        const taskId = startBackgroundTask(taskType, prompt, files);
        return {
            content: [{
                    type: "text",
                    text: `**Codex task started in background**\n\n` +
                        `**Task ID**: \`${taskId}\`\n` +
                        `**Type**: ${taskType}\n\n` +
                        `⏳ Codex typically takes **2-10 minutes** for reviews.\n\n` +
                        `**IMPORTANT**: Do NOT poll status repeatedly. Instead:\n` +
                        `1. Tell the user the task is running in background\n` +
                        `2. Continue helping with other tasks\n` +
                        `3. Let the user ask "check codex status" or "get codex results" when ready\n\n` +
                        `Task ID for later: ${taskId}`,
                }],
        };
    }
    // Synchronous mode (wait=true)
    console.error(`[codex-delegate] Running ${taskType} task (sync)...`);
    const result = await runCodex({ type: taskType, prompt, files }, { stream: false, timeout: DEFAULT_TIMEOUT });
    if (result.success) {
        console.error(`[codex-delegate] Task completed successfully`);
        return {
            content: [{ type: "text", text: result.output }],
        };
    }
    else {
        console.error(`[codex-delegate] Task failed: ${result.error}`);
        return {
            content: [
                { type: "text", text: `Error: ${result.error}\n\n${result.output}` },
            ],
            isError: true,
        };
    }
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[codex-delegate] MCP server running on stdio (v0.2.0)");
}
main().catch((err) => {
    console.error("[codex-delegate] Fatal error:", err);
    process.exit(1);
});
