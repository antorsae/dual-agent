#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
const args = process.argv.slice(2);
let input = "";
for await (const chunk of process.stdin) input += chunk;
const provider = args.includes("--input-format") ? "agy" : args.includes("--print") ? "claude" : "codex";
const wireInput = input;
if (provider === "agy") input = JSON.parse(input).message.content;
if (provider === "codex" && process.env.FAKE_CHECK_GIT_REPO === "1" &&
    !args.includes("--skip-git-repo-check") &&
    spawnSync("git", ["rev-parse", "--show-toplevel"], { stdio: "ignore" }).status !== 0) {
  process.stderr.write("Not inside a trusted directory and --skip-git-repo-check was not specified.\n");
  process.exit(1);
}
const capture = { args, input, wireInput, cwd: process.cwd(), provider, pid: process.pid,
  env: Object.fromEntries(["DUAL_AGENT_SCRATCH_DIR", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "PYTHONPYCACHEPREFIX", "PYTEST_ADDOPTS", "COVERAGE_FILE", "npm_config_cache"].map(key => [key, process.env[key]])) };
if (process.env.FAKE_CAPTURE) appendFileSync(process.env.FAKE_CAPTURE, JSON.stringify(capture) + "\n");
if (process.env.DUAL_AGENT_CAPTURE) writeFileSync(process.env.DUAL_AGENT_CAPTURE, JSON.stringify(capture));
process.stderr.write("fixture diagnostic\n");
const emit = event => process.stdout.write(JSON.stringify(event) + "\n");
if (provider === "claude") emit({ type: "system", subtype: "init", session_id: "fixture-claude-session" });
if (provider === "agy") emit({ event: "init", conversation_id: "fixture-agy-session", init: { model: args[args.indexOf("--model") + 1] } });
if (input.includes("[tree]")) {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });
  if (process.env.FAKE_DESCENDANTS) appendFileSync(process.env.FAKE_DESCENDANTS, String(child.pid) + "\n");
}
if (input.includes("[ignore-term]")) process.on("SIGTERM", () => {});
if (input.includes("[hold]")) {
  // Claude streams thinking progress while it works.
  setInterval(() => { if (provider === "claude") emit({ type: "system", subtype: "thinking_tokens", estimated_tokens: 50 }); }, 100);
} else {
  setTimeout(() => {
    const output = process.env.DUAL_AGENT_OUTPUT_SIZE ? "x".repeat(Number(process.env.DUAL_AGENT_OUTPUT_SIZE)) :
      input.includes("[large]") ? "x".repeat(100000) : input.includes("[unicode]") ? "é€😀".repeat(1000) : "fixture answer\n";
    if (provider === "codex") {
      if (!input.includes("[no-result]")) writeFileSync(args[args.indexOf("--output-last-message") + 1], output);
      emit({ type: "thread.started", thread_id: "fixture-codex-session" });
    } else if (provider === "agy") {
      if (input.includes("[denied]")) emit({ event: "step_update", step_update: { tool_info: { error: { type: "PERMISSION_DENIED", message: "tool denied" } } } });
      if (!input.includes("[no-result]")) emit({ event: "result", result: {
        conversation_id: "fixture-agy-session", status: input.includes("[is-error]") ? "ERROR" : "SUCCESS",
        response: input.includes("[denied-actions-empty]") ? "" : output,
        ...(input.includes("[denied-actions") ? { denied_actions: [{ action: "read_file", display_name: "ReadFile" }] } : {}),
      } });
    } else {
      const line = Buffer.from(input.includes("[bad-json]") ? "invalid json\n" : JSON.stringify({
        type: "result", result: output, session_id: "fixture-claude-session", is_error: input.includes("[is-error]"),
        permission_denials: input.includes("[denied]") ? [{ tool_name: "Bash" }] : [],
      }) + "\n");
      // [unicode] splits a multibyte character across writes, as pipe reads can.
      const cut = input.includes("[unicode]") ? line.indexOf("€") + 1 : line.length;
      process.stdout.write(line.subarray(0, cut));
      setTimeout(() => process.stdout.write(line.subarray(cut)), 20);
    }
    process.exitCode = Number(process.env.DUAL_AGENT_EXIT || (input.includes("[fail]") ? 7 : 0));
  }, Number(process.env.DUAL_AGENT_DELAY || (input.includes("[slow]") ? 750 : 0)));
}
