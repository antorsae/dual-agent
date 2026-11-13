import type { Job } from "./tasks.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function nativeSettings(): { toolPermission?: string; permissions?: { allow?: string[]; ask?: string[]; deny?: string[] } } {
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), ".gemini", "antigravity-cli", "settings.json"), "utf8"));
    for (const name of ["allow", "ask", "deny"]) {
      const rules = settings.permissions?.[name];
      if (rules !== undefined && (!Array.isArray(rules) || rules.some(rule => typeof rule !== "string"))) {
        throw new Error(`Invalid Antigravity permissions.${name}; fix the native settings before delegating.`);
      }
    }
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function agyArgs(job: Job): string[] {
  if (!job.model) throw new Error("AGY_MODEL is required. Run setup with --agy-mcp to select an Antigravity model.");
  const readOnly = job.mode === "read-only";
  if (readOnly && !job.scratch) throw new Error("Read-only Antigravity job has no scratch directory.");
  if (readOnly && /[()\r\n]/.test(job.workspace + job.scratch)) {
    throw new Error("Antigravity permission paths cannot contain parentheses or newlines.");
  }
  const existing = nativeSettings();
  // Native terminal sandbox mounts its working directory read-write. Reviews
  // therefore run from scratch, with the original workspace granted only reads.
  const settings = {
    agentMode: readOnly ? "" : "auto",
    toolPermission: existing.toolPermission === "strict" ? "strict" : readOnly ? "proceed-in-sandbox" : "request-review",
    enableTerminalSandbox: true,
    allowNonWorkspaceAccess: false,
    permissions: {
      allow: readOnly ? [`read_file(${job.workspace})`, `write_file(${job.scratch})`] : existing.permissions?.allow ?? [],
      ask: existing.permissions?.ask ?? [],
      deny: [...(existing.permissions?.deny ?? []), "mcp(*)", ...(readOnly ? [`write_file(${job.workspace})`, "read_url(*)", "execute_url(*)"] : [])],
    },
  };
  return ["--input-format", "stream-json", "--output-format", "stream-json", "--model", job.model,
    "--disable-slash-commands", "--sandbox", "--settings", JSON.stringify(settings)];
}

export function agyInput(prompt: string): string {
  return JSON.stringify({ event: "user", message: { content: prompt } }) + "\n";
}
