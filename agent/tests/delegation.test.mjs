import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JobStore, isAlive, processIdentity } from "../dist/jobStore.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = result => result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
async function eventually(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(25); }
  assert.fail("Condition was not met before timeout");
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "dual-agent-mcp-"));
  const project = join(root, "project");
  const state = join(root, "state");
  const capture = join(root, "requests.jsonl");
  const descendants = join(root, "descendants.txt");
  const binary = join(root, "fake-agent.mjs");
  await mkdir(project);
  await writeFile(capture, "");
  await writeFile(descendants, "");
  await writeFile(binary, await readFile(new URL("./fixtures/fake-agent.mjs", import.meta.url)), { mode: 0o755 });
  const clients = [];
  const env = { ...process.env, CODEX_BIN: binary, CLAUDE_BIN: binary, DUAL_AGENT_STATE_DIR: state, DUAL_AGENT_NOTIFICATIONS: "0", FAKE_CAPTURE: capture, FAKE_DESCENDANTS: descendants };
  delete env.CLAUDE_PROJECT_DIR;
  for (const key of ["DUAL_AGENT_CAPTURE", "DUAL_AGENT_EXIT", "DUAL_AGENT_DELAY", "DUAL_AGENT_OUTPUT_SIZE"]) delete env[key];
  const requests = async () => (await readFile(capture, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  t.after(async () => {
    await Promise.all(clients.map(client => client.close().catch(() => {})));
    // Test children belong exclusively to fake-agent.mjs processes created above.
    for (const request of await requests()) {
      try { process.kill(-request.pid, "SIGKILL"); } catch { /* Already stopped. */ }
    }
    await rm(root, { recursive: true, force: true });
  });
  async function connect(provider = "codex", overrides = {}, cwd = root) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL(provider === "codex" ? "../dist/mcp.js" : "../dist/claudeMcp.js", import.meta.url))],
      cwd, env: { ...env, ...overrides }, stderr: "pipe",
    });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "delegation-tests", version: "1" });
    const channelEvents = [];
    client.fallbackNotificationHandler = async notification => {
      if (notification.method === "notifications/claude/channel") channelEvents.push(notification.params);
    };
    clients.push(client);
    await client.connect(transport);
    return {
      client, transport, channelEvents,
      call: (suffix, args) => client.callTool({ name: `delegate_${provider}${suffix}`, arguments: args }),
    };
  }
  return { root, project, state, capture, requests, descendants, connect, store: new JobStore(state) };
}

for (const provider of ["codex", "claude"]) {
  test(`${provider}: discovers all tools and handles a different prompt per call`, async t => {
    const f = await fixture(t);
    const c = await f.connect(provider);
    const discovery = await c.client.listTools();
    assert.equal(discovery.tools.length, 7);
    assert.ok(discovery.tools.some(tool => tool.name === `delegate_${provider}_cancel`));
    assert.deepEqual(c.client.getServerCapabilities().experimental?.["claude/channel"], provider === "codex" ? {} : undefined);
    if (provider === "codex") assert.match(c.client.getInstructions(), /delegate_codex_status/);
    for (const [suffix, args] of [
      ["_review", { prompt: "Review first request", files: ["one.ts", "two,with-comma.ts"] }],
      ["_plan_review", { plan: "Critique the second plan" }],
      ["", { prompt: "Third independent request\nwith quotes ' and $(literal)" }],
    ]) {
      const result = await c.call(suffix, { ...args, cwd: f.project, wait: true });
      assert.equal(result.isError, false, text(result));
      const job = result.structuredContent;
      assert.equal(job.status, "completed");
      assert.equal(job.mode, "read-only");
      assert.equal(job.cwd, f.project);
      assert.equal(job.output, "fixture answer\n");
      assert.equal(job.session_id, `fixture-${provider}-session`);
      assert.match(await readFile(job.paths.stderr, "utf8"), /fixture diagnostic/);
      assert.doesNotMatch(job.output, /diagnostic|thread.started/);
      const request = (await f.requests()).at(-1);
      assert.ok(request.input.includes(args.prompt ?? args.plan));
      assert.equal(request.cwd, f.project);
      assert.ok(!request.args.some(arg => arg.includes("Third independent")));
      if (provider === "codex") {
        assert.ok(request.args.includes("read-only"));
        assert.ok(!request.args.includes("--approve-for-me"));
        assert.ok(request.args.some(arg => arg.includes("claude-delegate") && arg.includes("enabled=false")));
      } else {
        assert.equal(c.channelEvents.length, 0);
        assert.equal(request.args[request.args.indexOf("--tools") + 1], "Read,Glob,Grep");
        assert.ok(request.args.includes("--strict-mcp-config"));
        assert.ok(request.args.includes("dontAsk"));
        assert.ok(!request.args.includes("--bare"));
      }
    }
  });

  test(`${provider}: defaults an omitted cwd to the host's working directory`, async t => {
    const f = await fixture(t);
    const c = await f.connect(provider, {}, f.project);
    const result = await c.call("", { prompt: "Say hi", wait: true });
    assert.equal(result.isError, false, text(result));
    assert.equal(result.structuredContent.cwd, f.project);
    assert.equal(result.structuredContent.workspace, f.project);
    assert.equal((await f.requests())[0].cwd, f.project);
  });
}

