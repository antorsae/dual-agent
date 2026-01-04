#!/usr/bin/env node
/**
 * MCP Server for codex-delegate
 *
 * Exposes Codex delegation as tools that Claude can call directly.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { runCodex } from "./codex.js";
const server = new Server({
    name: "codex-delegate",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Define available tools - prefixed with "delegate_" to avoid collision with skills
const TOOLS = [
    {
        name: "delegate_codex_review",
        description: "Delegate code review to Codex CLI. Use for security audits, bug finding, performance analysis, and thorough code quality checks. Spawns codex directly.",
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
            },
            required: ["prompt"],
        },
    },
    {
        name: "delegate_codex_implement",
        description: "Delegate implementation to Codex CLI. Use for complex features, algorithms, or when meticulous edge-case handling is needed. Spawns codex directly.",
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
            },
            required: ["prompt"],
        },
    },
    {
        name: "delegate_codex_plan_review",
        description: "Delegate plan review to Codex CLI. Use to validate implementation plans, find gaps, and get architectural feedback. Spawns codex directly.",
        inputSchema: {
            type: "object",
            properties: {
                plan: {
                    type: "string",
                    description: "The implementation plan to review",
                },
            },
            required: ["plan"],
        },
    },
    {
        name: "delegate_codex",
        description: "Send any prompt to Codex CLI. Use for custom tasks. Spawns codex directly without tmux or file communication.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "The prompt to send to Codex",
                },
            },
            required: ["prompt"],
        },
    },
];
// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    let taskType;
    let prompt;
    let files;
    switch (name) {
        case "delegate_codex_review":
            taskType = "review";
            prompt = args.prompt;
            files = args.files
                ?.split(",")
                .map((f) => f.trim());
            break;
        case "delegate_codex_implement":
            taskType = "implement";
            prompt = args.prompt;
            files = args.files
                ?.split(",")
                .map((f) => f.trim());
            break;
        case "delegate_codex_plan_review":
            taskType = "plan-review";
            prompt = args.plan;
            break;
        case "delegate_codex":
            taskType = "custom";
            prompt = args.prompt;
            break;
        default:
            return {
                content: [{ type: "text", text: `Unknown tool: ${name}` }],
                isError: true,
            };
    }
    console.error(`[codex-delegate] Running ${taskType} task...`);
    const result = await runCodex({ type: taskType, prompt, files }, { stream: false });
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
    console.error("[codex-delegate] MCP server running on stdio");
}
main().catch((err) => {
    console.error("[codex-delegate] Fatal error:", err);
    process.exit(1);
});
