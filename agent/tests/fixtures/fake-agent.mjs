#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
const args = process.argv.slice(2);
let input = "";
for await (const chunk of process.stdin) input += chunk;
const provider = args.includes("--print") ? "claude" : "codex";
if (provider === "codex" && process.env.FAKE_CHECK_GIT_REPO === "1" &&
    !args.includes("--skip-git-repo-check") &&
    spawnSync("git", ["rev-parse", "--show-toplevel"], { stdio: "ignore" }).status !== 0) {
  process.stderr.write("Not inside a trusted directory and --skip-git-repo-check was not specified.\n");
  process.exit(1);
}
const capture = { args, input, cwd: process.cwd(), provider, pid: process.pid };
if (process.env.FAKE_CAPTURE) appendFileSync(process.env.FAKE_CAPTURE, JSON.stringify(capture) + "\n");
if (process.env.DUAL_AGENT_CAPTURE) writeFileSync(process.env.DUAL_AGENT_CAPTURE, JSON.stringify(capture));
process.stderr.write("fixture diagnostic\n");
if (input.includes("[tree]")) {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });
  if (process.env.FAKE_DESCENDANTS) appendFileSync(process.env.FAKE_DESCENDANTS, String(child.pid) + "\n");
}
if (input.includes("[ignore-term]")) process.on("SIGTERM", () => {});
if (input.includes("[hold]")) {
  setInterval(() => {}, 1000);
} else {
  setTimeout(() => {
    const output = process.env.DUAL_AGENT_OUTPUT_SIZE ? "x".repeat(Number(process.env.DUAL_AGENT_OUTPUT_SIZE)) : input.includes("[large]") ? "x".repeat(100000) : "fixture answer\n";
    if (provider === "codex") {
      if (!input.includes("[no-result]")) writeFileSync(args[args.indexOf("--output-last-message") + 1], output);
      process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "fixture-codex-session" }) + "\n");
    } else {
      process.stdout.write(input.includes("[bad-json]") ? "invalid json\n" : JSON.stringify({
        type: "result", result: output, session_id: "fixture-claude-session", is_error: input.includes("[is-error]"),
        permission_denials: input.includes("[denied]") ? [{ tool_name: "Bash" }] : [],
      }) + "\n");
    }
    process.exitCode = Number(process.env.DUAL_AGENT_EXIT || (input.includes("[fail]") ? 7 : 0));
  }, Number(process.env.DUAL_AGENT_DELAY || (input.includes("[slow]") ? 750 : 0)));
}
