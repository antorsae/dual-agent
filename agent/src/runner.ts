import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import { isCodexProvider, Job, buildPrompt, ProcessIdentity, providerLabel } from "./tasks.js";
import { JobStore, processIdentity } from "./jobStore.js";

const execFileAsync = promisify(execFile);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export interface RunResult {
  output: string;
  sessionId?: string;
  exitCode: number | null;
  error?: string;
  cleanupConfirmed: boolean;
}

export function commandFor(job: Job, store: JobStore): { command: string; args: string[] } {
  if (isCodexProvider(job.provider)) {
    const profile = job.provider === "rosalind" ? "rosalind_delegate" : job.provider === "gemini" ? "gemini" : undefined;
    return {
      command: process.env.CODEX_BIN || "codex-pool",
      args: ["exec", ...(profile ? ["-p", profile] : []),
        ...(job.mode === "edit" ? ["--approve-for-me"] : ["--sandbox", "read-only", "-c", 'approval_policy="never"']),
        // The host selected this project; allow non-Git directories without
        // changing the job's sandbox or approval policy.
        "--skip-git-repo-check",
        "--json", "--output-last-message", store.file(job.id, "answer.tmp"),
        // Complete disabled entries also work when these servers aren't registered.
        "-c", 'mcp_servers.claude-delegate={command="node",args=[],enabled=false}',
        "-c", 'mcp_servers.codex-delegate={command="node",args=[],enabled=false}',
        "-c", 'mcp_servers.rosalind-delegate={command="node",args=[],enabled=false}',
        "-c", 'mcp_servers.gemini-delegate={command="node",args=[],enabled=false}', "-"],
    };
  }
  return {
    command: process.env.CLAUDE_BIN || "claude",
    // json prints nothing until the answer, so a working job looks stalled.
    // stream-json emits events every few seconds, even while Claude thinks.
    args: ["--print", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--disable-slash-commands", "--no-chrome", "--permission-prompts", "none",
      "--permission-mode", job.mode === "edit" ? "auto" : "dontAsk",
      "--tools", job.mode === "edit" ? "Read,Glob,Grep,Edit,Write,Bash" : "Read,Glob,Grep",
      // dontAsk denies reads outside cwd. Like Codex's read-only sandbox, let
      // read-only jobs read anywhere; this Read rule also covers Glob and Grep.
      ...(job.mode === "edit" ? [] : ["--allowedTools", "Read(//**)"])],
  };
}

async function stopTree(proc: ChildProcess): Promise<boolean> {
  if (!proc.pid) return true;
  if (process.platform === "win32") {
    try { await execFileAsync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]); return true; }
    catch { return proc.exitCode !== null || proc.signalCode !== null; }
  }
  try { process.kill(-proc.pid, "SIGTERM"); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  await delay(500);
  try { process.kill(-proc.pid, "SIGKILL"); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

export async function runProvider(job: Job, store: JobStore, options: {
  signal: AbortSignal;
  onSpawn: (identity: ProcessIdentity) => Promise<void>;
  onDiagnostic?: (text: string) => void;
}): Promise<RunResult> {
  const { command, args } = commandFor(job, store);
  const proc = spawn(command, args, {
    cwd: job.cwd, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  let problem: Error | undefined;
  let cleanup: Promise<boolean> | undefined;
  const stop = () => cleanup ??= stopTree(proc);
  const abort = () => { void stop(); };
  options.signal.addEventListener("abort", abort, { once: true });
  const closed = new Promise<{ code: number | null }>(resolve => {
    proc.once("error", error => { problem = error; });
    proc.once("exit", () => { void stop(); });
    proc.once("close", code => resolve({ code }));
  });
  proc.stdin.on("error", error => {
    if ((error as NodeJS.ErrnoException).code !== "EPIPE") problem = error;
  });
  if (options.onDiagnostic) proc.stderr.on("data", chunk => options.onDiagnostic!(chunk.toString()));

  let sessionId: string | undefined;
  let claudeResult: { result?: unknown; session_id?: unknown; is_error?: unknown; permission_denials?: unknown } | undefined;
  let pendingLine = "";
  const decoder = new StringDecoder("utf8");
  const parseLine = (line: string) => {
    try {
      const event = JSON.parse(line);
      if (isCodexProvider(job.provider)) {
        if (event.type === "thread.started" && typeof event.thread_id === "string") sessionId = event.thread_id;
      } else if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string") {
        sessionId = event.session_id;
      } else if (event.type === "result") claudeResult = event;
    } catch { /* Full raw output remains in stdout.log. */ }
  };
  proc.stdout.on("data", chunk => {
    const lines = decoder.write(chunk).split("\n");
    lines[0] = pendingLine + lines[0];
    pendingLine = lines.pop()!;
    lines.forEach(parseLine);
    // Claude's final answer is one line; drop only pathological lines.
    if (pendingLine.length > 32 * 1024 * 1024) pendingLine = "";
  });
  const outputs = [
    pipeline(proc.stdout, createWriteStream(store.file(job.id, "stdout.log"), { mode: 0o600 })),
    pipeline(proc.stderr, createWriteStream(store.file(job.id, "stderr.log"), { mode: 0o600 })),
  ].map(promise => promise.catch(error => { problem = error; void stop(); }));
  try {
    await new Promise<void>((resolve, reject) => { proc.once("spawn", resolve); proc.once("error", reject); });
    await options.onSpawn(await processIdentity(proc.pid!));
    if (options.signal.aborted) await stop();
    else proc.stdin.end(buildPrompt(job));
  } catch (error) {
    problem = error instanceof Error ? error : new Error(String(error));
    await stop();
  }
  const { code } = await closed;
  const cleanupConfirmed = await stop();
  await Promise.all(outputs);
  parseLine(pendingLine + decoder.end());
  options.signal.removeEventListener("abort", abort);

  let output = "";
  if (!problem) {
    try {
      if (isCodexProvider(job.provider)) {
        output = await readFile(store.file(job.id, "answer.tmp"), "utf8").catch(error => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
          throw error;
        });
      } else {
        const result = claudeResult;
        if (!result || typeof result.result !== "string") throw new Error("Claude returned no JSON result; see stdout.log.");
        output = result.result;
        if (typeof result.session_id === "string") sessionId = result.session_id;
        if (result.is_error) problem = new Error(output || "Claude reported a task error.");
        else if (Array.isArray(result.permission_denials) && result.permission_denials.length) {
          problem = new Error(`Claude reported ${result.permission_denials.length} denied tool call(s); inspect the result for incomplete work.`);
        }
      }
    } catch (error) { problem = error instanceof Error ? error : new Error(String(error)); }
  }
  if (!problem && code !== 0) problem = new Error(`${providerLabel(job.provider)} exited with code ${code}`);
  if (!problem && !output.trim()) problem = new Error(`${providerLabel(job.provider)} exited without a final answer; see stdout.log and stderr.log.`);
  if (!cleanupConfirmed) problem = new Error("Worker process cleanup could not be confirmed; the edit lock is retained.");
  return { output, sessionId, exitCode: code, error: problem?.message, cleanupConfirmed };
}
