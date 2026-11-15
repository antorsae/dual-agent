import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Shared by the worker and setup, which runs before TypeScript is built.
export const DEFAULT_AGY_MODELS = [
  "gemini-4-hydrogen-xhigh", "gemini-4-argon-high", "claude-opus-5-5-high",
];

/** @param {string} value */
export function parseAgyModels(value) {
  const models = value.split(",").map(model => model.trim());
  if (!models.length || models.some(model => !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model))) {
    throw new Error("AGY_MODELS must be a comma-separated priority list of model IDs from agy models.");
  }
  return [...new Set(models)];
}

/** Only native terminal errors qualify; never inspect model answers or tool output.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAgyQuotaError(error) {
  if (typeof error === "object" && error !== null) {
    const fields = /** @type {Record<string, unknown>} */ (error);
    // Authentication and permission failures must never be retried as quota failures.
    if (Object.values(fields).some(value => typeof value === "string" && /\b(?:UNAUTHENTICATED|PERMISSION_DENIED)\b/.test(value))) return false;
    if ([fields.code, fields.http_status, fields.http_status_code, fields.status_code, fields.status].some(value => value === 429 || value === "429")) return true;
    return [fields.status, fields.code, fields.message, fields.error].some(isAgyQuotaError);
  }
  return typeof error === "string" && !/\b(?:UNAUTHENTICATED|PERMISSION_DENIED|authentication (?:failed|required)|invalid api.?key)\b/i.test(error) && (
    /\bRESOURCE_EXHAUSTED\b/i.test(error) ||
    /\b(?:quota|rate[ -]?limit|usage limit)\b.{0,100}\b(?:exhausted|exceeded|reached|depleted|insufficient)\b/i.test(error) ||
    /\b(?:exhausted|exceeded|reached|depleted)\b.{0,100}\b(?:quota|rate[ -]?limit|usage limit)\b/i.test(error) ||
    /\b(?:HTTP(?:\/[\d.]+)?|status(?: code)?)\s*[:=]?\s*429\b/i.test(error) || /\btoo many requests\b/i.test(error)
  );
}

/** @param {string} line @returns {unknown} */
export function parseAgyError(line) {
  const match = line.match(/^\s*AGY_ERROR:\s*(\{.*\})\s*$/);
  if (!match) return undefined;
  try { return JSON.parse(match[1]); } catch { return undefined; }
}

/** @param {string} file */
function catalogIds(file) {
  return readFileSync(file, "utf8").split(/\r?\n/).filter(line => line.includes("\t"))
    .map(line => line.split("\t")[0]).filter(id => /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [operation, value, file, exitCode] = process.argv.slice(2);
    if (operation === "defaults") {
      const available = catalogIds(value);
      process.stdout.write(DEFAULT_AGY_MODELS.filter(model => available.includes(model)).join(","));
    } else if (operation === "validate") {
      const models = parseAgyModels(value);
      const available = catalogIds(file);
      for (const model of models) if (!available.includes(model)) throw new Error(`Antigravity model is unavailable: ${model}`);
      process.stdout.write(models.join(","));
    } else if (operation === "check") {
      let result;
      try { result = JSON.parse(readFileSync(value, "utf8")); } catch { /* Some failures only emit AGY_ERROR. */ }
      if (exitCode === "0" && result?.status === "SUCCESS" && !result.error &&
          !result.denied_actions?.length && result.response?.trim() === "DUAL_AGENT_PROFILE_OK") process.exit(0);
      const diagnostics = readFileSync(file, "utf8").split(/\r?\n/).map(parseAgyError);
      const quota = !result?.denied_actions?.length && (isAgyQuotaError(result?.error) ||
        isAgyQuotaError(result?.status) || (exitCode !== "0" && diagnostics.some(isAgyQuotaError)));
      console.error(quota ? "Antigravity model quota/rate limit exhausted." : "Antigravity verification failed; inspect the installer log.");
      process.exit(quota ? 75 : 1);
    } else {
      throw new Error("Unknown Antigravity model operation.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
