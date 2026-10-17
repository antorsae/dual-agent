import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { stat } from "node:fs/promises";
import { JobManager } from "./jobs.js";
import { notifyCompletion } from "./notifications.js";
import { ExecutionMode, isFinished, Job, Provider, TaskType } from "./tasks.js";

const MAX_RESULT_CHARS = 64000;
const stringArg = (args: Record<string, unknown>, key: string, required = false): string | undefined => {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a nonempty string.`);
  return value;
};
function numberArg(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key] ?? fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  return value;
}
function booleanArg(args: Record<string, unknown>, key: string): boolean {
  const value = args[key] ?? false;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`);
  return value;
}
function filesArg(args: Record<string, unknown>): string[] | undefined {
  if (args.files === undefined) return undefined;
  const value = typeof args.files === "string" ? args.files.split(",").map(file => file.trim()).filter(Boolean) : args.files;
  if (!Array.isArray(value) || value.some(file => typeof file !== "string" || !file.trim())) throw new Error("files must be an array of paths or a comma-separated string.");
  return value;
}

export async function serveDelegation(provider: Provider): Promise<void> {
  const manager = new JobManager(undefined, undefined, notifyCompletion);
  await manager.store.init();
  const label = provider === "codex" ? "Codex" : "Claude";
  const prefix = `delegate_${provider}`;
  const server = new Server({ name: `${provider}-delegate`, version: "0.3.0" }, { capabilities: { tools: {} } });
  const common = {
    cwd: { type: "string", description: "Absolute project directory. Required unless the host supplies CLAUDE_PROJECT_DIR. The resolved path is returned with the job." },
    files: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Context file paths (an array, or a comma-separated string)." },
    mode: { type: "string", enum: ["read-only", "edit"], description: "Defaults to read-only, except implementation tools default to edit. Only one editing job may own a workspace." },
    wait: { type: "boolean", description: "Wait for the final answer in this call. Default false: return a persistent task ID, then use status with wait_ms to await completion." },
    timeout_ms: { type: "integer", minimum: 1, maximum: 2147483647, description: "Worker timeout in milliseconds (default two hours)." },
  };
  const kinds: Array<[string, TaskType, string]> = [
    ["_review", "review", `Get an independent ${label} code review: bugs, security, performance, and edge cases. Use when another model's review would help, including ordinary requests for a second opinion. Defaults to read-only.`],
    ["_implement", "implement", `Delegate a bounded implementation or fix to ${label}. Uses edit mode and an exclusive workspace lock. Stop editing that workspace yourself until the task finishes, then inspect changes and tests.`],
    ["_plan_review", "plan-review", `Ask ${label} to critique a plan or architecture, uncover missing cases, and suggest improvements. Use for an independent second opinion before a complex change. Defaults to read-only.`],
    ["", "custom", `Ask ${label} to perform any task using the supplied prompt and project context. The prompt is supplied per call, not fixed. Useful for independent analysis, debugging, or a second opinion. Defaults to read-only; explicitly select edit for changes.`],
  ];
  const tools = kinds.map(([suffix, type, description]) => ({
    name: prefix + suffix,
    description: description + ` Returns a durable job and final result or task ID. Continue with ${prefix}_status until complete; a running task is not a finished answer.`,
    inputSchema: {
      type: "object" as const, additionalProperties: false,
      properties: { [type === "plan-review" ? "plan" : "prompt"]: { type: "string", description: "Complete task instructions, requirements, and constraints for this call." }, ...common },
      required: [type === "plan-review" ? "plan" : "prompt"],
    },
  }));
  const taskId = { type: "string", description: "Persistent task ID from a delegation call." };
  const managementTools = [
    { name: `${prefix}_status`, description: `Read a ${label} job, saved final answer, error, and log paths, including jobs from earlier server sessions. Set wait_ms to 30000 to wait efficiently for completion.`, inputSchema: {
      type: "object" as const, additionalProperties: false, properties: { task_id: taskId, wait_ms: { type: "integer", minimum: 0, maximum: 30000 } }, required: ["task_id"],
    } },
    { name: `${prefix}_list`, description: `List recent persistent ${label} jobs, their status, and workspace.`, inputSchema: {
      type: "object" as const, additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
    } },
    { name: `${prefix}_cancel`, description: `Cancel a running ${label} job, stop its worker process group, and preserve its diagnostics. Can request cancellation from another live server instance.`, inputSchema: {
      type: "object" as const, additionalProperties: false, properties: { task_id: taskId }, required: ["task_id"],
    } },
  ];
  const allTools = [...tools, ...managementTools];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  async function response(job: Job) {
    const paths = {
      job: manager.store.file(job.id, "job.json"), result: manager.store.file(job.id, "result.md"),
      stdout: manager.store.file(job.id, "stdout.log"), stderr: manager.store.file(job.id, "stderr.log"),
    };
    const output = isFinished(job) ? await manager.store.result(job.id) : "";
    const cancelRequested = await manager.store.cancellationRequested(job.id);
    const bytes = await Promise.all([paths.stdout, paths.stderr].map(path => stat(path).then(s => s.size).catch(() => 0)));
    const excerpt = output.slice(0, MAX_RESULT_CHARS);
    const text = [
      `**Task ID**: ${job.id}`, `**Status**: ${job.status.toUpperCase()}${cancelRequested && !isFinished(job) ? " (cancellation requested)" : ""}`,
      `**Provider / Type / Mode**: ${job.provider} / ${job.type} / ${job.mode}`, `**Project**: ${job.cwd}`, `**Workspace**: ${job.workspace}`,
      `**Created**: ${job.createdAt}`, `**Output bytes**: ${bytes[0]} stdout, ${bytes[1]} stderr`,
      ...(job.sessionId ? [`**Session ID**: ${job.sessionId}`] : []), ...(job.error ? [`**Error**: ${job.error}`] : []),
      `**Metadata**: ${paths.job}`, `**Result**: ${paths.result}`, `**Stdout log**: ${paths.stdout}`, `**Stderr log**: ${paths.stderr}`,
      ...(excerpt ? ["", "## Result", "", excerpt, ...(output.length > excerpt.length ? [`\nResult excerpt truncated. Read the full answer from ${paths.result}.`] : [])] : []),
      ...(!isFinished(job) ? [`\nContinue with ${prefix}_status using task_id=${job.id} and wait_ms=30000. Do not treat a running job as completed.`] : []),
    ].join("\n");
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { task_id: job.id, status: job.status, provider: job.provider, mode: job.mode, cwd: job.cwd, workspace: job.workspace, error: job.error, session_id: job.sessionId, paths, cancel_requested: cancelRequested, output: excerpt, truncated: output.length > excerpt.length },
      isError: job.status === "failed" || job.status === "interrupted",
    };
  }

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    try {
      const tool = allTools.find(tool => tool.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      const allowed = Object.keys(tool.inputSchema.properties);
      for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`Unknown argument: ${key}`);
      if (name === `${prefix}_list`) {
        const jobs = await manager.list(provider, numberArg(args, "limit", 20, 1, 100));
        return { content: [{ type: "text", text: jobs.length ? jobs.map(job => `${job.id} | ${job.status} | ${job.type} | ${job.mode} | ${job.cwd} | ${job.prompt.replace(/\s+/g, " ").slice(0, 120)}`).join("\n") : `No ${label} jobs.` }], structuredContent: { jobs: jobs.map(({ id, status, type, mode, cwd, createdAt, prompt }) => ({ task_id: id, status, type, mode, cwd, created_at: createdAt, prompt: prompt.slice(0, 120) })) } };
      }
      if (name === `${prefix}_status`) return response(await manager.wait(stringArg(args, "task_id", true)!, numberArg(args, "wait_ms", 0, 0, 30000), provider));
      if (name === `${prefix}_cancel`) return response(await manager.cancel(stringArg(args, "task_id", true)!, provider));
      const [, type] = kinds.find(([suffix]) => prefix + suffix === name)!;
      const mode = stringArg(args, "mode") as ExecutionMode | undefined;
      const wait = booleanArg(args, "wait");
      const job = await manager.submit({
        provider, type, prompt: stringArg(args, type === "plan-review" ? "plan" : "prompt", true)!,
        cwd: stringArg(args, "cwd"), files: filesArg(args), mode,
        timeoutMs: numberArg(args, "timeout_ms", 7200000, 1, 2147483647),
      });
      return response(wait ? await manager.wait(job.id, job.timeoutMs + 5000, provider) : job);
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : error}` }], isError: true };
    }
  });
  let shutdown: Promise<void> | undefined;
  const close = () => shutdown ??= manager.close().then(() => server.close());
  server.onclose = () => { void close(); };
  process.once("SIGINT", () => { void close().then(() => process.exit(0)); });
  process.once("SIGTERM", () => { void close().then(() => process.exit(0)); });
  process.stdin.once("end", () => { void close(); });
  await server.connect(new StdioServerTransport());
  console.error(`[${provider}-delegate] Ready. Job state: ${manager.store.root}`);
}