test("validates explicit paths and prefers cwd over CLAUDE_PROJECT_DIR over the launch directory", async t => {
  const f = await fixture(t);
  const c = await f.connect();
  for (const args of [{ prompt: "test", cwd: "" }, { prompt: "test", cwd: "relative" }, { prompt: "test", cwd: f.capture }]) {
    const result = await c.call("", args);
    assert.equal(result.isError, true, text(result));
  }
  assert.equal((await f.requests()).length, 0);
  const alias = join(f.root, "project-alias");
  await symlink(f.project, alias, "dir");
  const implicit = await f.connect("codex", { CLAUDE_PROJECT_DIR: alias });
  const result = await implicit.call("", { prompt: "test", wait: true });
  assert.equal(result.structuredContent.cwd, f.project);
  const explicit = await implicit.call("", { prompt: "override the environment", cwd: f.root, wait: true });
  assert.equal(explicit.structuredContent.cwd, f.root);
  assert.equal((await f.requests()).at(-1).cwd, f.root);
});

test("Codex accepts the host-selected non-Git project in both execution modes", async t => {
  const f = await fixture(t);
  assert.notEqual(spawnSync("git", ["-C", f.project, "rev-parse", "--show-toplevel"], { stdio: "ignore" }).status, 0);
  const c = await f.connect("codex", { CLAUDE_PROJECT_DIR: f.project, FAKE_CHECK_GIT_REPO: "1" });
  for (const mode of ["read-only", "edit"]) {
    const result = await c.call("", { prompt: "Say hi", mode, wait: true });
    assert.equal(result.structuredContent.status, "completed", text(result));
    const request = (await f.requests()).at(-1);
    assert.equal(request.cwd, f.project);
    assert.ok(request.args.includes("--skip-git-repo-check"));
    assert.ok(!request.args.includes("--dangerously-bypass-approvals-and-sandbox"));
    if (mode === "read-only") {
      assert.equal(request.args[request.args.indexOf("--sandbox") + 1], "read-only");
      assert.ok(request.args.includes('approval_policy="never"'));
    } else {
      assert.ok(request.args.includes("--approve-for-me"));
    }
  }
});

test("results and task lists persist across MCP restarts", async t => {
  const f = await fixture(t);
  const first = await f.connect("claude");
  const result = await first.call("", { prompt: "test", cwd: f.project, wait: true });
  const id = result.structuredContent.task_id;
  await first.client.close();
  const second = await f.connect("claude");
  const recovered = await second.call("_status", { task_id: id });
  assert.equal(recovered.structuredContent.output, "fixture answer\n");
  const list = await second.call("_list", {});
  assert.ok(list.structuredContent.jobs.some(job => job.task_id === id));
  const wrong = await f.connect("codex");
  assert.equal((await wrong.call("_status", { task_id: id })).isError, true);
});

