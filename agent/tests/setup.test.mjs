import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

const settingsModule = new URL("../dist/chatgptSettings.js", import.meta.url).href;
const codexModule = new URL("../dist/codex.js", import.meta.url).href;

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dual-agent-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const testHome = join(dir, "managed home");
  const bin = join(dir, "bin");
  const log = join(dir, "calls.jsonl");
  await Promise.all([
    mkdir(bin),
    mkdir(testHome),
    mkdir(join(dir, "agent", "dist"), { recursive: true }),
  ]);
  const source = await readFile(new URL("../../setup-dual-agent.sh", import.meta.url), "utf8");
  // Redirect installer-managed files in a copy, without changing process HOME.
  await writeFile(join(dir, "setup.sh"), source.replaceAll("$HOME", "$DUAL_AGENT_TEST_HOME"));
  await writeFile(join(dir, "agent", "dist", "mcp.js"), "");
  await writeFile(join(dir, "agent", "dist", "chatgptProMcp.js"), "");
  await writeFile(join(testHome, ".claude.json"), '{"unrelated":true}');
  const mock = [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    'const name = require("node:path").basename(process.argv[1]);',
    "const args = process.argv.slice(2);",
    'fs.appendFileSync(process.env.DUAL_AGENT_TEST_LOG, JSON.stringify({ name, args }) + "\\n");',
    'if (name === "claude" && args[1] === "add" && process.env.DUAL_AGENT_TEST_FAIL_CLAUDE === "1") process.exit(1);',
    'if (name.startsWith("custom codex")) process.stdout.write("custom executable");',
  ].join("\n");
  const customBinary = join(bin, "custom codex $'quoted");
  for (const file of ["claude", "codex", "codex-pool", "npm", "npx", "custom codex $'quoted"]) {
    await writeFile(join(bin, file), mock, { mode: 0o755 });
  }
  const env = {
    ...process.env,
    PATH: bin + delimiter + process.env.PATH,
    DUAL_AGENT_TEST_HOME: testHome,
    DUAL_AGENT_TEST_LOG: log,
  };
  delete env.CODEX_BIN;
  delete env.CODEX_HOME;
  delete env.DUAL_AGENT_TEST_FAIL_CLAUDE;
  return {
    dir, testHome, customBinary, env,
    async run(args, input, overrides = {}) {
      const result = spawnSync("bash", [join(dir, "setup.sh"), ...args], {
        cwd: dir, env: { ...env, ...overrides }, input, encoding: "utf8", timeout: 15000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    },
  };
}

function registrationEnv(calls, name) {
  const call = calls.find((call) => call.name === name && call.args[1] === "add");
  assert.ok(call, "expected an MCP registration");
  const env = {};
  for (let i = 0; i < call.args.length; i++) {
    if (call.args[i] !== "--env") continue;
    const entry = call.args[++i];
    const separator = entry.indexOf("=");
    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

function runNode(code, env) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
    env, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("persists CODEX_BIN for a fresh delegate process", async (t) => {
  const f = await fixture(t);
  const calls = await f.run([], "2c", { CODEX_BIN: f.customBinary });
  const saved = registrationEnv(calls, "claude");
  assert.equal(saved.CODEX_BIN, f.customBinary);
  const result = runNode(
    "import { runCodex } from " + JSON.stringify(codexModule) + ";" +
    'console.log(JSON.stringify(await runCodex({ type: "custom", prompt: "test" }, { stream: false, timeout: 2000 })));',
    { ...f.env, ...saved }
  );
  assert.equal(result.success, true);
  assert.equal(result.output, "custom executable");
});

test("persists CODEX_BIN in the JSON fallback", async (t) => {
  const f = await fixture(t);
  await f.run([], "2c", { CODEX_BIN: f.customBinary, DUAL_AGENT_TEST_FAIL_CLAUDE: "1" });
  const config = JSON.parse(await readFile(join(f.testHome, ".claude.json"), "utf8"));
  assert.equal(config.unrelated, true);
  assert.equal(config.mcpServers["codex-delegate"].env.CODEX_BIN, f.customBinary);
});

test("passes a custom CODEX_HOME to a fresh worker process", async (t) => {
  const f = await fixture(t);
  const configDir = join(f.dir, "custom codex config");
  await mkdir(configDir);
  await writeFile(join(configDir, "config.toml"), [
    'model = "gpt-6-astra"',
    'model_reasoning_effort = "low"',
    'service_tier = "ultrafast"',
  ].join("\n"));
  const calls = await f.run(["--pro-worker"], "", { CODEX_HOME: configDir });
  const saved = registrationEnv(calls, "codex");
  assert.equal(saved.CODEX_HOME, configDir);
  const settings = runNode(
    "import { loadChatGptSettings } from " + JSON.stringify(settingsModule) + ";" +
    "console.log(JSON.stringify(await loadChatGptSettings()));",
    { ...f.env, ...saved }
  );
  assert.equal(settings.model.value, "gpt-6-astra");
  assert.equal(settings.effort.value, "low");
  assert.equal(settings.speed.value, "ultrafast");
  assert.equal(settings.source, join(configDir, "config.toml"));
});

test("registers explicit defaults when overrides are unset", async (t) => {
  const f = await fixture(t);
  const calls = await f.run([], "25c");
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  assert.equal(registrationEnv(calls, "codex").CODEX_HOME, join(f.testHome, ".codex"));
});
