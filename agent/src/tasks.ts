export type Provider = "codex" | "claude" | "rosalind" | "agy" | "gemini";
export type CodexProvider = "codex" | "rosalind" | "gemini";
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
  scratch?: string;
  model?: string;
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
export const isCodexProvider = (provider: Provider): provider is CodexProvider => provider === "codex" || provider === "rosalind" || provider === "gemini";

export function providerLabel(provider: Provider): string {
  return { codex: "Codex", claude: "Claude", rosalind: "Rosalind", agy: "Antigravity", gemini: "Gemini (legacy)" }[provider];
}

export const providerMatches = (stored: Provider, requested: Provider): boolean => stored === requested || (requested === "agy" && stored === "gemini");

export function buildPrompt(task: Pick<Job, "type" | "prompt" | "files" | "mode" | "scratch" | "provider" | "cwd">): string {
  const instructions: Record<TaskType, string> = {
    review: "Review the code for concrete defects and the user's specific concerns. Prioritize findings and cite file/line references.",
    implement: "Implement the request following existing project patterns. Run relevant checks and report changes, verification, and unresolved issues.",
    "plan-review": "Critically review the plan, prioritizing the user's concerns. Identify missing cases, risks, and simpler alternatives with actionable feedback.",
    custom: "Carry out the user's task and report the result and any limitations.",
  };
  const files = task.files?.length ? `\n\n## Files\n\n${task.files.map(file => `- ${file}`).join("\n")}\n\nRead these files as context.` : "";
  return `# Task: ${task.type.toUpperCase()}\n\n${instructions[task.type]}\n\n` +
    `Complete this task yourself. Do not delegate, use subagents, schedule work, or start another agent session.\n` +
    (task.provider === "agy" ? `The user's project is ${JSON.stringify(task.cwd)}. Resolve relative file paths against it. Read its project instructions (AGENTS.md, CLAUDE.md, or GEMINI.md) when present.\n` : "") +
    (task.mode === "read-only" ? "This is a read-only task: do not modify project files.\n" : "Edit only what this task requires.\n") +
    (task.scratch ? `You may run tests and experiments in the writable scratch directory: ${JSON.stringify(task.scratch)}.\n` +
      "The original workspace remains read-only. Write test outputs in scratch. Temporary files, common caches, Python bytecode, pytest cache, and coverage data are redirected there. " +
      "For tools that write beside source files, redirect their output or copy the necessary files into scratch. " +
      "Do not patch the original workspace or switch to edit mode just to run tests. Report the commands run and any remaining test limitations.\n" : "") +
    `\n## Request\n\n${task.prompt}${files}`;
}
