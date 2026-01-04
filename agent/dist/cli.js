#!/usr/bin/env node
/**
 * codex-delegate - Thin wrapper for delegating tasks to Codex CLI
 *
 * Usage:
 *   codex-delegate review "check auth.ts for security issues"
 *   codex-delegate implement "add input validation" --files src/form.ts
 *   codex-delegate plan-review "review my migration plan"
 *   codex-delegate custom "any prompt you want"
 *   codex-delegate --file task.md
 */
import { readFile } from "fs/promises";
import { runCodex, runCodexToFile } from "./codex.js";
const USAGE = `
codex-delegate - Delegate tasks to Codex CLI

Usage:
  codex-delegate <type> <prompt> [options]
  codex-delegate --file <task.md> [options]

Task Types:
  review       Code review (security, bugs, quality)
  implement    Implement a feature
  plan-review  Review an implementation plan
  custom       Pass prompt directly to Codex

Options:
  --files <f1,f2>   Comma-separated list of files to include
  --output <file>   Write response to file (for .agent-collab)
  --no-stream       Buffer output instead of streaming
  --timeout <ms>    Timeout in milliseconds (default: 300000)
  --help            Show this help

Examples:
  codex-delegate review "check src/auth.ts for vulnerabilities"
  codex-delegate review "analyze error handling" --files src/api.ts,src/utils.ts
  codex-delegate implement "add rate limiting to the API"
  codex-delegate plan-review "migration from REST to GraphQL"
  codex-delegate custom "explain how the caching system works"
  codex-delegate --file task.md --output response.md
`;
function parseArgs(args) {
    const result = {
        type: "custom",
        prompt: "",
        stream: true,
        timeout: 5 * 60 * 1000,
        help: false,
    };
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            result.help = true;
            i++;
        }
        else if (arg === "--file" || arg === "-f") {
            result.taskFile = args[++i];
            i++;
        }
        else if (arg === "--files") {
            result.files = args[++i]?.split(",").map((f) => f.trim());
            i++;
        }
        else if (arg === "--output" || arg === "-o") {
            result.output = args[++i];
            i++;
        }
        else if (arg === "--no-stream") {
            result.stream = false;
            i++;
        }
        else if (arg === "--timeout") {
            result.timeout = parseInt(args[++i], 10);
            i++;
        }
        else if (!arg.startsWith("-")) {
            // First positional arg is type, rest is prompt
            if (!result.type || result.type === "custom") {
                const validTypes = ["review", "implement", "plan-review", "custom"];
                if (validTypes.includes(arg)) {
                    result.type = arg;
                }
                else {
                    // Not a valid type, treat as start of prompt
                    result.prompt = args.slice(i).join(" ");
                    break;
                }
            }
            else {
                // Collect remaining as prompt
                result.prompt = args.slice(i).join(" ");
                break;
            }
            i++;
        }
        else {
            i++;
        }
    }
    return result;
}
async function loadTaskFile(path) {
    const content = await readFile(path, "utf-8");
    // Try to parse structured task file
    const typeMatch = content.match(/^##?\s*Task\s*Type[:\s]+(\w+)/im);
    const filesMatch = content.match(/^##?\s*Files[:\s]*([\s\S]*?)(?=^##|$)/im);
    let type = "custom";
    if (typeMatch) {
        const t = typeMatch[1].toLowerCase();
        if (t === "review" || t === "code_review")
            type = "review";
        else if (t === "implement")
            type = "implement";
        else if (t === "plan_review" || t === "plan-review")
            type = "plan-review";
    }
    let files;
    if (filesMatch) {
        files = filesMatch[1]
            .split("\n")
            .map((l) => l.replace(/^[-*]\s*/, "").trim())
            .filter((l) => l && !l.startsWith("#"));
    }
    return { type, prompt: content, files };
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(USAGE);
        process.exit(0);
    }
    // Load from file if specified
    if (args.taskFile) {
        try {
            const task = await loadTaskFile(args.taskFile);
            args.type = task.type;
            args.prompt = task.prompt;
            if (task.files)
                args.files = task.files;
        }
        catch (err) {
            console.error(`Error reading task file: ${args.taskFile}`);
            process.exit(1);
        }
    }
    if (!args.prompt) {
        console.error("Error: No prompt provided\n");
        console.log(USAGE);
        process.exit(1);
    }
    const task = {
        type: args.type,
        prompt: args.prompt,
        files: args.files,
        cwd: process.cwd(),
    };
    const options = {
        stream: args.stream,
        timeout: args.timeout,
    };
    let result;
    if (args.output) {
        result = await runCodexToFile(task, args.output, options);
    }
    else {
        result = await runCodex(task, options);
    }
    process.exit(result.success ? 0 : 1);
}
main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
});
