/**
 * Codex CLI wrapper - spawns codex as subprocess
 */
export type TaskType = "review" | "implement" | "plan-review" | "custom";
export interface CodexTask {
    type: TaskType;
    prompt: string;
    files?: string[];
    cwd?: string;
}
export interface CodexResult {
    success: boolean;
    output: string;
    error?: string;
}
/**
 * Run Codex CLI with the given prompt
 */
export declare function runCodex(task: CodexTask, options?: {
    stream?: boolean;
    timeout?: number;
}): Promise<CodexResult>;
/**
 * Run Codex and write result to a file (for .agent-collab integration)
 */
export declare function runCodexToFile(task: CodexTask, outputFile: string, options?: {
    stream?: boolean;
    timeout?: number;
}): Promise<CodexResult>;
