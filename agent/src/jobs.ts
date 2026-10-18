import { randomUUID } from "node:crypto";
import { atomicWrite, JobStore, processIdentity, resolveProject } from "./jobStore.js";
import { runProvider } from "./runner.js";
import { DEFAULT_TIMEOUT_MS, isFinished, Job, JobStatus, providerLabel, Provider, TaskRequest } from "./tasks.js";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
interface ActiveJob {
  controller: AbortController;
  done: Promise<void>;
  stop?: { status: JobStatus; error: string };
}

export class JobManager {
  readonly store: JobStore;
  private readonly active = new Map<string, ActiveJob>();
  private readonly owner = processIdentity(process.pid).then(identity => ({ ...identity, id: randomUUID() }));
  private closing = false;

  constructor(root?: string, private readonly onDiagnostic?: (text: string) => void,
    private readonly onComplete?: (job: Job) => void) {
    this.store = new JobStore(root);
  }
  async submit(request: TaskRequest): Promise<Job> {
    if (this.closing) throw new Error("Delegation server is shutting down.");
    if (!["codex", "claude", "rosalind"].includes(request.provider) || !["review", "implement", "plan-review", "custom"].includes(request.type)) throw new Error("Invalid provider or task type.");
    if (typeof request.prompt !== "string" || !request.prompt.trim()) throw new Error("A nonempty prompt is required.");
    const mode = request.mode ?? (request.type === "implement" ? "edit" : "read-only");
    if (!["read-only", "edit"].includes(mode)) throw new Error("mode must be read-only or edit.");
    if (request.files && (!Array.isArray(request.files) || request.files.some(file => typeof file !== "string" || !file.trim()))) throw new Error("files must contain nonempty paths.");
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error("timeout_ms must be an integer from 1 to 2147483647.");
    const project = await resolveProject(request.cwd);
    if (this.closing) throw new Error("Delegation server is shutting down.");
    const job: Job = {
      version: 1, id: randomUUID(), provider: request.provider, type: request.type,
      prompt: request.prompt, files: request.files, ...project, mode, timeoutMs,
      status: "running", createdAt: new Date().toISOString(), owner: await this.owner, launching: false,
    };
    await this.store.create(job);
    try {
      if (mode === "edit") await this.store.acquireEdit(job);
      if (this.closing) throw new Error("Delegation server is shutting down.");
    } catch (error) {
      job.status = "failed";
      job.cleanupConfirmed = true;
      job.endedAt = new Date().toISOString();
      job.error = String(error instanceof Error ? error.message : error);
      await this.store.write(job);
      await this.store.releaseEdit(job);
      throw error;
    }
    const active: ActiveJob = { controller: new AbortController(), done: Promise.resolve() };
    this.active.set(job.id, active);
    active.done = this.execute(job, active);
    return job;
  }
  private stop(active: ActiveJob, status: JobStatus, error: string): void {
    if (active.stop) return;
    active.stop = { status, error };
    active.controller.abort();
  }
  private async execute(job: Job, active: ActiveJob): Promise<void> {
    const timeout = setTimeout(() => this.stop(active, "failed", `${providerLabel(job.provider)} timed out after ${job.timeoutMs / 1000}s`), job.timeoutMs);
    let checking = false;
    const poll = setInterval(() => {
      if (checking) return;
      checking = true;
      this.store.cancellationRequested(job.id).then(requested => {
        if (requested) this.stop(active, "cancelled", "Cancelled by the caller.");
      }).catch(error => this.stop(active, "failed", `Cannot read cancellation state: ${error.message}`)).finally(() => { checking = false; });
    }, 250);
    try {
      job.launching = true;
      await this.store.write(job);
      const result = await runProvider(job, this.store, {
        signal: active.controller.signal,
        onSpawn: async child => { job.child = child; await this.store.write(job); },
        onDiagnostic: this.onDiagnostic,
      });
      await atomicWrite(this.store.file(job.id, "result.md"), result.output);
      job.cleanupConfirmed = result.cleanupConfirmed;
      job.sessionId = result.sessionId;
      job.exitCode = result.exitCode;
      job.status = active.stop?.status ?? (result.error ? "failed" : "completed");
      job.error = active.stop?.error ?? result.error;
    } catch (error) {
      job.status = "failed";
      job.error = String(error instanceof Error ? error.message : error);
    } finally {
      clearTimeout(timeout);
      clearInterval(poll);
      job.endedAt = new Date().toISOString();
      try {
        await this.store.write(job);
        if (job.cleanupConfirmed) await this.store.releaseEdit(job);
      } catch (error) { console.error(`[dual-agent] Cannot finalize ${job.id}: ${error}`); }
      this.active.delete(job.id);
      this.onComplete?.(job);
    }
  }
  async get(id: string, provider?: Provider): Promise<Job> {
    const job = await this.store.read(id);
    if (provider && job.provider !== provider) throw new Error(`Task ${id} belongs to ${job.provider}, not ${provider}.`);
    return this.store.reconcile(job);
  }
  async wait(id: string, waitMs: number, provider?: Provider): Promise<Job> {
    const deadline = Date.now() + waitMs;
    while (true) {
      const job = await this.get(id, provider);
      if (isFinished(job) || Date.now() >= deadline) return job;
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }
  async cancel(id: string, provider?: Provider): Promise<Job> {
    const job = await this.get(id, provider);
    if (isFinished(job)) return job;
    // The owner receives a request; only its live ChildProcess handle is signalled.
    await this.store.requestCancellation(id);
    const active = this.active.get(id);
    if (active) this.stop(active, "cancelled", "Cancelled by the caller.");
    return this.wait(id, 3000, provider);
  }
  async list(provider?: Provider, limit = 20): Promise<Job[]> {
    const jobs: Job[] = [];
    for (const id of await this.store.ids()) {
      try {
        const job = await this.store.read(id);
        if (!provider || job.provider === provider) jobs.push(await this.store.reconcile(job));
      } catch (error) { console.error(`[dual-agent] Cannot read ${id}: ${error}`); }
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const active of this.active.values()) this.stop(active, "interrupted", "Delegation server shut down; the task was not retried.");
    await Promise.all([...this.active.values()].map(active => active.done));
  }
}
