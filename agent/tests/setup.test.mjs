import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const codexModule = new URL("../dist/codex.js", import.meta.url).href;

async function fixture(t, missingBinaries = []) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "dual-agent-setup-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const testHome = join(dir, "managed home");
  const bin = join(dir, "bin");
  const log = join(dir, "calls.jsonl");
  await Promise.all([
    mkdir(bin), mkdir(join(testHome, ".codex"), { recursive: true }), mkdir(join(dir, "agent", "dist"), { recursive: true }),
  ]);
  await writeFile(join(testHome, ".codex/rosalind_delegate.config.toml"), 'model = "fixture-rosalind"\n');
  await writeFile(join(testHome, ".codex/gemini.config.toml"), 'model = "fixture-gemini"\n');
  await mkdir(join(dir, "scripts"));
  await mkdir(join(dir, "agent/src"));
  await writeFile(join(dir, "agent/src/agyModels.mjs"), await readFile(new URL("../src/agyModels.mjs", import.meta.url)));
  for (const script of ["setup-dual-agent.sh", "uninstall-dual-agent.sh", "scripts/integrations.sh", "scripts/terminal-picker.sh", "scripts/caller-homes.sh", "scripts/setup-grid.sh", "scripts/agy-setup.sh", "scripts/installed-integrations.mjs"]) {
    const source = await readFile(new URL("../../" + script, import.meta.url), "utf8");
    // Redirect managed files without changing the process HOME.
    await writeFile(join(dir, script), source.replaceAll("$HOME", "$DUAL_AGENT_TEST_HOME"));
  }
  for (const [role, skill] of [[".claude", "codex-delegate"], [".codex", "claude-delegate"], [".codex", "codex-delegate"], [".claude", "rosalind-delegate"], [".codex", "rosalind-delegate"], [".claude", "agy-delegate"], [".codex", "agy-delegate"], [".agy", "dual-agent-review"]]) {
    const path = join(dir, role, "skills", skill);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), skill + " fixture");
  }
  for (const entrypoint of ["mcp", "codexCodexMcp", "claudeMcp", "rosalindMcp", "rosalindCodexMcp", "agyMcp", "agyCodexMcp", "reviewMcp"]) {
    await writeFile(join(dir, "agent", "dist", entrypoint + ".js"), "");
  }
  await writeFile(join(testHome, ".claude.json"), '{"unrelated":true}');
  await writeFile(log, "");
  await symlink(process.execPath, join(bin, "node"));
  for (const command of ["bash", "dirname", "jq", "mkdir", "cp", "rm", "tee", "cat"]) {
    if (missingBinaries.includes(command)) continue;
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
    'fs.appendFileSync(process.env.DUAL_AGENT_TEST_LOG, JSON.stringify({ name, args, codexHome: process.env.CODEX_HOME, claudeHome: process.env.CLAUDE_CONFIG_DIR }) + "\\n");',
    'if (["claude", "codex", "agy"].includes(name) && args[1] === "add" && process.env.DUAL_AGENT_TEST_FAIL_REGISTER === name) { console.error("registration denied"); process.exit(1); }',
    'if (process.env.DUAL_AGENT_TEST_FAIL_COMMAND === name) { console.error("fixture command failed"); process.exit(1); }',
    'if (name === "codex" && args[0] === "mcp" && args[1] === "get") {',
    '  const path = require("node:path");',
    '  const config = path.join(process.env.CODEX_HOME || path.join(process.env.DUAL_AGENT_TEST_HOME, ".codex"), "config.toml");',
    '  const content = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : "";',
    '  if (!content.includes(`[mcp_servers.${args[2]}]`)) process.exit(1);',
    '  console.log(JSON.stringify({ name: args[2] })); process.exit(0);',
    '}',
    'if (name === "claude" && args[0] === "mcp" && ["add", "remove"].includes(args[1])) {',
    '  const path = require("node:path");',
    '  const config = path.join(process.env.CLAUDE_CONFIG_DIR || process.env.DUAL_AGENT_TEST_HOME, ".claude.json");',
    '  const data = fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, "utf8")) : {};',
    '  const server = args[2] === "--scope" ? args[4] : args[2];',
    '  const changed = args[1] === "add" || Object.hasOwn(data.mcpServers || {}, server);',
    '  if (args[1] === "add") { data.mcpServers ||= {}; data.mcpServers[server] = {command:"node",env:Object.fromEntries(args.flatMap((a,i) => a === "--env" ? [[args[i+1].split("=")[0],args[i+1].split("=").slice(1).join("=")]] : []))}; }',
    '  else if (data.mcpServers) delete data.mcpServers[server];',
    '  if (changed) { fs.mkdirSync(path.dirname(config), {recursive:true}); fs.writeFileSync(config, JSON.stringify(data)); }',
    '}',
    'if (name === "agy" && args[0] === "mcp") {',
    '  const path = require("node:path");',
    '  const config = path.join(process.env.DUAL_AGENT_TEST_HOME, ".gemini/config/mcp_config.json");',
    '  const data = JSON.parse((fs.existsSync(config) && fs.readFileSync(config, "utf8")) || "{}");',
    '  if (args[1] === "add") {',
    '    const separator = args.indexOf("--"); const server = args[separator - 1];',
    '    const env = {}; for (let i = 2; i < separator - 1; i += 2) { if (args[i] !== "--env") process.exit(2); const [key, ...value] = args[i+1].split("="); env[key] = value.join("="); }',
    '    data.mcpServers ||= {}; data.mcpServers[server] = { command:args[separator+1], args:args.slice(separator+2), env };',
    '  } else if (args[1] === "remove" && Object.hasOwn(data.mcpServers || {}, args[2])) delete data.mcpServers[args[2]];',
    '  else process.exit(1);',
    '  fs.mkdirSync(path.dirname(config), {recursive:true}); fs.writeFileSync(config, JSON.stringify(data)); process.exit(0);',
    '}',
    'if (args[0] === "models") { console.log(process.env.DUAL_AGENT_TEST_MODELS ?? "fixture-model\\tFixture Model\\nother-model\\tOther Model\\ngemini-4-hydrogen-xhigh\\tHydrogen XHigh\\ngemini-4-argon-high\\tArgon High\\nclaude-opus-5-5-high\\tOpus High"); process.exit(0); }',
    'if (args.some(arg => arg.startsWith("--print="))) {',
    '  if ((process.env.DUAL_AGENT_TEST_QUOTA_MODELS || "").split(",").includes(args[args.indexOf("--model") + 1])) { console.error(\'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","code":429}\'); process.exit(3); }',
    '  console.log(JSON.stringify({ status: "SUCCESS", response: process.env.DUAL_AGENT_TEST_PROFILE_ANSWER ?? "DUAL_AGENT_PROFILE_OK" })); process.exit(0);',
    '}',
    'if (args.includes("exec")) { process.stdin.resume(); process.stdin.on("end", () => {',
    '  if (process.env.DUAL_AGENT_TEST_NO_PROFILE_ANSWER === "1") return;',
    '  const answer = process.env.DUAL_AGENT_TEST_PROFILE_ANSWER ?? (args.includes("-p") ? "DUAL_AGENT_PROFILE_OK" : "custom executable");',
    '  fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], answer);',
    '}); }',
    // Mirror the table layout that codex mcp add/remove write to config.toml.
    'if (name === "codex" && args[0] === "mcp" && ["add", "remove"].includes(args[1]) && process.env.DUAL_AGENT_TEST_NO_CONFIG !== "1") {',
    '  const path = require("node:path");',
    '  const config = path.join(process.env.CODEX_HOME || path.join(process.env.DUAL_AGENT_TEST_HOME, ".codex"), "config.toml");',
    '  const table = `[mcp_servers.${args[2]}`;',
    '  const sections = (fs.existsSync(config) ? fs.readFileSync(config, "utf8") : "").split(/^(?=\\[)/m)',
    '    .filter(section => !section.startsWith(table + "]") && !section.startsWith(table + "."));',
    '  const env = [];',
    '  for (let i = 0; i < args.length; i++) if (args[i] === "--env") { const [key, ...value] = args[++i].split("="); env.push(`${key} = ${JSON.stringify(value.join("="))}`); }',
    '  if (args[1] === "add") sections.push(`${table}]\\ncommand = "node"\\n\\n${table}.env]\\n${env.join("\\n")}\\n`);',
    '  fs.mkdirSync(path.dirname(config), { recursive: true });',
    '  fs.writeFileSync(config, sections.join(""));',
    '}',
  ].join("\n");
  const customBinary = join(bin, "custom codex $'quoted");
  for (const file of ["claude", "codex", "codex-pool", "agy", "npm", "custom codex $'quoted"]) {
    if (!missingBinaries.includes(file)) await writeFile(join(bin, file), mock, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: bin, DUAL_AGENT_TEST_HOME: testHome, DUAL_AGENT_TEST_LOG: log };
  for (const key of ["CODEX_BIN", "CLAUDE_BIN", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "DUAL_AGENT_STATE_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "DUAL_AGENT_TEST_FAIL_REGISTER", "DUAL_AGENT_TEST_FAIL_COMMAND", "DUAL_AGENT_TEST_NO_CONFIG", "CLAUDE_CODE_EFFORT_LEVEL", "ROSALIND_VERIFY_PROFILE", "GEMINI_VERIFY_PROFILE", "DUAL_AGENT_TEST_PROFILE_ANSWER", "DUAL_AGENT_TEST_NO_PROFILE_ANSWER", "DUAL_AGENT_VERBOSE", "AGY_BIN", "AGY_MODEL", "AGY_MODELS", "AGY_VERIFY_MODEL", "DUAL_AGENT_TEST_QUOTA_MODELS", "DUAL_AGENT_TEST_MODELS"]) delete env[key];
  env.AGY_MODEL = "fixture-model";
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
    grid: (keys, overrides = {}, args = []) => runScript("setup-dual-agent.sh", args, "\n" + keys, overrides, 0),
    uninstall: (overrides = {}, args = [], input = "\n", status = 0) => runScript("uninstall-dual-agent.sh", args, input, overrides, status),
  };
}

const down = "\x1b[B", right = "\x1b[C", left = "\x1b[D";
const bothDirections = ` ${down}${right} `;
const agyInBoth = `${left} ${down} `;
function gridRow(output, caller, last = false) {
  const lines = output.split("\n").filter(line => line.startsWith(caller + " ") && line.includes("["));
  assert.ok(lines.length, output);
  return lines.at(last ? -1 : 0).match(/\[[ x]\]|(?<!\S)-(?!\S)/g);
}

async function configuredHome(f, name, file, content) {
  const home = join(f.testHome, name);
  await mkdir(home, { recursive: true });
  await writeFile(join(home, file), content);
  return home;
}

function registrationEnv(calls, name, server) {
  const call = calls.find((call) => call.name === name && call.args[1] === "add" && (!server || call.args.includes(server)));
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
  const { calls, output } = await f.grid(" \n");
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
  const { calls } = await f.grid("a\n");
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  assert.equal(registrationEnv(calls, "codex", "rosalind-delegate").CODEX_HOME, join(f.testHome, ".codex"));
  assert.equal(registrationEnv(calls, "codex", "agy-delegate").AGY_MODEL, "fixture-model");
  assert.equal(registrationEnv(calls, "codex", "codex-delegate").CODEX_BIN, "codex-pool");
});

