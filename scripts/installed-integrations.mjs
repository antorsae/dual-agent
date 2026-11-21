import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

function registrations(file, host) {
  try {
    const json = readFileSync(file, "utf8").trim();
    return json ? JSON.parse(json).mcpServers ?? {} : {};
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Could not read ${host} registrations from ${file}.`);
    return {};
  }
}

function codexHas(file, server) {
  if (!existsSync(file)) return false;
  // Codex parses its own TOML without starting the server or using this project's config.
  const home = dirname(file);
  const result = spawnSync("codex", ["mcp", "get", server, "--json"], {
    env: { ...process.env, CODEX_HOME: home }, cwd: home,
    encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return false;
  try { return JSON.parse(result.stdout).name === server; } catch { return false; }
}

const [action, host, file, ...args] = process.argv.slice(2);
const servers = host === "codex" ? {} : registrations(file, host === "claude" ? "Claude" : "AGY");
if (action === "--env") {
  const [server, key] = args;
  const value = servers[server]?.env?.[key];
  if (typeof value === "string") process.stdout.write(value);
} else if (action === "--installed") {
  args.forEach((worker, index) => {
    const server = `${worker}-delegate`;
    const installed = host === "codex" ? codexHas(file, server) : !!servers[server];
    if (installed) console.log(index);
  });
}