test("uses bounded status waiting for background jobs", async t => {
  const f = await fixture(t);
  const c = await f.connect();
  const result = await c.call("", { prompt: "[slow] test", cwd: f.project });
  assert.equal(result.structuredContent.status, "running");
  const completed = await c.call("_status", { task_id: result.structuredContent.task_id, wait_ms: 3000 });
  assert.equal(completed.structuredContent.status, "completed");
});

for (const [scenario, prompt, status, timeoutMs] of [
  ["success", "[slow] channel result", "completed"],
  ["failure", "[slow] [fail]", "failed"],
  ["timeout", "[hold]", "failed", 300],
  ["cancellation", "[hold]", "cancelled"],
  ["interruption", "[hold]", "interrupted"],
]) {
  test(`Codex channel reports ${scenario} with a retrievable saved result`, { skip: scenario === "interruption" && process.platform === "win32" }, async t => {
    const f = await fixture(t);
    const c = await f.connect();
    // Desktop notifications are disabled by the fixture; channel delivery is independent.
    const started = await c.call("", { prompt, cwd: f.project, ...(timeoutMs ? { timeout_ms: timeoutMs } : {}) });
    const id = started.structuredContent.task_id;
    assert.equal(started.structuredContent.status, "running");
    assert.match(text(started), /explicitly enabled the codex-delegate channel/);
    assert.match(text(started), /wait_ms=30000/);
    if (status === "cancelled" || status === "interrupted") {
      await eventually(async () => (await f.requests()).length === 1);
      if (status === "cancelled") await c.call("_cancel", { task_id: id });
      else process.kill(c.transport.pid, "SIGTERM");
    }
    const event = await eventually(() => c.channelEvents.find(event => event.meta.task_id === id));
    assert.equal(event.meta.task_type, "custom");
    assert.equal(event.meta.status, status);
    assert.match(event.meta.duration, /^\d+(s|m \d+s|h \d+m)$/);
    assert.ok(Object.values(event.meta).every(value => typeof value === "string"));
    assert.ok(event.content.includes(id));
    assert.match(event.content, /delegate_codex_status/);
    assert.equal((await f.store.read(id)).status, status);
    const reader = status === "interrupted" ? await f.connect() : c;
    const result = await reader.call("_status", { task_id: id });
    assert.equal(result.structuredContent.status, status);
    if (status === "completed") {
      assert.equal(result.structuredContent.output, "fixture answer\n");
      await c.client.close();
      const restarted = await f.connect();
      const recovered = await restarted.call("_status", { task_id: id });
      assert.equal(recovered.structuredContent.output, "fixture answer\n");
      assert.equal(restarted.channelEvents.length, 0, "Saved results should not replay old events");
    }
    assert.equal(c.channelEvents.filter(event => event.meta.task_id === id).length, 1);
  });
}