test("--for installs just the selected AGY reviewers with one shared skill and one Rosalind check", async t => {
  const f = await fixture(t, ["codex"]);
  const state = join(f.dir, "review state");
  const { calls } = await f.run(["--for", "agy=codex,claude,rosalind", "--for", "agy=codex"], "", { DUAL_AGENT_STATE_DIR: state });
  const adds = calls.filter(call => call.args[1] === "add");
  assert.deepEqual(adds.map(call => [call.name, call.args[call.args.indexOf("--") - 1], call.args.at(-1)]), [
    ["agy", "codex-delegate", "codex"], ["agy", "claude-delegate", "claude"], ["agy", "rosalind-delegate", "rosalind"],
  ]);
  for (const call of adds) assert.ok(call.args.at(-2).endsWith("/dist/reviewMcp.js"));
  assert.equal(calls.filter(call => call.args.includes("exec")).length, 1);
  assert.ok(!calls.some(call => call.args[0] === "models"));
  assert.equal(registrationEnv(calls, "agy", "rosalind-delegate").DUAL_AGENT_STATE_DIR, state);
  assert.equal(registrationEnv(calls, "agy", "claude-delegate").CLAUDE_BIN, join(f.dir, "bin/claude"));
  await access(join(f.testHome, ".gemini/antigravity-cli/skills/dual-agent-review/SKILL.md"));
  await assert.rejects(access(join(f.testHome, ".codex/skills")), { code: "ENOENT" });
});

test("grid navigation and row toggle select AGY reviewers independently", async t => {
  const f = await fixture(t);
  // Go to AGY, select its whole row, then toggle its last (AGY worker) cell off.
  const { calls, output } = await f.grid(down + down + "r" + left + " \n");
  assert.deepEqual(gridRow(output, "AGY TUI", true), ["[x]", "[x]", "[x]", "[ ]"]);
  assert.deepEqual(calls.filter(c => c.args[1] === "add").map(c => c.args.at(-1)), ["codex", "claude", "rosalind"]);
  const next = await f.grid("n\n");
  assert.deepEqual(gridRow(next.output, "AGY TUI"), ["[x]", "[x]", "[x]", "[ ]"]);
  assert.deepEqual(gridRow(next.output, "Codex"), Array(4).fill("[ ]"));
  assert.deepEqual(gridRow(next.output, "Claude Code"), ["[ ]", "-", "[ ]", "[ ]"]);
});

test("repeated --for combines cells with legacy flags and verifies each worker once", async t => {
  const f = await fixture(t);
  const { calls } = await f.run(["--for", "agy=rosalind,agy", "--rosalind-mcp", "--for", "claude=agy", "--agy-model", "other-model", "--verify-rosalind-profile"]);
  const adds = calls.filter(c => c.args[1] === "add");
  assert.deepEqual(adds.map(c => [c.name, c.args.find(a => a.endsWith("-delegate"))]), [
    ["claude", "rosalind-delegate"], ["claude", "agy-delegate"], ["codex", "rosalind-delegate"],
    ["agy", "rosalind-delegate"], ["agy", "agy-delegate"],
  ]);
  assert.equal(calls.filter(c => c.args[0] === "models").length, 1);
  assert.equal(calls.filter(c => c.args.some(arg => arg.startsWith("--print="))).length, 1);
  assert.equal(calls.filter(c => c.args.includes("exec")).length, 1);
  assert.equal(registrationEnv(calls, "agy", "agy-delegate").AGY_MODEL, "other-model");
  assert.ok(!calls.some(c => c.name === "codex" && c.args.includes("gemini-delegate")));
});

test("AGY-only worker settings are retained for later callers", async t => {
  const f = await fixture(t);
  const first = await f.run(["--agy-model", "other-model", "--for", "agy=agy,claude"], "", {CLAUDE_CODE_EFFORT_LEVEL:"high"});
  assert.deepEqual(first.calls.filter(c => c.args[1] === "add").map(c => c.name), ["agy", "agy"]);
  const second = await f.run(["--for", "codex=agy,claude", "--skip-agy-check"], "", {AGY_MODEL:""});
  const recent = second.calls.slice(first.calls.length);
  assert.equal(registrationEnv(recent, "codex", "agy-delegate").AGY_MODEL, "other-model");
  assert.equal(registrationEnv(recent, "codex", "claude-delegate").CLAUDE_CODE_EFFORT_LEVEL, "high");
});

