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
import { parseArgs as parseNodeArgs } from "node:util";
import { runCodex, runCodexToFile, TaskType } from "./codex.js";
import type { ExecutionMode } from "./tasks.js";

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
  --output <file>   Write response to a Markdown file
  --no-stream       Print output once the task finishes
  --timeout <ms>    Timeout in milliseconds (default: 300000)
  --cwd <path>      Absolute project directory (default: current directory)
  --mode <mode>     read-only or edit (default: edit for implement, otherwise read-only)
  --help            Show this help

Options may appear before or after the prompt. Use -- before a prompt
that starts with a dash.

Examples:
  codex-delegate review "check src/auth.ts for vulnerabilities"
  codex-delegate review "analyze error handling" --files src/api.ts,src/utils.ts
  codex-delegate implement "add rate limiting to the API"
  codex-delegate plan-review "migration from REST to GraphQL"
  codex-delegate custom "explain how the caching system works"
  codex-delegate --file task.md --output response.md
`;

interface ParsedArgs {
  type: TaskType;
  prompt: string;
  files?: string[];
  output?: string;
  stream: boolean;
  timeout: number;
  help: boolean;
  taskFile?: string;
  cwd?: string;
  mode?: ExecutionMode;
}

function parseArgs(args: string[]): ParsedArgs {
  const { values, positionals } = parseNodeArgs({
    args,
    allowPositionals: true,
    options: {
      file: { type: "string", short: "f" },
      files: { type: "string" },
      output: { type: "string", short: "o" },
      "no-stream": { type: "boolean" },
      timeout: { type: "string" },
      cwd: { type: "string" },
      mode: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const timeout = values.timeout === undefined ? 300000 : Number(values.timeout);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) {
    throw new Error("--timeout must be an integer between 1 and 2147483647 milliseconds");
  }
  if (values.file && positionals.length && !values.help) {
    throw new Error("Use either --file or a positional task/prompt, not both");
  }
  if (values.mode !== undefined && !["read-only", "edit"].includes(values.mode)) {
    throw new Error("--mode must be read-only or edit");
  }
  const validTypes: TaskType[] = ["review", "implement", "plan-review", "custom"];
  const type = validTypes.includes(positionals[0] as TaskType)
    ? positionals.shift() as TaskType
    : "custom";

  return {
    type,
    prompt: positionals.join(" "),
    files: values.files?.split(",").map((f) => f.trim()).filter(Boolean),
    output: values.output,
    stream: !values["no-stream"],
    timeout,
    help: values.help ?? false,
    taskFile: values.file,
    cwd: values.cwd,
    mode: values.mode as ExecutionMode | undefined,
  };
}

async function loadTaskFile(path: string): Promise<{ type: TaskType; prompt: string; files?: string[] }> {
  const content = await readFile(path, "utf-8");

  // Try to parse structured task file
  const typeMatch = content.match(/^##?\s*Task\s*Type[:\s]+([\w-]+)/im);

  let type: TaskType = "custom";
  if (typeMatch) {
    const t = typeMatch[1].toLowerCase();
    if (t === "review" || t === "code_review") type = "review";
    else if (t === "implement") type = "implement";
    else if (t === "plan_review" || t === "plan-review") type = "plan-review";
  }

  const files: string[] = [];
  let inFiles = false;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      inFiles = /^Files\s*:?$/i.test(heading[1]);
    } else if (inFiles && line.trim()) {
      files.push(line.replace(/^\s*[-*]\s*/, "").trim());
    }
  }

  return { type, prompt: content, files: files.length ? files : undefined };
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
      args.files ??= task.files;
    } catch (err) {
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
    cwd: args.cwd ?? process.cwd(),
    mode: args.mode,
  };

  const options = {
    stream: args.stream,
    timeout: args.timeout,
  };

  let result;
  if (args.output) {
    result = await runCodexToFile(task, args.output, options);
  } else {
    result = await runCodex(task, options);
  }

  if (!args.stream && result.output) {
    // Wait for a pipe to drain before exiting, including large buffered results.
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(result.output, (error) => error ? reject(error) : resolve());
    });
  }
  if (!result.success && result.error) {
    console.error(result.error);
  }
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
