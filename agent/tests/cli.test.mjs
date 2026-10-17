import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dual-agent-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binary = join(dir, "fake codex $'quoted");
  const capture = join(dir, "capture.json");
  await writeFile(binary, await readFile(new URL("./fixtures/fake-agent.mjs", import.meta.url), "utf8"), { mode: 0o755 });
  return {
    dir, capture,
    run(args, overrides = {}) {
      const env = { ...process.env, CODEX_BIN: binary, DUAL_AGENT_STATE_DIR: join(dir, "state"), DUAL_AGENT_CAPTURE: capture, DUAL_AGENT_EXIT: "0", DUAL_AGENT_DELAY: "0", DUAL_AGENT_OUTPUT_SIZE: "", ...overrides };
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: "utf8", timeout: 5000 });
      assert.ifError(result.error);
      return result;
    },
    args: async () => JSON.parse(await readFile(capture, "utf8")),
  };
}

for (const optionPosition of ["before", "after"]) {
  test(`handles file, output and buffering options ${optionPosition} the prompt`, async (t) => {
    const f = await fixture(t);
    const output = join(f.dir, "review output.md");
    const options = ["--files", "src/one.ts, src/two.ts", "--output", output, "--no-stream", "--timeout", "3000"];
    const task = ["review", "Review quotes ' and `literal` $(literal)\nand newlines"];
    const result = f.run(optionPosition === "before" ? [...options, ...task] : [...task, ...options]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "fixture answer\n");
    const capture = await f.args();
    assert.deepEqual(capture.args.slice(0, 3), ["exec", "--sandbox", "read-only"]);
    const args = [null, null, capture.input];
    assert.match(args[2], /# Task: REVIEW/);
    assert.ok(args[2].includes(task[1]));
    assert.match(args[2], /- src\/one.ts\n- src\/two.ts/);
    assert.doesNotMatch(args[2], /--files|--output|--timeout|--no-stream/);
    assert.match(await readFile(output, "utf8"), /SUCCESS[\s\S]*fixture answer/);
  });
}

test("custom prompts are not reinterpreted as a task type", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run(["custom", "review"]).status, 0);
  assert.match((await f.args()).input, /## Request\n\nreview$/);
});

test("flushes a large buffered result before exiting", async (t) => {
  const f = await fixture(t);
  const result = f.run(["custom", "fixture", "--no-stream"], { DUAL_AGENT_OUTPUT_SIZE: "262144" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "x".repeat(262144));
});

test("accepts literal dash-prefixed prompts after --", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run(["custom", "--no-stream", "--", "--literal prompt"]).status, 0);
  assert.match((await f.args()).input, /## Request\n\n--literal prompt$/);
});

test("loads a Markdown plan-review and every file in its Files section", async (t) => {
  const f = await fixture(t);
  const path = join(f.dir, "task.md");
  await writeFile(path, "# Task\r\n\r\n## Task Type: plan-review\r\n\r\n## Files\r\n- src/one.ts\r\n- src/two.ts\r\n\r\n## Request\r\nReview the migration\r\n");
  const result = f.run(["--file", path]);
  assert.equal(result.status, 0, result.stderr);
  const prompt = (await f.args()).input;
  assert.match(prompt, /^# Task: PLAN-REVIEW/);
  assert.match(prompt, /## Files\n\n- src\/one.ts\n- src\/two.ts\n\nRead these files/);
});

for (const args of [
  ["review", "fixture", "--unknown"], ["review", "fixture", "--files"],
  ["review", "fixture", "--timeout", "oops"], ["review", "fixture", "--timeout", "0"],
  ["review", "fixture", "--timeout=-1"], ["review", "fixture", "--timeout", "1.5"],
  ["review", "fixture", "--timeout", "2147483648"],
  ["review", "fixture", "--file", "task.md"],
]) {
  test(`rejects invalid arguments before spawning Codex: ${args.join(" ")}`, async (t) => {
    const f = await fixture(t);
    const result = f.run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /error/i);
    await assert.rejects(access(f.capture), { code: "ENOENT" });
  });
}

test("honors a timeout placed after the prompt", async (t) => {
  const f = await fixture(t);
  const result = f.run(["custom", "fixture", "--timeout", "200"], { DUAL_AGENT_DELAY: "2000" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Codex timed out after 0.2s/);
});

test("reports a subprocess failure while preserving buffered output", async (t) => {
  const f = await fixture(t);
  const result = f.run(["custom", "fixture", "--no-stream"], { DUAL_AGENT_EXIT: "7" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "fixture answer\n");
  assert.match(result.stderr, /Codex exited with code 7/);
});

test("custom edit mode and cwd are explicit and share the job engine", async t => {
  const f = await fixture(t);
  const result = f.run(["custom", "bounded edit", "--mode", "edit", "--cwd", f.dir]);
  assert.equal(result.status, 0, result.stderr);
  const captured = await f.args();
  assert.equal(captured.cwd, f.dir);
  assert.ok(captured.args.includes("--approve-for-me"));
  assert.ok(!captured.args.includes("read-only"));
});