test("--for rejects malformed and unsupported cells before running prerequisites", async t => {
  const f = await fixture(t);
  for (const spec of ["claude=claude", "unknown=codex", "agy=codex,unknown", "agy=", "agy=codex,", "agy=codex,,claude", "agy=codex=agy", "codex",
    "codex@=claude", "claude@relative=codex", "agy@/alternate=codex"]) {
    const { calls, output } = await f.run(["--codex-mcp", "--for", spec], "", {}, 1);
    assert.match(output, /Invalid selection|Unsupported caller\/worker/);
    assert.deepEqual(calls, []);
  }
});

test("AGY preflights all selected artifacts and leaves other servers intact when uninstalled", async t => {
  const f = await fixture(t);
  const config = join(f.testHome, ".gemini/config/mcp_config.json");
  await mkdir(join(config, ".."), {recursive:true});
  await writeFile(config, '{"mcpServers":{"unrelated":{"command":"keep"}}}');
  await f.run(["--for", "agy=claude"]);
  const skill = join(f.dir, ".agy/skills/dual-agent-review/SKILL.md");
  await rm(skill);
  const before = await readFile(config, "utf8");
  const failed = await f.run(["--for", "agy=codex,claude"], "", {}, 1);
  assert.match(failed.output, /Skill not found/);
  assert.equal(await readFile(config, "utf8"), before);
  await f.uninstall({ DUAL_AGENT_TEST_FAIL_COMMAND: "agy" });
  assert.deepEqual(JSON.parse(await readFile(config, "utf8")), {mcpServers:{unrelated:{command:"keep"}}});
  await assert.rejects(access(join(f.testHome, ".gemini/antigravity-cli/skills/dual-agent-review")), {code:"ENOENT"});
});

test("a fresh installation starts with no integrations selected", async t => {
  const f = await fixture(t);
  const { calls, output } = await f.grid("c");
  assert.deepEqual(gridRow(output, "Claude Code"), ["[ ]", "-", "[ ]", "[ ]"]);
  for (const host of ["Codex", "AGY TUI"]) assert.deepEqual(gridRow(output, host), Array(4).fill("[ ]"));
  assert.match(output, /Nothing selected/);
  assert.deepEqual(calls, []);
});

test("rerunning setup preselects all installed integrations and Continue reinstalls them", async t => {
  const f = await fixture(t);
  const installed = await f.run(["--all"]);
  const { calls, output } = await f.grid("c");
  assert.deepEqual(gridRow(output, "Claude Code"), ["[x]", "-", "[x]", "[x]"]);
  for (const host of ["Codex", "AGY TUI"]) assert.deepEqual(gridRow(output, host), Array(4).fill("[x]"));
  const registrations = calls.slice(installed.calls.length).filter(call => call.args[1] === "add");
  assert.equal(registrations.length, 11);
});

for (const [option, selected, unselected, host] of [
  ["--codex-mcp", "Claude Code", "Codex", "claude"], ["--codex-from-codex", "Codex", "Claude Code", "codex"],
]) {
  test(`${option} is detected independently for its host`, async t => {
    const f = await fixture(t);
    const installed = await f.run([option]);
    const { calls, output } = await f.grid("c");
    assert.equal(gridRow(output, selected)[0], "[x]");
    assert.equal(gridRow(output, unselected)[0], "[ ]");
    const registrations = calls.slice(installed.calls.length).filter(call => call.args[1] === "add");
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].name, host);
  });
}

for (const [provider, column] of [["rosalind", 2], ["agy", 3]]) {
  for (const host of ["claude", "codex"]) {
    test(`${provider} registered only in ${host} preselects only that caller cell`, async t => {
      const f = await fixture(t);
      if (host === "claude") {
        await writeFile(join(f.testHome, ".claude.json"), JSON.stringify({ mcpServers: { [`${provider}-delegate`]: { command: "missing-worker" } } }));
      } else {
        await writeFile(join(f.testHome, ".codex/config.toml"), `[mcp_servers.${provider}-delegate]\ncommand = "missing-worker"\nenabled = false\n`);
      }
      const { calls, output } = await f.grid("c", {}, ["--skip-profile-checks"]);
      assert.equal(gridRow(output, host === "claude" ? "Claude Code" : "Codex")[column], "[x]");
      assert.equal(gridRow(output, host === "claude" ? "Codex" : "Claude Code")[column], "[ ]");
      assert.equal(gridRow(output, "AGY TUI")[column], "[ ]");
      const registrations = calls.filter(call => call.args[1] === "add");
      assert.equal(registrations.length, 1);
      assert.equal(registrations[0].name, host);
      assert.ok(registrations.every(call => call.args.includes(`${provider}-delegate`)));
      assert.ok(!calls.some(call => call.name === "claude" && ["get", "list"].includes(call.args[1])), "detection must not health-check servers");
    });
  }
}

test("installed integrations can be toggled off or cleared without uninstalling", async t => {
  const f = await fixture(t);
  const installed = await f.run(["--both"]);
  const paths = [join(f.testHome, ".claude.json"), join(f.testHome, ".codex/config.toml")];
  const before = await Promise.all(paths.map(path => readFile(path, "utf8")));
  for (const input of [bothDirections + "\n", "n\n"]) {
    const { calls, output } = await f.grid(input);
    assert.match(output, /Nothing selected/);
    assert.ok(!calls.slice(installed.calls.length).some(call => ["add", "remove"].includes(call.args[1])));
    assert.deepEqual(await Promise.all(paths.map(path => readFile(path, "utf8"))), before);
  }
});

test("explicit setup flags ignore other installed integrations", async t => {
  const f = await fixture(t);
  const installed = await f.run(["--all"]);
  const { calls, output } = await f.run(["--claude-mcp"]);
  const recent = calls.slice(installed.calls.length);
  assert.ok(!recent.some(call => call.args[1] === "get"));
  const registrations = recent.filter(call => call.args[1] === "add");
  assert.deepEqual(registrations.map(call => [call.name, call.args[2]]), [["codex", "claude-delegate"]]);
  assert.doesNotMatch(output, /Existing integrations are preselected/);
});

test("detection respects alternate host configuration directories", async t => {
  const f = await fixture(t);
  await f.run(["--codex-mcp"]);
  const codexConfig = join(f.dir, "custom codex");
  const claudeConfig = join(f.dir, "custom claude");
  await Promise.all([mkdir(codexConfig), mkdir(claudeConfig)]);
  await writeFile(join(codexConfig, "config.toml"), '[mcp_servers.claude-delegate]\ncommand = "node"\n');
  await writeFile(join(claudeConfig, ".claude.json"), '{"mcpServers":{"agy-delegate":{"command":"node"}}}');
  const { output } = await f.grid("nc", { CODEX_HOME: codexConfig, CLAUDE_CONFIG_DIR: claudeConfig });
  assert.deepEqual(gridRow(output, "Codex"), ["[ ]", "[x]", "[ ]", "[ ]"]);
  assert.deepEqual(gridRow(output, "Claude Code"), ["[ ]", "-", "[ ]", "[x]"]);
  assert.deepEqual(gridRow(output, "AGY TUI"), Array(4).fill("[ ]"));
});