test("one edit lock spans both providers, symlinks, and Git subdirectories", async t => {
  const f = await fixture(t);
  const git = spawnSync("git", ["init", "-q", f.project], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const subdirectory = join(f.project, "src");
  await mkdir(subdirectory);
  const alias = join(f.root, "project-alias");
  await symlink(f.project, alias, "dir");
  const codex = await f.connect();
  const claude = await f.connect("claude");
  const first = await codex.call("_implement", { prompt: "[hold] edit", cwd: f.project });
  const id = first.structuredContent.task_id;
  await eventually(async () => (await f.requests()).length === 1);
  for (const cwd of [subdirectory, alias]) {
    const busy = await claude.call("_implement", { prompt: "conflicting edit", cwd });
    assert.equal(busy.isError, true);
    assert.ok(text(busy).includes(id));
  }
  const read = await claude.call("_review", { prompt: "independent read", cwd: subdirectory, wait: true });
  assert.equal(read.structuredContent.status, "completed");
  assert.equal(read.structuredContent.workspace, f.project);
  assert.equal((await codex.call("_cancel", { task_id: id })).structuredContent.status, "cancelled");
  const next = await claude.call("_implement", { prompt: "subsequent edit", cwd: subdirectory, wait: true });
  assert.equal(next.structuredContent.status, "completed", text(next));
  const request = (await f.requests()).at(-1);
  assert.equal(request.args[request.args.indexOf("--permission-mode") + 1], "auto");
  assert.ok(request.args.includes("Read,Glob,Grep,Edit,Write,Bash"));
});

test("another live server can cancel a job and its resistant descendants", async t => {
  const f = await fixture(t);
  const first = await f.connect();
  const other = await f.connect();
  const job = await first.call("_implement", { prompt: "[hold] [tree] [ignore-term]", cwd: f.project });
  await eventually(async () => (await readFile(f.descendants, "utf8")).trim());
  const requests = await f.requests();
  const child = await processIdentity(requests[0].pid);
  const grandchild = await processIdentity(Number((await readFile(f.descendants, "utf8")).trim()));
  const cancelled = await other.call("_cancel", { task_id: job.structuredContent.task_id });
  assert.equal(cancelled.structuredContent.status, "cancelled", text(cancelled));
  await eventually(async () => !(await isAlive(child)) && !(await isAlive(grandchild)));
  const next = await other.call("_implement", { prompt: "edit again", cwd: f.project, wait: true });
  assert.equal(next.structuredContent.status, "completed", text(next));
});

test("timeouts persist a failure and release the edit lock", async t => {
  const f = await fixture(t);
  const c = await f.connect("claude");
  const result = await c.call("_implement", { prompt: "[hold] [ignore-term]", cwd: f.project, timeout_ms: 300, wait: true });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, "failed");
  assert.match(result.structuredContent.error, /timed out/);
  const next = await c.call("_implement", { prompt: "works afterward", cwd: f.project, wait: true });
  assert.equal(next.structuredContent.status, "completed", text(next));
});

test("closing the owning server interrupts the job without retrying it", async t => {
  const f = await fixture(t);
  const c = await f.connect();
  const result = await c.call("_implement", { prompt: "[hold]", cwd: f.project });
  await eventually(async () => (await f.requests()).length === 1);
  await c.client.close();
  const next = await f.connect();
  const recovered = await next.call("_status", { task_id: result.structuredContent.task_id });
  assert.equal(recovered.structuredContent.status, "interrupted", text(recovered));
  assert.equal((await f.requests()).length, 1);
  const after = await next.call("_implement", { prompt: "new explicit task", cwd: f.project, wait: true });
  assert.equal(after.structuredContent.status, "completed", text(after));
});

for (const [provider, prompt, pattern] of [
  ["codex", "[fail]", /exited with code 7/], ["codex", "[no-result]", /without a final answer/],
  ["claude", "[denied]", /denied tool call/], ["claude", "[is-error]", /fixture answer/], ["claude", "[bad-json]", /JSON|Unexpected token/i],
]) {
  test(`reports ${provider} failure: ${prompt}`, async t => {
    const f = await fixture(t);
    const c = await f.connect(provider);
    const result = await c.call("", { prompt, cwd: f.project, wait: true });
    assert.equal(result.isError, true, text(result));
    assert.match(result.structuredContent.error, pattern);
    assert.match(await readFile(result.structuredContent.paths.stderr, "utf8"), /fixture diagnostic/);
  });
}

test("large prompts use stdin and complete results remain available beyond the MCP excerpt", async t => {
  const f = await fixture(t);
  const c = await f.connect("claude");
  const prompt = "[large] " + "long prompt ".repeat(15000);
  const result = await c.call("", { prompt, cwd: f.project, wait: true });
  assert.equal(result.structuredContent.status, "completed", text(result));
  assert.equal(result.structuredContent.truncated, true);
  assert.equal(result.structuredContent.output.length, 64000);
  assert.equal((await readFile(result.structuredContent.paths.result, "utf8")).length, 100000);
  assert.ok((await f.requests())[0].input.includes(prompt));
});

