import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [claudeConfig, codexHome, ...integrations] = process.argv.slice(2);
let claudeServers = {};
try {
  // Reading user registrations avoids the health checks performed by claude mcp get.
  claudeServers = JSON.parse(readFileSync(claudeConfig, "utf8")).mcpServers ?? {};
} catch (error) {
  if (error.code !== "ENOENT") console.error("Could not read Claude registrations; select its integrations manually.");
}

const codexRegistrations = new Map();
function codexHas(server) {
  if (!codexRegistrations.has(server)) {
    // Let Codex parse its TOML. `get` reads configuration without starting the server.
    // Use its config directory so this repository's project settings cannot add selections.
    const result = existsSync(join(codexHome, "config.toml")) ? spawnSync("codex", ["mcp", "get", server, "--json"], {
      env: { ...process.env, CODEX_HOME: codexHome }, cwd: codexHome,
      encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024,
    }) : undefined;
    let found = false;
    if (result?.status === 0) {
      try { found = JSON.parse(result.stdout).name === server; } catch { /* Not a valid registration response. */ }
    }
    codexRegistrations.set(server, found);
  }
  return codexRegistrations.get(server);
}

integrations.forEach((entry, index) => {
  const [provider, hosts] = entry.split("|");
  const server = `${provider}-delegate`;
  const installed = hosts.split(" ").some(host => host === "claude"
    ? Object.hasOwn(claudeServers, server) && claudeServers[server] !== null && typeof claudeServers[server] === "object"
    : codexHas(server));
  if (installed) console.log(index);
});