test("home discovery recognizes dotted and undotted configs, deduplicates aliases and preselects each registration", async t => {
  const f = await fixture(t);
  const api = await configuredHome(f, ".claude-api", "settings.json", "{}");
  await symlink(api, join(f.testHome, ".claude-alias"));
  await configuredHome(f, ".claude-vhh", ".claude.json", '{"mcpServers":{"rosalind-delegate":{}}}');
  await configuredHome(f, "claude-vhh", "settings.json", "{}");
  await configuredHome(f, "codex-web", "config.toml", '[mcp_servers.claude-delegate]\ncommand = "node"\n');
  await configuredHome(f, ".codex-cache", "unrelated", "");
  const { output, calls } = await f.run([], " " + down + " \nn\n");
  assert.match(output, /\[ \] Claude Code ~\/\.claude-api/);
  assert.match(output, /\[x\] Claude Code ~\/\.claude-vhh/);
  assert.match(output, /\[ \] Claude Code ~\/claude-vhh/);
  assert.match(output, /\[x\] Codex ~\/codex-web/);
  assert.doesNotMatch(output, /\.claude-alias|\.codex-cache/);
  assert.deepEqual(gridRow(output, "Claude Code ~/.claude-api"), ["[ ]", "-", "[ ]", "[ ]"]);
  assert.doesNotMatch(output, /^Claude Code ~\/\.claude\s/m);
  assert.deepEqual(gridRow(output, "Claude Code ~/.claude-vhh"), ["[ ]", "-", "[x]", "[ ]"]);
  assert.deepEqual(gridRow(output, "Codex ~/codex-web"), ["[ ]", "[x]", "[ ]", "[ ]"]);
  assert.ok(!calls.some(call => ["add", "remove"].includes(call.args[1])));
});

test("the worker grid lists checked caller homes separately from the worker configuration homes", async t => {
  const f = await fixture(t);
  for (const name of [".claude-api", ".claude-unused", "claude-vhh"]) await configuredHome(f, name, "settings.json", "{}");
  for (const name of [".codex-api", ".codex-web"]) await configuredHome(f, name, "config.toml", "");

  async function header(choices, width) {
    const { output } = await f.run([], choices + "\nq", { LINES: "32", COLUMNS: String(width) });
    const start = output.indexOf("Select workers for each caller home");
    const end = output.indexOf("Caller / worker", start);
    assert.ok(start >= 0 && end > start, output);
    return output.slice(start, end);
  }
  const selected = await header("2,4,6,8", 256);
  assert.ok(selected.includes("Selected Claude caller homes   ~/.claude-api, ~/claude-vhh"));
  assert.ok(selected.includes("Selected Codex caller homes   ~/.codex-api"));
  assert.ok(selected.includes("Selected AGY caller home   ~/.gemini/antigravity-cli"));
  assert.ok(selected.includes("Codex and Rosalind worker home   " + join(f.testHome, ".codex")));
  assert.ok(selected.includes("Claude worker home   " + join(f.testHome, ".claude")));
  assert.doesNotMatch(selected, /\.claude-unused|\.codex-web/);

  const wrapped = await header("2,4,6,8", 40);
  for (const path of ["~/.claude-api", "~/claude-vhh", "~/.codex-api", "~/.gemini/antigravity-cli"]) {
    assert.ok(wrapped.includes(path), wrapped);
  }
  const agyOnly = await header("8", 80);
  assert.ok(agyOnly.includes("Selected AGY caller home"));
  assert.doesNotMatch(agyOnly, /Selected (Codex|Claude) caller homes/);
});

test("cancelling either setup screen or the uninstall picker leaves the registrations intact", async t => {
  const f = await fixture(t);
  const installed = await f.run(["--both"]);
  const paths = [join(f.testHome, ".claude.json"), join(f.testHome, ".codex/config.toml")];
  const saved = await Promise.all(paths.map(path => readFile(path, "utf8")));
  for (const cancel of [
    () => f.run([], down + " q"),
    () => f.grid(right + " \x1b"),
    () => f.uninstall({}, [], "n" + down + " q"),
  ]) {
    const result = await cancel();
    assert.match(result.output, /Selection cancelled/);
    assert.ok(!result.calls.slice(installed.calls.length).some(c => ["add", "remove"].includes(c.args[1]) || c.name === "npm"));
  }
  assert.deepEqual(await Promise.all(paths.map(path => readFile(path, "utf8"))), saved);
});

test("a short terminal pages over homes and worker rows and restores the screen on quit", async t => {
  const f = await fixture(t);
  for (let i = 1; i <= 6; i++) await configuredHome(f, ".claude-alt-" + i, "settings.json", "{}");
  const stty = spawnSync("bash", ["-c", "command -v stty"], {encoding:"utf8"});
  if (stty.status !== 0) return t.skip("stty is needed for the pseudo-terminal fixture");
  await symlink(stty.stdout.trim(), join(f.dir, "bin/stty"));
  // Wait for each frame before sending its next key, just as a terminal user would.
  const driver = String.raw`
import os, pty, select, struct, subprocess, sys, termios, fcntl, time

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 9, 42, 0, 0))
env = dict(os.environ, PATH=sys.argv[1], TERM="xterm-256color")
child = subprocess.Popen(["bash", "setup-dual-agent.sh"], stdin=slave, stdout=slave, stderr=slave, env=env)
os.close(slave)
pending = b""
transcript = bytearray()
try:
    for frame, keys in [
        ("3 selected   Homes 1–4 of 9", b"\x1b[6~"),
        ("3 selected   Homes 5–8 of 9", b" "),
        ("4 selected   Homes 5–8 of 9", b"\x1b[A"),
        ("4 selected   Homes 4–7 of 9", b"\x1b[5~"),
        ("4 selected   Homes 1–4 of 9", b"a"),
        ("9 selected   Homes 1–4 of 9", b"\r"),
        ("Homes 1–1 of 9   Codex worker", b"\x1b[F"),
        ("Homes 9–9 of 9   Codex worker", b"\x1b[C"),
        ("Homes 9–9 of 9   Claude worker", b"q"),
        ("Selection cancelled.", b""),
    ]:
        expected = frame.encode()
        deadline = time.monotonic() + 10
        while expected not in pending:
            if not select.select([master], [], [], max(0, deadline - time.monotonic()))[0]:
                raise AssertionError(f"waiting for {frame!r}, last frame {pending[-1200:]!r}")
            block = os.read(master, 8192)
            if not block:
                raise EOFError(frame)
            pending += block
            transcript.extend(block)
        pending = pending.partition(expected)[2]
        if keys:
            os.write(master, keys)
    assert child.wait(timeout=5) == 0
    sys.stdout.buffer.write(transcript)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
`;
  const python = process.env.DUAL_AGENT_TEST_PYTHON || "python3";
  const result = spawnSync(python, ["-c", driver, f.env.PATH], {
    cwd: f.dir, env: { ...f.env, PATH: process.env.PATH }, encoding: "utf8", timeout: 30000,
  });
  if (result.error?.code === "ENOENT") return t.skip("Python is needed for the pseudo-terminal fixture");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("\x1b[7m> [x] Claude Code ~/.claude-alt-4\x1b[0m"));
  assert.ok(result.stdout.includes("Caller   Claude Code ~/.claude"));
  assert.match(result.stdout, /Caller   AGY TUI [^\r\n]*antigravity-cli/);
  assert.ok(result.stdout.includes("Worker   Claude  ~/.claude"));
  assert.equal(result.stdout.split("\x1b[?1049h").length - 1, 2);
  assert.equal(result.stdout.split("\x1b[?1049l").length - 1, 2);
  assert.match(result.stdout, /\x1b\[\?25h\x1b\[\?1049lSelection cancelled/);
  assert.doesNotMatch(await readFile(join(f.dir, "calls.jsonl"), "utf8"), /"npm"|\["mcp","(?:add|remove)"/);
});

test("qualified homes keep registrations, skills and forwarded worker keys in their selected destinations", async t => {
  const f = await fixture(t);
  const claude = await configuredHome(f, "claude-vhh", ".claude.json", "{}");
  await symlink(claude, join(f.testHome, ".claude-alias"));
  const caller = await configuredHome(f, ".codex-api = test", "config.toml", 'env_key = "CALLER_KEY"\n');
  const worker = join(f.testHome, ".codex");
  const base = 'env_key = "WORKER_KEY"\n';
  await writeFile(join(worker, "config.toml"), base);
  await writeFile(join(worker, "rosalind_delegate.config.toml"), 'env_key = "ROSALIND_KEY"\n');
  const { output, calls } = await f.run(["--for", `claude@${claude}=rosalind`, "--for", "claude@~/.claude-alias=rosalind",
    "--for", `codex@${caller}=rosalind`]);
  const adds = calls.filter(c => c.args[1] === "add");
  assert.deepEqual(adds.map(c => [c.name, c.name === "claude" ? c.claudeHome : c.codexHome]), [["claude", claude], ["codex", caller]]);
  assert.equal(registrationEnv(adds, "claude").CODEX_HOME, worker);
  assert.equal(registrationEnv(adds, "codex").CODEX_HOME, worker);
  assert.deepEqual(calls.filter(c => c.args.includes("exec")).map(c => c.codexHome), [worker]);
  assert.ok(output.includes(`Codex ~/.codex-api = test calls Rosalind from ${worker} (profile rosalind_delegate)`));
  assert.match(await readFile(join(caller, "config.toml"), "utf8"), /env_vars = \["WORKER_KEY", "ROSALIND_KEY"\]/);
  for (const home of [caller, claude]) await access(join(home, "skills/rosalind-delegate/SKILL.md"));
  assert.equal(await readFile(join(worker, "config.toml"), "utf8"), base);
  assert.equal(await readFile(join(f.testHome, ".claude.json"), "utf8"), '{"unrelated":true}');
  await assert.rejects(access(join(f.testHome, ".claude/skills")), {code:"ENOENT"});
});

test("copying a caller row fills the selected sibling homes and allows individual exceptions", async t => {
  const f = await fixture(t);
  await f.run(["--codex-mcp"]);
  const api = await configuredHome(f, ".claude-api", ".claude.json", "{}");
  const vhh = await configuredHome(f, "claude-vhh", ".claude.json", "{}");
  // Three Claude homes plus the active Codex home. Copy Codex and Rosalind, then remove Rosalind from vhh.
  const chooseHomes = "n " + down + " " + down + " " + down + " \n";
  const { calls, output } = await f.run(["--skip-profile-checks"], chooseHomes + right + right + " p" + down + down + " \n");
  assert.deepEqual(gridRow(output, "Claude Code ~/.claude-api", true), ["[x]", "-", "[x]", "[ ]"]);
  assert.deepEqual(gridRow(output, "Claude Code ~/claude-vhh", true), ["[x]", "-", "[ ]", "[ ]"]);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(api, ".claude.json"), "utf8")).mcpServers).sort(), ["codex-delegate", "rosalind-delegate"]);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(vhh, ".claude.json"), "utf8")).mcpServers), ["codex-delegate"]);
  assert.ok(!calls.some(c => c.name !== "claude" && c.args[1] === "add"));
});

