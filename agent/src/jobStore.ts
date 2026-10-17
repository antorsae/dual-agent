import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { hostname, homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { link, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Job, ProcessIdentity, UUID_PATTERN } from "./tasks.js";

const execFileAsync = promisify(execFile);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const exists = (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST";

async function linuxProcess(pid: number): Promise<{ token: string; dead: boolean }> {
  const [raw, boot] = await Promise.all([
    readFile(`/proc/${pid}/stat`, "utf8"), readFile("/proc/sys/kernel/random/boot_id", "utf8"),
  ]);
  const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
  return { token: `${boot.trim()}:${fields[19]}`, dead: ["Z", "X"].includes(fields[0]) };
}

export async function processIdentity(pid: number): Promise<ProcessIdentity> {
  const identity: ProcessIdentity = { pid, host: hostname() };
  if (process.platform === "linux") {
    identity.token = await linuxProcess(pid).then(p => p.token).catch(() => undefined);
  }
  return identity;
}

export async function isAlive(identity: ProcessIdentity): Promise<boolean> {
  // A shared directory on another host cannot safely establish local ownership.
  if (identity.host !== hostname()) return true;
  if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0) return true;
  try { process.kill(identity.pid, 0); }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  if (process.platform === "linux") {
    try {
      const current = await linuxProcess(identity.pid);
      return !current.dead && (!identity.token || current.token === identity.token);
    } catch (error) { return !missing(error); }
  }
  return true;
}

export async function workerMayBeAlive(job: Job): Promise<boolean> {
  if (!job.launching || job.cleanupConfirmed) return false;
  // A crash between spawn and recording its PID is ambiguous: keep the edit lock.
  if (!job.child) return true;
  if (job.child.host !== hostname()) return true;
  if (process.platform !== "win32") {
    try { process.kill(-job.child.pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return true; }
  }
  return isAlive(job.child);
}

export async function resolveProject(requested?: string): Promise<{ cwd: string; workspace: string }> {
  // Stdio hosts launch the server in the session's project directory.
  const directory = requested ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (!directory || !isAbsolute(directory)) {
    throw new Error("cwd must be an absolute project directory.");
  }
  const cwd = await realpath(directory);
  if (!(await stat(cwd)).isDirectory()) throw new Error(`Not a directory: ${cwd}`);
  let workspace = cwd;
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 5000 });
    workspace = await realpath(stdout.trim());
  } catch { /* Non-Git projects use the explicit directory as the workspace. */ }
  return { cwd, workspace };
}

export function stateDirectory(): string {
  const root = process.env.DUAL_AGENT_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "dual-agent");
  if (!isAbsolute(root)) throw new Error("DUAL_AGENT_STATE_DIR and XDG_STATE_HOME must be absolute paths.");
  return root;
}

export async function atomicWrite(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => undefined); }
}

