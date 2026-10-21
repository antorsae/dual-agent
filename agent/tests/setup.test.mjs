import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const codexModule = new URL("../dist/codex.js", import.meta.url).href;

async function fixture(t, missingBinaries = []) {
  const dir = await mkdtemp(join(tmpdir(), "dual-agent-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const testHome = join(dir, "managed home");
  const bin = join(dir, "bin");
  const log = join(dir, "calls.jsonl");
  await Promise.all([
    mkdir(bin), mkdir(testHome), mkdir(join(testHome, ".codex"), { recursive: true }), mkdir(join(dir, "agent", "dist"), { recursive: true }),
  ]);
  await writeFile(join(testHome, ".codex/rosalind_delegate.config.toml"), 'model = "fixture-rosalind"\n');
  for (const script of ["setup-dual-agent.sh", "uninstall-dual-agent.sh"]) {
    const source = await readFile(new URL("../../" + script, import.meta.url), "utf8");
    // Redirect managed files without changing the process HOME.
    await writeFile(join(dir, script), source.replaceAll("$HOME", "$DUAL_AGENT_TEST_HOME"));
  }
  for (const [role, skill] of [[".claude", "codex-delegate"], [".codex", "claude-delegate"], [".codex", "codex-delegate"], [".claude", "rosalind-delegate"], [".codex", "rosalind-delegate"]]) {
    const path = join(dir, role, "skills", skill);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), skill + " fixture");
  }
  await writeFile(join(dir, "agent", "dist", "mcp.js"), "");
  await writeFile(join(dir, "agent", "dist", "codexCodexMcp.js"), "");
  await writeFile(join(dir, "agent", "dist", "claudeMcp.js"), "");
  await writeFile(join(dir, "agent", "dist", "rosalindMcp.js"), "");
  await writeFile(join(dir, "agent", "dist", "rosalindCodexMcp.js"), "");
  await writeFile(join(testHome, ".claude.json"), '{"unrelated":true}');
  await writeFile(log, "");
  await symlink(process.execPath, join(bin, "node"));
  for (const command of ["bash", "dirname", "cat", "jq", "mkdir", "cp", "rm", "rmdir", "mktemp"]) {
    const result = spawnSync("bash", ["-c", 'command -v "$1"', "--", command], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${command} is required for setup tests`);
    await symlink(result.stdout.trim(), join(bin, command));
  }
  const mock = [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    'const name = require("node:path").basename(process.argv[1]);',
    "const args = process.argv.slice(2);",
    'fs.appendFileSync(process.env.DUAL_AGENT_TEST_LOG, JSON.stringify({ name, args }) + "\\n");',
    'if (["claude", "codex"].includes(name) && args[1] === "add" && process.env.DUAL_AGENT_TEST_FAIL_REGISTER === name) { console.error("registration denied"); process.exit(1); }',
    'if (process.env.DUAL_AGENT_TEST_FAIL_COMMAND === name) { console.error("fixture command failed"); process.exit(1); }',
    'if (name.startsWith("custom codex")) { process.stdin.resume(); process.stdin.on("end", () => { if (args.includes("--output-last-message")) fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], "custom executable"); }); }',
    // Mirror the table layout that codex mcp add/remove write to config.toml.
    'if (name === "codex" && args[0] === "mcp" && ["add", "remove"].includes(args[1]) && process.env.DUAL_AGENT_TEST_NO_CONFIG !== "1") {',
    '  const path = require("node:path");',
    '  const config = path.join(process.env.CODEX_HOME || path.join(process.env.DUAL_AGENT_TEST_HOME, ".codex"), "config.toml");',
    '  const table = `[mcp_servers.${args[2]}`;',
    '  const sections = (fs.existsSync(config) ? fs.readFileSync(config, "utf8") : "").split(/^(?=\\[)/m)',
    '    .filter(section => !section.startsWith(table + "]") && !section.startsWith(table + "."));',
    '  if (args[1] === "add") sections.push(`${table}]\\ncommand = "node"\\n\\n${table}.env]\\nFIXTURE = "1"\\n`);',
    '  fs.mkdirSync(path.dirname(config), { recursive: true });',
    '  fs.writeFileSync(config, sections.join(""));',
    '}',
  ].join("\n");
  const customBinary = join(bin, "custom codex $'quoted");
  for (const file of ["claude", "codex", "codex-pool", "npm", "custom codex $'quoted"]) {
    if (!missingBinaries.includes(file)) await writeFile(join(bin, file), mock, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: bin, DUAL_AGENT_TEST_HOME: testHome, DUAL_AGENT_TEST_LOG: log };
  for (const key of ["CODEX_BIN", "CLAUDE_BIN", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "DUAL_AGENT_STATE_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "DUAL_AGENT_TEST_FAIL_REGISTER", "DUAL_AGENT_TEST_FAIL_COMMAND", "DUAL_AGENT_TEST_NO_CONFIG"]) delete env[key];
  async function runScript(script, args, input, overrides, expectedStatus) {
    const result = spawnSync("bash", [join(dir, script), ...args], {
      cwd: dir, env: { ...env, ...overrides }, input, encoding: "utf8", timeout: 15000,
    });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    assert.equal(result.status, expectedStatus, output);
    const calls = (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    return { calls, output };
  }
  return {
    dir, testHome, customBinary, env,
    run: (args = [], input = "", overrides = {}, status = 0) => runScript("setup-dual-agent.sh", args, input, overrides, status),
    uninstall: (overrides = {}) => runScript("uninstall-dual-agent.sh", [], "", overrides, 0),
  };
}

function registrationEnv(calls, name, server) {
  const call = calls.find((call) => call.name === name && call.args[1] === "add" && (!server || call.args[2] === server));
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
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { env, encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("persists CODEX_BIN for a fresh delegate process", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run(["--mcp"], "", { CODEX_BIN: f.customBinary });
  const saved = registrationEnv(calls, "claude");
  assert.equal(saved.CODEX_BIN, f.customBinary);
  assert.equal(saved.DUAL_AGENT_STATE_DIR, join(f.testHome, ".local/state/dual-agent"));
  const result = runNode(
    "import { runCodex } from " + JSON.stringify(codexModule) + ";" +
    'console.log(JSON.stringify(await runCodex({ type: "custom", prompt: "test" }, { stream: false, timeout: 2000 })));',
    { ...f.env, ...saved }
  );
  assert.equal(result.success, true);
  assert.equal(result.output, "custom executable");
});

test("registers codex when codex-pool is unavailable", async (t) => {
  const f = await fixture(t, ["codex-pool"]);
  const { calls, output } = await f.run([], "1c");
  assert.match(output, /\[WARN\].*codex-pool.*falling back to codex/);
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex");
});

for (const existingConfig of [true, false]) {
  test(`registration failure stops setup with ${existingConfig ? "existing" : "missing"} Claude config`, async (t) => {
    const f = await fixture(t);
    const config = join(f.testHome, ".claude.json");
    if (!existingConfig) await rm(config);
    const { output } = await f.run(["--mcp"], "", { DUAL_AGENT_TEST_FAIL_REGISTER: "claude" }, 1);
    assert.match(output, /registration denied/);
    assert.match(output, /Could not register codex-delegate/);
    assert.doesNotMatch(output, /Setup Complete/);
    if (existingConfig) assert.equal(await readFile(config, "utf8"), '{"unrelated":true}');
    else await assert.rejects(access(config), { code: "ENOENT" });
  });
}

test("fails dependency checks when neither Codex binary is available", async (t) => {
  const f = await fixture(t, ["codex-pool", "codex"]);
  const { calls, output } = await f.run(["--mcp"], "", {}, 1);
  assert.match(output, /\[MISSING\].*codex/);
  assert.deepEqual(calls, []);
});

test("does not replace an unavailable custom CODEX_BIN", async (t) => {
  const f = await fixture(t);
  const { calls, output } = await f.run(["--mcp"], "", { CODEX_BIN: "missing-custom-codex" }, 1);
  assert.match(output, /\[MISSING\].*missing-custom-codex/);
  assert.doesNotMatch(output, /falling back/);
  assert.deepEqual(calls, []);
});

test("registers all delegation integrations from the component menu", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run([], "1234c");
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  assert.equal(registrationEnv(calls, "codex", "rosalind-delegate").CODEX_HOME, join(f.testHome, ".codex"));
  assert.equal(registrationEnv(calls, "codex", "codex-delegate").CODEX_BIN, "codex-pool");
});

test("repeated setup preserves project data and Claude settings", async (t) => {
  const f = await fixture(t);
  const paths = [join(f.dir, ".agent-collab/context/shared.md"), join(f.dir, ".agent-collab/requests/task.md"), join(f.dir, ".agent-collab/responses/response.md"), join(f.dir, ".gitignore"), join(f.testHome, ".claude/settings.json")];
  for (const path of paths) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "user data to preserve");
  }
  await f.run(["--mcp"]);
  await f.run(["--mcp"]);
  for (const path of paths) assert.equal(await readFile(path, "utf8"), "user data to preserve");
});

test("npm failures stop setup and retain diagnostics", async (t) => {
    const f = await fixture(t);
    const { output } = await f.run(["--codex-mcp"], "", { DUAL_AGENT_TEST_FAIL_COMMAND: "npm" }, 1);
    assert.match(output, /fixture command failed/);
    assert.doesNotMatch(output, /Setup Complete/);
});

test("missing build output stops setup before registration", async (t) => {
  const f = await fixture(t);
  await rm(join(f.dir, "agent/dist/mcp.js"));
  const { calls, output } = await f.run(["--mcp"], "", {}, 1);
  assert.match(output, /MCP build output not found/);
  assert.ok(!calls.some(call => call.name === "claude"));
});

test("uninstall removes legacy skills and permissions while preserving saved data", async (t) => {
  const f = await fixture(t);
  const legacySkill = join(f.testHome, ".claude/skills/codex-read");
  const settings = join(f.testHome, ".claude/settings.json");
  const saved = join(f.dir, ".agent-collab/context/shared.md");
  await mkdir(legacySkill, { recursive: true });
  await writeFile(join(legacySkill, "SKILL.md"), "legacy skill");
  await writeFile(settings, JSON.stringify({ permissions: { allow: ["Bash(tmux send-keys:*)", "Read"] }, unrelated: true }));
  await mkdir(join(saved, ".."), { recursive: true });
  await writeFile(saved, "saved context");
  await writeFile(join(f.dir, ".gitignore"), ".agent-collab/\n");
  await f.uninstall();
  await assert.rejects(access(legacySkill), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(settings, "utf8")), { permissions: { allow: ["Read"] }, unrelated: true });
  assert.equal(await readFile(saved, "utf8"), "saved context");
  assert.equal(await readFile(join(f.dir, ".gitignore"), "utf8"), ".agent-collab/\n");
});

test("uninstall removes Rosalind registrations and host skills", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.uninstall();
  assert.ok(calls.some(call => call.name === "claude" && call.args.includes("rosalind-delegate")));
  assert.ok(calls.some(call => call.name === "codex" && call.args.includes("rosalind-delegate")));
  await assert.rejects(access(join(f.testHome, ".claude/skills/rosalind-delegate")), { code: "ENOENT" });
  await assert.rejects(access(join(f.testHome, ".codex/skills/rosalind-delegate")), { code: "ENOENT" });
});

test("uninstall tolerates Claude settings with no permissions", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.testHome, ".claude"));
  const settings = join(f.testHome, ".claude/settings.json");
  await writeFile(settings, '{"unrelated":true}');
  await f.uninstall();
  assert.deepEqual(JSON.parse(await readFile(settings, "utf8")), { unrelated: true });
});


test("installs both delegation directions with the same state path", async (t) => {
  const f = await fixture(t);
  const state = join(f.dir, "shared state");
  const { calls } = await f.run(["--both"], "", { DUAL_AGENT_STATE_DIR: state });
  const forward = registrationEnv(calls, "claude");
  const reverse = registrationEnv(calls, "codex");
  assert.equal(forward.DUAL_AGENT_STATE_DIR, state);
  assert.equal(reverse.DUAL_AGENT_STATE_DIR, state);
  assert.equal(reverse.CLAUDE_BIN, join(f.dir, "bin/claude"));
  assert.equal(await readFile(join(f.testHome, ".codex/skills/claude-delegate/SKILL.md"), "utf8"), "claude-delegate fixture");
  assert.equal(await readFile(join(f.testHome, ".claude/skills/codex-delegate/SKILL.md"), "utf8"), "codex-delegate fixture");
});

test("reverse-only setup persists custom executable, config, and state directories", async (t) => {
  const f = await fixture(t, ["claude", "codex-pool"]);
  const configDir = join(f.dir, "codex config");
  const claudeConfigDir = join(f.dir, "claude config");
  const stateBase = join(f.dir, "xdg state");
  const { calls } = await f.run(["--claude-mcp"], "", {
    CLAUDE_BIN: f.customBinary, CLAUDE_CONFIG_DIR: claudeConfigDir, CODEX_HOME: configDir, XDG_STATE_HOME: stateBase,
  });
  const saved = registrationEnv(calls, "codex");
  assert.equal(saved.CLAUDE_BIN, f.customBinary);
  assert.equal(saved.CLAUDE_CONFIG_DIR, claudeConfigDir);
  assert.equal(saved.DUAL_AGENT_STATE_DIR, join(stateBase, "dual-agent"));
  await access(join(configDir, "skills/claude-delegate/SKILL.md"));
});

test("reverse registration failure stops setup", async (t) => {
  const f = await fixture(t);
  const { output } = await f.run(["--claude-mcp"], "", { DUAL_AGENT_TEST_FAIL_REGISTER: "codex" }, 1);
  assert.match(output, /Could not register claude-delegate/);
  assert.doesNotMatch(output, /Setup Complete/);
});

test("interactive Claude selection installs its MCP server and host skill independently", async (t) => {
  const f = await fixture(t, ["codex-pool"]);
  const { calls, output } = await f.run([], "2c");
  assert.match(output, /2\) \[x\] Use Claude from Codex/);
  const registrations = calls.filter(call => call.args[0] === "mcp" && call.args[1] === "add");
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "codex");
  assert.equal(registrations[0].args[2], "claude-delegate");
  assert.equal(await readFile(join(f.testHome, ".codex/skills/claude-delegate/SKILL.md"), "utf8"), "claude-delegate fixture");
  await assert.rejects(access(join(f.testHome, ".claude/skills/codex-delegate")), { code: "ENOENT" });
});

test("interactive selection can install both delegation directions", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run([], "12c");
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  assert.equal(registrationEnv(calls, "codex").CLAUDE_BIN, join(f.dir, "bin/claude"));
  await access(join(f.testHome, ".claude/skills/codex-delegate/SKILL.md"));
  await access(join(f.testHome, ".codex/skills/claude-delegate/SKILL.md"));
});

test("deselecting Claude delegation skips its registration and skill", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run([], "122c");
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  assert.ok(!calls.some(call => call.name === "codex" && call.args[1] === "add"));
  await assert.rejects(access(join(f.testHome, ".codex/skills/claude-delegate")), { code: "ENOENT" });
});

test("select all includes Claude delegation with the other integrations", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run([], "ac");
  const codexServers = calls.filter(call => call.name === "codex" && call.args[1] === "add").map(call => call.args[2]);
  assert.deepEqual(codexServers.sort(), ["claude-delegate", "codex-delegate", "rosalind-delegate"]);
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  await access(join(f.testHome, ".codex/skills/claude-delegate/SKILL.md"));
  await access(join(f.testHome, ".codex/skills/codex-delegate/SKILL.md"));
});

test("explicit Codex flag installs the same integration as the legacy alias", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run(["--codex-mcp"]);
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  await access(join(f.testHome, ".claude/skills/codex-delegate/SKILL.md"));
});

test("Rosalind registration is installed for both hosts with shared state and Codex settings", async (t) => {
  const f = await fixture(t);
  const state = join(f.dir, "rosalind state");
  const { calls } = await f.run(["--rosalind-mcp"], "", { DUAL_AGENT_STATE_DIR: state, CODEX_BIN: f.customBinary });
  const registrations = calls.filter(call => call.args[0] === "mcp" && call.args[1] === "add" && call.args.includes("rosalind-delegate"));
  assert.equal(registrations.length, 2);
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, f.customBinary);
  assert.equal(registrationEnv(calls, "codex").CODEX_BIN, f.customBinary);
  assert.equal(registrationEnv(calls, "claude").CODEX_HOME, join(f.testHome, ".codex"));
  assert.equal(registrationEnv(calls, "codex").CODEX_HOME, join(f.testHome, ".codex"));
  assert.equal(registrationEnv(calls, "claude").DUAL_AGENT_STATE_DIR, state);
  assert.equal(registrationEnv(calls, "codex").DUAL_AGENT_STATE_DIR, state);
  assert.ok(registrations.some(call => call.args.some(arg => arg.endsWith("/rosalindMcp.js"))));
  assert.ok(registrations.some(call => call.args.some(arg => arg.endsWith("/rosalindCodexMcp.js"))));
  assert.equal(await readFile(join(f.testHome, ".claude/skills/rosalind-delegate/SKILL.md"), "utf8"), "rosalind-delegate fixture");
  assert.equal(await readFile(join(f.testHome, ".codex/skills/rosalind-delegate/SKILL.md"), "utf8"), "rosalind-delegate fixture");
});

test("Rosalind setup fails before registration when its Codex profile is missing", async (t) => {
  const f = await fixture(t);
  await rm(join(f.testHome, ".codex/rosalind_delegate.config.toml"));
  const { calls, output } = await f.run(["--rosalind-mcp"], "", {}, 1);
  assert.match(output, /Rosalind Codex profile not found/);
  assert.deepEqual(calls, []);
});

test("Codex-from-Codex registers codex-delegate in Codex and forwards provider API keys", async (t) => {
  const f = await fixture(t);
  const config = join(f.testHome, ".codex/config.toml");
  await writeFile(config, 'model_provider = "pool"\n\n[model_providers.pool]\nenv_key = "POOL_API_KEY"\n');
  const { calls, output } = await f.run(["--codex-from-codex"]);
  const registrations = calls.filter(call => call.args[0] === "mcp" && call.args[1] === "add");
  assert.deepEqual(registrations.map(call => [call.name, call.args[2]]), [["codex", "codex-delegate"]]);
  assert.ok(registrations[0].args.at(-1).endsWith("/codexCodexMcp.js"));
  const saved = registrationEnv(calls, "codex", "codex-delegate");
  assert.equal(saved.CODEX_BIN, "codex-pool");
  assert.equal(saved.CODEX_HOME, join(f.testHome, ".codex"));
  assert.equal(saved.DUAL_AGENT_STATE_DIR, join(f.testHome, ".local/state/dual-agent"));
  assert.match(output, /codex-delegate API key forwarding \(POOL_API_KEY\)/);
  assert.match(await readFile(config, "utf8"), /^\[mcp_servers\.codex-delegate\]\nenv_vars = \["POOL_API_KEY"\]\ncommand = "node"$/m);
  assert.equal(await readFile(join(f.testHome, ".codex/skills/codex-delegate/SKILL.md"), "utf8"), "codex-delegate fixture");
  await assert.rejects(access(join(f.testHome, ".claude/skills/codex-delegate")), { code: "ENOENT" });
});

test("Rosalind's Codex registration forwards keys from the base config and its profile", async (t) => {
  const f = await fixture(t);
  const config = join(f.testHome, ".codex/config.toml");
  await writeFile(config, '[model_providers.pool]\nenv_key = "POOL_API_KEY"\n');
  await writeFile(join(f.testHome, ".codex/rosalind_delegate.config.toml"),
    "model_provider = 'rosalind'\nmodel_providers.rosalind = { name = 'rosalind', env_key = 'ROSALIND_KEY' }\n" +
    '[model_providers.pool]\nenv_key = "POOL_API_KEY"\n');
  await f.run(["--rosalind-mcp"]);
  assert.match(await readFile(config, "utf8"), /^\[mcp_servers\.rosalind-delegate\]\nenv_vars = \["POOL_API_KEY", "ROSALIND_KEY"\]$/m);
});

test("Codex registrations without provider API keys need no env_vars", async (t) => {
  const f = await fixture(t);
  await f.run(["--codex-from-codex"]);
  const config = await readFile(join(f.testHome, ".codex/config.toml"), "utf8");
  assert.match(config, /\[mcp_servers\.codex-delegate\]/);
  assert.doesNotMatch(config, /env_vars/);
});

test("API key forwarding fails setup when the Codex registration table is missing", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.testHome, ".codex/config.toml"), '[model_providers.pool]\nenv_key = "POOL_API_KEY"\n');
  const { output } = await f.run(["--codex-from-codex"], "", { DUAL_AGENT_TEST_NO_CONFIG: "1" }, 1);
  assert.match(output, /Could not add env_vars = \[POOL_API_KEY\] to \[mcp_servers\.codex-delegate\]/);
  assert.doesNotMatch(output, /Setup Complete/);
});

test("uninstall removes Codex-hosted Codex delegation and its skill", async (t) => {
  const f = await fixture(t);
  const installed = (await f.run(["--codex-from-codex"])).calls.length;
  await access(join(f.testHome, ".codex/skills/codex-delegate/SKILL.md"));
  const { calls } = await f.uninstall();
  assert.ok(calls.slice(installed).some(call => call.name === "codex" && call.args[1] === "remove" && call.args[2] === "codex-delegate"));
  await assert.rejects(access(join(f.testHome, ".codex/skills/codex-delegate")), { code: "ENOENT" });
  assert.doesNotMatch(await readFile(join(f.testHome, ".codex/config.toml"), "utf8"), /codex-delegate/);
});