test("the home picker accepts an explicit new path and skips unchecked installed homes", async t => {
  const f = await fixture(t);
  await f.run(["--codex-mcp"]);
  const previous = await readFile(join(f.testHome, ".claude.json"), "utf8");
  const custom = join(f.dir, "custom config", "new home");
  const { output } = await f.run([], "1000\nn" + down + `+${custom}\n\n` + right + " \n");
  assert.match(output, /Choose home numbers from the list/);
  await access(join(custom, "skills/claude-delegate/SKILL.md"));
  assert.match(await readFile(join(custom, "config.toml"), "utf8"), /\[mcp_servers\.claude-delegate\]/);
  assert.equal(await readFile(join(f.testHome, ".claude.json"), "utf8"), previous);
  await assert.rejects(access(join(f.testHome, ".codex/config.toml")), {code:"ENOENT"});
  const skipped = await f.run([], "n\n");
  assert.match(skipped.output, /Nothing selected/);
  assert.doesNotMatch(skipped.output, /Caller \/ worker/);
});

test("--all selects the active homes plus only the extra cells explicitly requested", async t => {
  const f = await fixture(t);
  const alternate = await configuredHome(f, ".codex-api", "config.toml", "");
  const target = `codex@${alternate}=claude`;
  let previous = 0;
  for (const args of [["--all", "--for", target], ["--for", target, "--all"]]) {
    const { calls } = await f.run(args);
    const adds = calls.slice(previous).filter(c => c.args[1] === "add");
    assert.equal(adds.length, 12);
    assert.deepEqual(adds.filter(c => c.name === "codex" && c.codexHome === alternate).map(c => c.args[2]), ["claude-delegate"]);
    previous = calls.length;
  }
});

test("unqualified flags use active homes while explicitly selected default Claude uses its global registry", async t => {
  const f = await fixture(t);
  const alternate = await configuredHome(f, ".claude-api", ".claude.json", "{}");
  const { calls } = await f.run(["--codex-mcp", "--for", "claude@~/.claude=rosalind"], "", { CLAUDE_CONFIG_DIR: alternate });
  const adds = calls.filter(c => c.args[1] === "add");
  assert.deepEqual(adds.map(c => c.claudeHome), [alternate, undefined]);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(alternate, ".claude.json"), "utf8")).mcpServers), ["codex-delegate"]);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(f.testHome, ".claude.json"), "utf8")).mcpServers), ["rosalind-delegate"]);
  await access(join(alternate, "skills/codex-delegate/SKILL.md"));
  await access(join(f.testHome, ".claude/skills/rosalind-delegate/SKILL.md"));
});

test("rerunning a qualified AGY installation uses that home's saved priority and retires Gemini only there", async t => {
  const f = await fixture(t);
  await f.run(["--for", "claude=agy", "--agy-model", "fixture-model"]);
  const global = join(f.testHome, ".claude.json");
  const previous = JSON.parse(await readFile(global, "utf8"));
  previous.mcpServers["gemini-delegate"] = {command:"old"};
  await writeFile(global, JSON.stringify(previous));
  const alternate = await configuredHome(f, "claude-vhh", ".claude.json", JSON.stringify({mcpServers:{
    "gemini-delegate":{command:"old"}, "agy-delegate":{command:"node", env:{AGY_MODELS:"other-model"}},
  }}));
  for (const home of [join(f.testHome, ".claude"), alternate]) await mkdir(join(home, "skills/gemini-delegate"), {recursive:true});
  await f.run(["--for", `claude@${alternate}=agy`, "--skip-agy-check"], "", {AGY_MODEL:""});
  const updated = JSON.parse(await readFile(join(alternate, ".claude.json"), "utf8")).mcpServers;
  assert.equal(updated["agy-delegate"].env.AGY_MODELS, "other-model");
  assert.equal(updated["gemini-delegate"], undefined);
  await assert.rejects(access(join(alternate, "skills/gemini-delegate")), {code:"ENOENT"});
  await access(join(f.testHome, ".claude/skills/gemini-delegate"));
  assert.deepEqual(JSON.parse(await readFile(global, "utf8")), previous);
});

