/** Standalone Codex CLI adapter, sharing durable jobs and workspace locks with MCP. */
import { writeFile } from "node:fs/promises";
import { JobManager } from "./jobs.js";
import type { ExecutionMode, TaskType } from "./tasks.js";
export type { TaskType } from "./tasks.js";

export interface CodexTask {
  type: TaskType;
  prompt: string;
  files?: string[];
  cwd?: string;
  mode?: ExecutionMode;
}
export interface CodexResult {
  success: boolean;
  output: string;
  error?: string;
}
export async function runCodex(task: CodexTask, options: {
  stream?: boolean; timeout?: number; onProgress?: (lines: number) => void;
} = {}): Promise<CodexResult> {
  const { stream = true, timeout = 7200000, onProgress } = options;
  let lines = 0;
  const manager = new JobManager(undefined, text => {
    lines += text.split("\n").length - 1;
    onProgress?.(lines);
    if (stream) process.stderr.write(text);
  });
  try {
    const job = await manager.submit({ ...task, provider: "codex", cwd: task.cwd ?? process.cwd(), timeoutMs: timeout });
    const finished = await manager.wait(job.id, timeout + 5000);
    const output = await manager.store.result(job.id);
    if (stream && output) await new Promise<void>((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
    return { success: finished.status === "completed", output, error: finished.error };
  } catch (error) {
    return { success: false, output: "", error: error instanceof Error ? error.message : String(error) };
  } finally { await manager.close(); }
}
export async function runCodexToFile(task: CodexTask, outputFile: string, options: {
  stream?: boolean; timeout?: number;
} = {}): Promise<CodexResult> {
  const result = await runCodex(task, options);
  await writeFile(outputFile, `# Codex Response\n\n## Task Type\n${task.type.toUpperCase()}\n\n## Status\n${result.success ? "SUCCESS" : "FAILED"}\n\n## Output\n\n${result.output}\n${result.error ? `\n## Error\n\n${result.error}\n` : ""}`);
  return result;
}
