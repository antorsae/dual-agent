export type Provider = "codex" | "claude" | "rosalind";
export type CodexProvider = "codex" | "rosalind";
export type TaskType = "review" | "implement" | "plan-review" | "custom";
export type ExecutionMode = "read-only" | "edit";
export type JobStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface TaskRequest {
  provider: Provider;
  type: TaskType;
  prompt: string;
  files?: string[];
  cwd?: string;
  mode?: ExecutionMode;
  timeoutMs?: number;
}

export interface ProcessIdentity {
  pid: number;
  host: string;
  token?: string;
}

export interface Job {
  version: 1;
  id: string;
  provider: Provider;
  type: TaskType;
  prompt: string;
  files?: string[];
  cwd: string;
  workspace: string;
  mode: ExecutionMode;
  timeoutMs: number;
  status: JobStatus;
  createdAt: string;
  endedAt?: string;
  owner: ProcessIdentity & { id: string };
  launching: boolean;
  child?: ProcessIdentity;
  cleanupConfirmed?: boolean;
  error?: string;
  sessionId?: string;
  exitCode?: number | null;
}

export const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const isFinished = (job: Job): boolean => job.status !== "running";
export const isCodexProvider = (provider: Provider): provider is CodexProvider => provider === "codex" || provider === "rosalind";

export function providerLabel(provider: Provider): string {
  return provider === "claude" ? "Claude" : provider === "rosalind" ? "Rosalind" : "Codex";
}

export function buildPrompt(task: Pick<Job, "type" | "prompt" | "files" | "mode">): string {
  const instructions: Record<TaskType, string> = {
    review: "Review the code for concrete defects and the user's specific concerns. Prioritize findings and cite file/line references.",
    implement: "Implement the request following existing project patterns. Run relevant checks and report changes, verification, and unresolved issues.",
    "plan-review": "Critically review the plan, prioritizing the user's concerns. Identify missing cases, risks, and simpler alternatives with actionable feedback.",
    custom: "Carry out the user's task and report the result and any limitations.",
  };
  const files = task.files?.length ? `\n\n## Files\n\n${task.files.map(file => `- ${file}`).join("\n")}\n\nRead these files as context.` : "";
  return `# Task: ${task.type.toUpperCase()}\n\n${instructions[task.type]}\n\n` +
    `Complete this task yourself. Do not delegate to another agent or start another Claude/Codex session.\n` +
    (task.mode === "read-only" ? "This is a read-only task: do not modify project files.\n" : "Edit only what this task requires.\n") +
    `\n## Request\n\n${task.prompt}${files}`;
}