test("uninstall home selection and --home remove only the targeted registrations, skills and legacy settings", async t => {
  const f = await fixture(t);
  const claude = await configuredHome(f, ".claude-api", "settings.json", '{"permissions":{"allow":["Read","Bash(tmux send-keys:*)"]}}');
  const codex = await configuredHome(f, ".codex-api", "config.toml", 'model = "keep"\n');
  await f.run(["--both", "--for", `claude@${claude}=codex`, "--for", `codex@${codex}=claude`, "--for", "agy=codex"]);
  const keep = [".claude.json", ".codex/config.toml", ".gemini/config/mcp_config.json",
    ".claude/skills/codex-delegate/SKILL.md", ".codex/skills/claude-delegate/SKILL.md", ".gemini/antigravity-cli/skills/dual-agent-review/SKILL.md"];
  const contents = () => Promise.all(keep.map(path => readFile(join(f.testHome, path), "utf8")));
  const before = await contents();
  await f.uninstall({ DUAL_AGENT_TEST_FAIL_COMMAND: "claude" }, [], "n" + down + " \n");
  assert.deepEqual(JSON.parse(await readFile(join(claude, ".claude.json"), "utf8")).mcpServers, {});
  assert.deepEqual(JSON.parse(await readFile(join(claude, "settings.json"), "utf8")).permissions.allow, ["Read"]);
  await assert.rejects(access(join(claude, "skills/codex-delegate")), {code:"ENOENT"});
  await access(join(codex, "skills/claude-delegate/SKILL.md"));
  await f.uninstall({}, ["--home", `codex@${codex}`]);
  assert.doesNotMatch(await readFile(join(codex, "config.toml"), "utf8"), /claude-delegate/);
  await assert.rejects(access(join(codex, "skills/claude-delegate")), {code:"ENOENT"});
  assert.deepEqual(await contents(), before);
});

test("unreadable detection data leaves manual selection available", async t => {
  const f = await fixture(t);
  await writeFile(join(f.testHome, ".claude.json"), "invalid JSON");
  const { output } = await f.grid("c");
  assert.match(output, /Could not read Claude registrations/);
  assert.match(output, /Nothing selected/);
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
  assert.equal(reverse.CLAUDE_CODE_EFFORT_LEVEL, undefined);
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
  const { calls, output } = await f.grid(down + right + " \n");
  assert.equal(gridRow(output, "Codex", true)[1], "[x]");
  const registrations = calls.filter(call => call.args[0] === "mcp" && call.args[1] === "add");
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "codex");
  assert.equal(registrations[0].args[2], "claude-delegate");
  assert.equal(await readFile(join(f.testHome, ".codex/skills/claude-delegate/SKILL.md"), "utf8"), "claude-delegate fixture");
  await assert.rejects(access(join(f.testHome, ".claude/skills/codex-delegate")), { code: "ENOENT" });
});

test("interactive selection can install both delegation directions", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.grid(bothDirections + "\n");
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  assert.equal(registrationEnv(calls, "codex").CLAUDE_BIN, join(f.dir, "bin/claude"));
  await access(join(f.testHome, ".claude/skills/codex-delegate/SKILL.md"));
  await access(join(f.testHome, ".codex/skills/claude-delegate/SKILL.md"));
});

test("deselecting Claude delegation skips its registration and skill", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.grid(bothDirections + " \n");
  assert.equal(registrationEnv(calls, "claude").CODEX_BIN, "codex-pool");
  assert.ok(!calls.some(call => call.name === "codex" && call.args[1] === "add"));
  await assert.rejects(access(join(f.testHome, ".codex/skills/claude-delegate")), { code: "ENOENT" });
});

