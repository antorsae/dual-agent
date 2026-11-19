import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const args = process.argv.slice(2);
if (args[0] === "--env") {
  const [, claudeConfig, agyConfig, server, key] = args;
  for (const [file, host] of [[claudeConfig, "Claude"], [agyConfig, "AGY"]]) {
    const value = registrations(file, host)[server]?.env?.[key];
    if (typeof value === "string" && value) { process.stdout.write(value); break; }
  }
} else {
  const [claudeConfig, codexHome, agyConfig, ...cells] = args;
  const hosts = { claude: registrations(claudeConfig, "Claude"), agy: registrations(agyConfig, "AGY") };
  function codexHas(server) {
    if (!existsSync(join(codexHome, "config.toml"))) return false;
    // Codex parses its own TOML, without starting the server or using project settings.
    const result = spawnSync("codex", ["mcp", "get", server, "--json"], {
      env: { ...process.env, CODEX_HOME: codexHome }, cwd: codexHome,
      encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) return false;
    try { return JSON.parse(result.stdout).name === server; } catch { return false; }
  }
  cells.forEach((cell, index) => {
    if (!cell) return;
    const [host, worker] = cell.split("=");
    const server = `${worker}-delegate`;
    const installed = host === "codex" ? codexHas(server) : Object.hasOwn(hosts[host] ?? {}, server) && !!hosts[host][server];
    if (installed) console.log(index);
  });
}