test("invalid tool arguments cannot spawn a worker or traverse the job directory", async t => {
  const f = await fixture(t);
  const c = await f.connect();
  for (const [suffix, args] of [
    ["", { prompt: "", cwd: f.project }], ["", { prompt: "test", cwd: f.project, mode: "full-access" }],
    ["", { prompt: "test", cwd: f.project, timeout_ms: -1 }], ["", { prompt: "test", cwd: f.project, wait: "yes" }],
    ["", { prompt: "test", cwd: f.project, files: [1] }], ["", { prompt: "test", cwd: f.project, directory: f.project }],
    ["_status", { task_id: "../../escape" }], ["_status", { task_id: randomUUID(), wait_ms: 60000 }],
  ]) {
    const result = await c.call(suffix, args);
    assert.equal(result.isError, true, text(result));
  }
  assert.equal((await f.requests()).length, 0);
});

async function staleJob(f, extra = {}) {
  const owner = { ...await processIdentity(process.pid), id: randomUUID(), token: "a-previous-process-on-this-pid" };
  const job = {
    version: 1, id: randomUUID(), provider: "codex", type: "implement", prompt: "old task", cwd: f.project,
    workspace: f.project, mode: "edit", timeoutMs: 7200000, status: "running", createdAt: new Date().toISOString(),
    owner, launching: false, ...extra,
  };
  await f.store.create(job);
  await f.store.acquireEdit(job);
  return job;
}

test("dead owners are reconciled and stale-lock recovery never admits two editors", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t);
  const stale = await staleJob(f);
  const a = await f.connect();
  const b = await f.connect("claude");
  const recovered = await a.call("_status", { task_id: stale.id });
  assert.equal(recovered.structuredContent.status, "interrupted");
  const results = await Promise.all([
    a.call("_implement", { prompt: "[hold]", cwd: f.project }),
    b.call("_implement", { prompt: "[hold]", cwd: f.project }),
  ]);
  assert.equal(results.filter(result => !result.isError).length, 1);
  const winner = results.findIndex(result => !result.isError);
  await [a, b][winner].call("_cancel", { task_id: results[winner].structuredContent.task_id });
});

test("an orphaned live worker keeps its lock and is never killed using stored PID data", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t);
  const orphan = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  const child = await processIdentity(orphan.pid);
  t.after(() => { try { process.kill(-orphan.pid, "SIGKILL"); } catch {} });
  const stale = await staleJob(f, { launching: true, child });
  const c = await f.connect();
  const status = await c.call("_status", { task_id: stale.id });
  assert.equal(status.structuredContent.status, "interrupted");
  assert.match(status.structuredContent.error, /lock is retained/);
  const cancelled = await c.call("_cancel", { task_id: stale.id });
  assert.equal(cancelled.structuredContent.status, "interrupted");
  assert.equal(await isAlive(child), true);
  assert.equal((await c.call("_implement", { prompt: "must wait", cwd: f.project })).isError, true);
  orphan.kill("SIGKILL");
  await new Promise(resolve => orphan.once("exit", resolve));
  const next = await c.call("_implement", { prompt: "now safe", cwd: f.project, wait: true });
  assert.equal(next.structuredContent.status, "completed", text(next));
});

test("a corrupt edit lock fails closed", async t => {
  const f = await fixture(t);
  await f.store.init();
  const path = join(f.state, "locks", createHash("sha256").update(f.project).digest("hex") + ".json");
  await writeFile(path, "not valid JSON");
  const c = await f.connect();
  assert.equal((await c.call("_implement", { prompt: "edit", cwd: f.project })).isError, true);
  assert.equal((await f.requests()).length, 0);
  assert.equal(await readFile(path, "utf8"), "not valid JSON");
});

test("a missing executable produces a saved failure and frees its edit lock", async t => {
  const f = await fixture(t);
  const broken = await f.connect("claude", { CLAUDE_BIN: join(f.root, "does-not-exist") });
  const result = await broken.call("_implement", { prompt: "edit", cwd: f.project, wait: true });
  assert.equal(result.structuredContent.status, "failed");
  assert.match(result.structuredContent.error, /ENOENT/);
  const working = await f.connect("claude");
  const next = await working.call("_implement", { prompt: "edit", cwd: f.project, wait: true });
  assert.equal(next.structuredContent.status, "completed", text(next));
});