test("select all includes Claude delegation with the other integrations", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.grid("ac");
  const codexServers = calls.filter(call => call.name === "codex" && call.args[1] === "add").map(call => call.args[2]);
  assert.deepEqual(codexServers.sort(), ["agy-delegate", "claude-delegate", "codex-delegate", "rosalind-delegate"]);
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

test("setup saves the Claude worker effort and keeps it when rerun without one", async (t) => {
  const f = await fixture(t);
  const lastEffort = calls => registrationEnv([calls.filter(call => call.name === "codex" && call.args[1] === "add").at(-1)], "codex", "claude-delegate").CLAUDE_CODE_EFFORT_LEVEL;
  const first = await f.run(["--claude-mcp"], "", { CLAUDE_CODE_EFFORT_LEVEL: "max" });
  assert.equal(lastEffort(first.calls), "max");
  assert.match(first.output, /Claude worker effort: max/);
  assert.equal(lastEffort((await f.run(["--both"])).calls), "max");
  assert.equal(lastEffort((await f.run(["--claude-mcp"], "", { CLAUDE_CODE_EFFORT_LEVEL: "high" })).calls), "high");
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

test("combined options and aliases install each requested integration once", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run(["--mcp", "--claude-mcp", "--agy", "--agy-mcp", "--both"]);
  const registrations = calls.filter(call => call.args[0] === "mcp" && call.args[1] === "add");
  assert.deepEqual(registrations.map(call => [call.name, call.args.find(arg => arg.endsWith("-delegate"))]), [
    ["claude", "codex-delegate"], ["claude", "agy-delegate"],
    ["codex", "claude-delegate"], ["codex", "agy-delegate"],
  ]);
  assert.deepEqual(calls.filter(call => call.name === "npm").map(call => call.args), [["ci"], ["run", "build"]]);
});

test("unknown trailing options fail before installation", async (t) => {
  const f = await fixture(t);
  const { calls, output } = await f.run(["--codex-mcp", "--typo"], "", {}, 1);
  assert.match(output, /Unknown option: --typo/);
  assert.deepEqual(calls, []);
});

for (const artifact of ["agent/dist/agyCodexMcp.js", ".codex/skills/agy-delegate/SKILL.md"]) {
  test(`missing ${artifact} prevents all registration changes`, async (t) => {
    const f = await fixture(t);
    await rm(join(f.dir, artifact));
    const { calls, output } = await f.run(["--all"], "", {}, 1);
    assert.ok(output.includes(artifact), output);
    assert.ok(!calls.some(call => call.args[0] === "mcp"));
    assert.equal(await readFile(join(f.testHome, ".claude.json"), "utf8"), '{"unrelated":true}');
  });
}

test("Codex-only setup does not require a Claude executable", async (t) => {
  const f = await fixture(t, ["claude"]);
  const { calls } = await f.run(["--codex-from-codex"]);
  assert.equal(registrationEnv(calls, "codex", "codex-delegate").CODEX_BIN, "codex-pool");
});

test("Claude-hosted Codex setup accepts a custom worker without a Codex host CLI", async (t) => {
  const f = await fixture(t, ["codex", "codex-pool"]);
  const { calls } = await f.run(["--codex-mcp"], "", { CODEX_BIN: f.customBinary });
  assert.equal(registrationEnv(calls, "claude", "codex-delegate").CODEX_BIN, f.customBinary);
});

for (const withTee of [true, false]) {
  test(`verbose setup propagates build failure ${withTee ? "with" : "without"} tee`, async (t) => {
    const f = await fixture(t, withTee ? [] : ["tee"]);
    const { calls, output } = await f.run(["--all"], "", { DUAL_AGENT_VERBOSE: "1", DUAL_AGENT_TEST_FAIL_COMMAND: "npm" }, 1);
    assert.match(output, /fixture command failed/);
    assert.doesNotMatch(output, /Setup Complete/);
    assert.ok(!calls.some(call => call.args[0] === "mcp"));
  });
}

for (const [provider, label, profile] of [
  ["rosalind", "Rosalind", "rosalind_delegate"],
]) {
  test(`${label} verifies its profile by default for explicit and interactive setup`, async (t) => {
    const f = await fixture(t);
    let previousCalls = 0;
    for (const [args, input] of [[[`--${provider}-mcp`], ""], [[], "\nc"]]) {
      const { calls, output } = await f.run(args, input);
      const recent = calls.slice(previousCalls);
      previousCalls = calls.length;
      const checks = recent.filter(call => call.args.includes("exec"));
      assert.equal(checks.length, 1);
      assert.equal(checks[0].args[checks[0].args.indexOf("-p") + 1], profile);
      assert.equal(checks[0].codexHome, join(f.testHome, ".codex"));
      assert.equal(checks[0].args[checks[0].args.indexOf("--sandbox") + 1], "read-only");
      assert.ok(checks[0].args.includes("--ephemeral"));
      assert.ok(checks[0].args.includes('approval_policy="never"'));
      assert.equal(recent.filter(call => call.args[1] !== "get")[0], checks[0], "verify before building or registering");
      assert.ok(output.includes(`Live ${label} profile check (one request)`));
    }
  });

  test(`${label} verification honors its environment setting and explicit override`, async (t) => {
    const f = await fixture(t);
    const overrides = { [`${provider.toUpperCase()}_VERIFY_PROFILE`]: "0" };
    const skipped = await f.run([`--${provider}-mcp`], "", overrides);
    assert.ok(!skipped.calls.some(call => call.args.includes("exec")));
    const { calls } = await f.run(["--skip-profile-checks", `--verify-${provider}-profile`], "", overrides);
    const checks = calls.slice(skipped.calls.length).filter(call => call.args.includes("exec"));
    assert.equal(checks.length, 1);
    assert.equal(checks[0].args[checks[0].args.indexOf("-p") + 1], profile);
  });

  test(`${label} skip flag still requires its profile file`, async (t) => {
    const f = await fixture(t);
    await rm(join(f.testHome, `.codex/${profile}.config.toml`));
    const { calls, output } = await f.run([`--${provider}-mcp`, `--skip-${provider}-profile-check`], "", {}, 1);
    assert.ok(output.includes(`${label} Codex profile not found`));
    assert.deepEqual(calls, []);
  });

  for (const [failure, overrides] of [
    ["process failure", { DUAL_AGENT_TEST_FAIL_COMMAND: "codex-pool" }],
    ["missing answer", { DUAL_AGENT_TEST_NO_PROFILE_ANSWER: "1" }],
    ["empty answer", { DUAL_AGENT_TEST_PROFILE_ANSWER: "" }],
    ["unexpected answer", { DUAL_AGENT_TEST_PROFILE_ANSWER: "unexpected response" }],
    ["extra answer text", { DUAL_AGENT_TEST_PROFILE_ANSWER: "DUAL_AGENT_PROFILE_OK but something failed" }],
  ]) {
    test(`${label} ${failure} stops setup without changing registrations`, async (t) => {
      const f = await fixture(t);
      const config = join(f.testHome, ".codex/config.toml");
      const original = '[mcp_servers.codex-delegate]\ncommand = "existing"\n';
      await writeFile(config, original);
      const installLog = join(f.dir, "install.log");
      const answerFile = `${installLog}.${provider}-answer`;
      await writeFile(answerFile, "DUAL_AGENT_PROFILE_OK");
      const { calls, output } = await f.run(["--codex-mcp", `--${provider}-mcp`], "", { ...overrides, DUAL_AGENT_INSTALL_LOG: installLog }, 1);
      assert.ok(output.includes(`The live ${label} profile check failed`));
      assert.ok(output.includes(`--skip-${provider}-profile-check`));
      assert.equal(calls.length, 1);
      assert.ok(calls[0].args.includes("exec"));
      await assert.rejects(access(answerFile), { code: "ENOENT" });
      assert.equal(await readFile(config, "utf8"), original);
      assert.equal(await readFile(join(f.testHome, ".claude.json"), "utf8"), '{"unrelated":true}');
    });
  }
}

test("ordinary Codex and Claude installation makes no profile requests", async (t) => {
  const f = await fixture(t);
  const { calls } = await f.run(["--both", "--codex-from-codex"]);
  assert.ok(!calls.some(call => call.args.includes("exec")));
});

test("Antigravity setup prompts for a native model and registers both hosts without a Codex worker", async t => {
  const f = await fixture(t, ["codex-pool"]);
  const { calls, output } = await f.grid(agyInBoth + "\n2\n", { AGY_MODEL: "" });
  assert.match(output, /Choose the Antigravity model/);
  assert.match(output, /Other Model/);
  for (const host of ["claude", "codex"]) {
    const saved = registrationEnv(calls, host, "agy-delegate");
    assert.equal(saved.AGY_MODEL, "other-model");
    assert.equal(saved.AGY_BIN, join(f.dir, "bin/agy"));
    assert.equal(saved.CODEX_BIN, undefined);
    await access(join(f.testHome, `.${host}/skills/agy-delegate/SKILL.md`));
  }
  const check = calls.find(call => call.args.some(arg => arg.startsWith("--print=")));
  assert.equal(check.name, "agy");
  assert.equal(check.args[check.args.indexOf("--model") + 1], "other-model");
  assert.ok(!calls.some(call => call.args.includes("exec")));
  const config = await readFile(join(f.testHome, ".codex/config.toml"), "utf8");
  assert.match(config, /env_vars = \["GEMINI_API_KEY"\]/);
});

test("Antigravity saves an explicit model and reuses it in unattended setup", async t => {
  const f = await fixture(t);
  const first = await f.run(["--agy-model", "other-model"], "", { AGY_BIN: f.customBinary });
  assert.equal(registrationEnv(first.calls, "codex", "agy-delegate").AGY_BIN, f.customBinary);
  const next = await f.run(["--agy-mcp", "--skip-agy-check"], "", { AGY_MODEL: "" });
  const recent = next.calls.slice(first.calls.length);
  assert.equal(registrationEnv(recent, "codex", "agy-delegate").AGY_MODEL, "other-model");
  assert.ok(!recent.some(call => call.args.some(arg => arg.startsWith("--print="))));
});

test("Antigravity interactive default is Hydrogen, Argon, Opus and preserves native settings", async t => {
  const f = await fixture(t);
  const settings = join(f.testHome, ".gemini/antigravity-cli/settings.json");
  await mkdir(join(settings, ".."), { recursive: true });
  await writeFile(settings, '{"model":"Other Model"}');
  const { calls } = await f.grid(agyInBoth + "\n\n", { AGY_MODEL: "" });
  assert.equal(registrationEnv(calls, "codex", "agy-delegate").AGY_MODELS, "gemini-4-hydrogen-xhigh,gemini-4-argon-high,claude-opus-5-5-high");
  assert.equal(await readFile(settings, "utf8"), '{"model":"Other Model"}');
});

test("the AGY picker toggles models and moves the highlighted model earlier or later", async t => {
  const f = await fixture(t);
  // Choose two models, move the second to the front, then add and remove a third.
  const keys = "n " + down + " " + left + right + left + down + "  \n";
  const { calls, output } = await f.grid(agyInBoth + "\n" + keys, { AGY_MODEL: "" });
  assert.match(output, /> \[1\] Other Model \(other-model\)/);
  for (const caller of ["codex", "claude"]) {
    assert.equal(registrationEnv(calls, caller, "agy-delegate").AGY_MODELS, "other-model,fixture-model");
  }
});

test("quitting AGY model selection stops before live checks or installation", async t => {
  const f = await fixture(t);
  const log = join(f.dir, "installer.log");
  const { calls, output } = await f.grid("a\nq", {AGY_MODEL:"", DUAL_AGENT_INSTALL_LOG:log});
  assert.match(output, /Selection cancelled/);
  assert.ok(calls.some(c => c.name === "agy" && c.args[0] === "models"));
  assert.ok(!calls.some(c => c.name === "npm" || ["add", "remove"].includes(c.args[1]) ||
    c.args.includes("exec") || c.args.some(arg => arg.startsWith("--print="))));
  await assert.rejects(access(log + ".agy-models"), {code:"ENOENT"});
});

test("Antigravity accepts ordered menu selections and reuses the saved priority", async t => {
  const f = await fixture(t);
  const first = await f.grid(agyInBoth + "\n2,1,2\n", { AGY_MODEL: "" });
  for (const host of ["claude", "codex"]) assert.equal(registrationEnv(first.calls, host, "agy-delegate").AGY_MODELS, "other-model,fixture-model");
  const next = await f.run(["--agy-mcp", "--skip-agy-check"], "", { AGY_MODEL: "" });
  assert.equal(registrationEnv(next.calls.slice(first.calls.length), "codex", "agy-delegate").AGY_MODELS, "other-model,fixture-model");
});

test("Antigravity uses available defaults for a fresh unattended install", async t => {
  const f = await fixture(t);
  const { calls } = await f.run(["--agy-mcp"], "", { AGY_MODEL: "" });
  assert.equal(registrationEnv(calls, "codex", "agy-delegate").AGY_MODELS, "gemini-4-hydrogen-xhigh,gemini-4-argon-high,claude-opus-5-5-high");
});

test("Antigravity explicit priorities override single-model settings and can be reset to defaults", async t => {
  const f = await fixture(t);
  const first = await f.run(["--agy-models", "other-model,fixture-model"]);
  assert.equal(registrationEnv(first.calls, "codex", "agy-delegate").AGY_MODELS, "other-model,fixture-model");
  const reset = await f.grid("cd\n", { AGY_MODEL: "" });
  assert.equal(registrationEnv(reset.calls.slice(first.calls.length), "codex", "agy-delegate").AGY_MODELS, "gemini-4-hydrogen-xhigh,gemini-4-argon-high,claude-opus-5-5-high");
});

test("Antigravity live setup check falls back only on a model quota failure", async t => {
  const f = await fixture(t);
  const { calls } = await f.run(["--agy-models", "fixture-model,other-model"], "", { DUAL_AGENT_TEST_QUOTA_MODELS: "fixture-model" });
  const checks = calls.filter(call => call.args.some(arg => arg.startsWith("--print=")));
  assert.deepEqual(checks.map(call => call.args[call.args.indexOf("--model") + 1]), ["fixture-model", "other-model"]);
  assert.equal(registrationEnv(calls, "codex", "agy-delegate").AGY_MODELS, "fixture-model,other-model");
});

for (const [reason, overrides] of [
  ["all quotas exhausted", { DUAL_AGENT_TEST_QUOTA_MODELS: "fixture-model,other-model" }],
  ["wrong response", { DUAL_AGENT_TEST_PROFILE_ANSWER: "wrong" }],
]) {
  test(`Antigravity priority setup fails without registrations for ${reason}`, async t => {
    const f = await fixture(t);
    const { calls } = await f.run(["--agy-models", "fixture-model,other-model"], "", overrides, 1);
    assert.ok(!calls.some(call => call.args[0] === "mcp"));
    assert.equal(calls.filter(call => call.args.some(arg => arg.startsWith("--print="))).length, reason === "wrong response" ? 1 : 2);
  });
}

test("Antigravity skip check still validates every model in an explicit priority list", async t => {
  const f = await fixture(t);
  const { calls } = await f.run(["--agy-models", "fixture-model,missing-model", "--skip-agy-check"], "", {}, 1);
  assert.ok(!calls.some(call => call.args[0] === "mcp" || call.args.some(arg => arg.startsWith("--print="))));
});

for (const [reason, overrides] of [
  ["no available defaults", { AGY_MODEL: "", DUAL_AGENT_TEST_MODELS: "fixture-model\tFixture Model" }],
  ["unavailable model", { AGY_MODEL: "not-in-catalog" }],
  ["catalog failure", { DUAL_AGENT_TEST_FAIL_COMMAND: "agy" }],
  ["live check failure", { DUAL_AGENT_TEST_PROFILE_ANSWER: "wrong answer" }],
]) {
  test(`Antigravity ${reason} fails before changing registrations`, async t => {
    const f = await fixture(t);
    const { calls } = await f.run(["--agy-mcp"], "", overrides, 1);
    assert.ok(!calls.some(call => call.args[0] === "mcp"));
  });
}

test("Antigravity rejects invalid menu choices and supports skipping checks interactively", async t => {
  const f = await fixture(t);
  const { calls, output } = await f.grid(agyInBoth + "\n999\n2\n", { AGY_MODEL: "" }, ["--skip-profile-checks"]);
  assert.match(output, /Choose a model number from the list/);
  assert.equal(registrationEnv(calls, "codex", "agy-delegate").AGY_MODEL, "other-model");
  assert.ok(!calls.some(call => call.args.some(arg => arg.startsWith("--print="))));
});

test("Antigravity migration removes old Gemini registrations and skills only after successful setup", async t => {
  const f = await fixture(t);
  for (const host of ["claude", "codex"]) {
    const path = join(f.testHome, `.${host}/skills/gemini-delegate`);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), "legacy skill");
  }
  const config = join(f.testHome, ".codex/config.toml");
  const existing = '[mcp_servers.gemini-delegate]\ncommand = "old"\n';
  await writeFile(config, existing);
  const failed = await f.run(["--agy-mcp"], "", { DUAL_AGENT_TEST_FAIL_REGISTER: "codex" }, 1);
  assert.ok(!failed.calls.some(call => call.args[1] === "remove" && call.args[2] === "gemini-delegate"));
  assert.match(await readFile(config, "utf8"), /gemini-delegate/);
  await access(join(f.testHome, ".codex/skills/gemini-delegate/SKILL.md"));
  const completed = await f.run(["--gemini-mcp"]);
  const recent = completed.calls.slice(failed.calls.length);
  const lastAdd = recent.findLastIndex(call => call.args[1] === "add");
  assert.ok(recent.findIndex(call => call.args[1] === "remove" && call.args[2] === "gemini-delegate") > lastAdd);
  assert.doesNotMatch(await readFile(config, "utf8"), /gemini-delegate/);
  for (const host of ["claude", "codex"]) await assert.rejects(access(join(f.testHome, `.${host}/skills/gemini-delegate`)), { code: "ENOENT" });
  assert.equal(await readFile(join(f.testHome, ".codex/gemini.config.toml"), "utf8"), 'model = "fixture-gemini"\n');
});