export class JobStore {
  constructor(readonly root = stateDirectory()) {
    if (!isAbsolute(root)) throw new Error("Job state directory must be absolute.");
  }
  async init(): Promise<void> {
    await Promise.all(["jobs", "locks"].map(name => mkdir(join(this.root, name), { recursive: true, mode: 0o700 })));
  }
  directory(id: string): string {
    if (!UUID_PATTERN.test(id)) throw new Error("Invalid task ID.");
    return join(this.root, "jobs", id);
  }
  file(id: string, name: "job.json" | "result.md" | "stdout.log" | "stderr.log" | "answer.tmp" | "cancel.json"): string {
    return join(this.directory(id), name);
  }
  async create(job: Job): Promise<void> {
    await this.init();
    await mkdir(this.directory(job.id), { mode: 0o700 });
    await this.write(job);
  }
  async write(job: Job): Promise<void> {
    await atomicWrite(this.file(job.id, "job.json"), JSON.stringify(job, null, 2) + "\n");
  }
  async read(id: string): Promise<Job> {
    let job: Job;
    try { job = JSON.parse(await readFile(this.file(id, "job.json"), "utf8")); }
    catch (error) { if (missing(error)) throw new Error(`Task not found: ${id}`); throw error; }
    if (job.version !== 1 || job.id !== id || !["codex", "claude"].includes(job.provider) ||
        !["running", "completed", "failed", "cancelled", "interrupted"].includes(job.status) ||
        typeof job.workspace !== "string" || !job.owner || !Number.isSafeInteger(job.owner.pid) || job.owner.pid <= 0 ||
        (job.child && (!Number.isSafeInteger(job.child.pid) || job.child.pid <= 0))) {
      throw new Error(`Invalid job metadata: ${id}`);
    }
    return job;
  }
  async ids(): Promise<string[]> {
    await this.init();
    return (await readdir(join(this.root, "jobs"))).filter(id => UUID_PATTERN.test(id));
  }
  async result(id: string): Promise<string> {
    return readFile(this.file(id, "result.md"), "utf8").catch(error => { if (missing(error)) return ""; throw error; });
  }
  async cancellationRequested(id: string): Promise<boolean> {
    return stat(this.file(id, "cancel.json")).then(() => true).catch(error => { if (missing(error)) return false; throw error; });
  }
  async requestCancellation(id: string): Promise<void> {
    await atomicWrite(this.file(id, "cancel.json"), JSON.stringify({ requestedAt: new Date().toISOString() }) + "\n");
  }
  private lockPath(workspace: string): string {
    return join(this.root, "locks", createHash("sha256").update(workspace).digest("hex") + ".json");
  }
  private async currentLock(path: string): Promise<string | undefined> {
    try {
      const { jobId } = JSON.parse(await readFile(path, "utf8"));
      if (!UUID_PATTERN.test(jobId)) throw new Error(`Invalid workspace lock: ${path}`);
      return jobId;
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }
  private async reclaimable(id: string): Promise<boolean> {
    const job = await this.read(id);
    if (job.cleanupConfirmed) return true;
    if (await isAlive(job.owner)) return false;
    return !(await workerMayBeAlive(job));
  }
  // Serialize stale-lock deletion so two reclaimers cannot unlink a new owner's lock.
  // An interrupted recovery leaves this guard in place and fails closed for inspection.
  private async withRecovery(path: string, fn: () => Promise<void>): Promise<boolean> {
    const guard = `${path}.recovery`;
    try { await writeFile(guard, String(process.pid), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (exists(error)) return false; throw error; }
    try { await fn(); return true; }
    finally { await unlink(guard); }
  }
  async acquireEdit(job: Job): Promise<void> {
    const path = this.lockPath(job.workspace);
    const temporary = `${path}.${job.id}.tmp`;
    await writeFile(temporary, JSON.stringify({ jobId: job.id }) + "\n", { flag: "wx", mode: 0o600 });
    try {
      try { await link(temporary, path); return; }
      catch (error) { if (!exists(error)) throw error; }
      let acquired = false;
      const recovered = await this.withRecovery(path, async () => {
        const previous = await this.currentLock(path);
        if (previous && !(await this.reclaimable(previous))) return;
        if (previous) await unlink(path);
        try { await link(temporary, path); acquired = true; }
        catch (error) { if (!exists(error)) throw error; }
      });
      if (acquired) return;
      const active = await this.currentLock(path);
      throw new Error(`Workspace already has an editing job: ${active ?? "lock recovery in progress"}. ` +
        `Workspace: ${job.workspace}. ${recovered ? "Wait for it to finish or cancel it." : `Inspect an interrupted recovery at ${path}.recovery if it persists.`}`);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  async releaseEdit(job: Job): Promise<void> {
    if (job.mode !== "edit") return;
    const path = this.lockPath(job.workspace);
    await this.withRecovery(path, async () => {
      if (await this.currentLock(path) === job.id) await unlink(path);
    });
  }
  async reconcile(job: Job): Promise<Job> {
    if (job.status === "running" && !(await isAlive(job.owner))) {
      job = { ...job, status: "interrupted", endedAt: new Date().toISOString(),
        error: "The owning server stopped. This task was not automatically retried; inspect any workspace changes." };
      if (await workerMayBeAlive(job)) job.error += " Worker termination is unconfirmed; the edit lock is retained.";
      await this.write(job);
    }
    if (job.status === "interrupted" && !(await workerMayBeAlive(job))) await this.releaseEdit(job);
    return job;
  }
}