test("uninstall fallback removes all catalog integrations and preserves unrelated settings and jobs", async (t) => {
  const f = await fixture(t);
  await f.run(["--all"]);
  const servers = {
    "codex-delegate": { command: "node" }, "rosalind-delegate": { command: "node" },
    "agy-delegate": { command: "node" }, unrelated: { command: "keep-me" },
  };
  const config = join(f.testHome, ".claude.json");
  const settings = join(f.testHome, ".claude/settings.json");
  await writeFile(config, JSON.stringify({ unrelated: true, mcpServers: servers }));
  await writeFile(settings, JSON.stringify({ permissions: { allow: ["Read", "Bash(tmux send-keys:*)"] }, mcpServers: servers }));
  const savedJob = join(f.testHome, ".local/state/dual-agent/jobs/fixture/result.md");
  await mkdir(join(savedJob, ".."), { recursive: true });
  await writeFile(savedJob, "saved answer");
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.uninstall({ DUAL_AGENT_TEST_FAIL_COMMAND: "claude" });
    assert.deepEqual(JSON.parse(await readFile(config, "utf8")), { unrelated: true, mcpServers: { unrelated: servers.unrelated } });
    assert.deepEqual(JSON.parse(await readFile(settings, "utf8")), { permissions: { allow: ["Read"] }, mcpServers: { unrelated: servers.unrelated } });
    assert.equal(await readFile(savedJob, "utf8"), "saved answer");
    assert.equal(await readFile(join(f.testHome, ".codex/gemini.config.toml"), "utf8"), 'model = "fixture-gemini"\n');
  }
  for (const [host, providers] of [["claude", ["codex", "rosalind", "agy", "gemini"]], ["codex", ["claude", "codex", "rosalind", "agy", "gemini"]]]) {
    for (const provider of providers) await assert.rejects(access(join(f.testHome, `.${host}/skills/${provider}-delegate`)), { code: "ENOENT" });
  }
});
