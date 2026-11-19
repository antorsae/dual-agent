import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AGY_MODEL_ID, parseAgyCatalog, parseAgyModels } from "./agyModels.mjs";

const execFileAsync = promisify(execFile);

function configuredPriority(): string[] {
  return parseAgyModels(process.env.AGY_MODELS ?? process.env.AGY_MODEL ?? "");
}

async function agyInfo(args: string[]): Promise<string> {
  const command = execFileAsync(process.env.AGY_BIN || "agy", args, {
    encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
  });
  command.child.stdin?.end();
  try {
    return (await command).stdout;
  } catch (error) {
    // CLI diagnostics may include account details. Surface only the exit reason.
    const failure = error as { code?: string | number; killed?: boolean };
    const reason = failure.killed ? "timed out" : `failed (${failure.code ?? "unknown error"})`;
    throw new Error(`agy ${args[0]} ${reason}`);
  }
}

async function availableModels() {
  const catalog = parseAgyCatalog(await agyInfo(["models"]));
  if (!catalog.length) throw new Error("agy models returned no model IDs.");
  return catalog;
}

export async function selectAgyModels(override?: string[]): Promise<string[]> {
  if (override === undefined) return configuredPriority();
  if (!Array.isArray(override) || !override.length || override.some(id => typeof id !== "string" || !AGY_MODEL_ID.test(id))) {
    throw new Error("models must be a nonempty array of model IDs from delegate_agy_models.");
  }
  const priority = [...new Set(override)];
  const available = new Set((await availableModels()).map(model => model.id));
  const unknown = priority.filter(id => !available.has(id));
  if (unknown.length) throw new Error(`Unavailable AGY model IDs: ${unknown.join(", ")}. Check delegate_agy_models.`);
  return priority;
}

async function accountQuota() {
  // Force the built-in slash command even if slash commands are disabled in user settings.
  const output = await agyInfo(["--print=/usage", "--output-format", "json", "--settings", '{"disableSlashCommands":false}']);
  let result;
  try { result = JSON.parse(output); }
  catch { throw new Error("AGY returned an unreadable /usage response."); }
  const groups = result?.command?.data?.groups;
  if (result?.status !== "SUCCESS" || result.command?.name !== "usage" || !Array.isArray(groups) || !groups.length) {
    throw new Error("AGY did not report account quota groups.");
  }
  return groups.map(group => {
    if (typeof group?.name !== "string" || !Array.isArray(group.buckets)) throw new Error("Unrecognized AGY quota group.");
    // Preserve the CLI's displayed window label even for model-specific limits.
    return {
      name: group.name,
      description: typeof group.description === "string" ? group.description : null,
      limits: group.buckets.map((bucket: { window?: string; name?: string; remaining_fraction?: number; reset_time?: string }) => {
        const remaining = bucket?.remaining_fraction;
        return {
          name: typeof bucket?.name === "string" ? bucket.name : null,
          window: typeof bucket?.window === "string" ? bucket.window : null,
          remaining_percent: typeof remaining === "number" && remaining >= 0 && remaining <= 1 ? remaining * 100 : null,
          resets_at: typeof bucket?.reset_time === "string" ? bucket.reset_time : null,
        };
      }),
    };
  });
}

export async function agyModelOptions() {
  const [catalog, quota] = await Promise.allSettled([availableModels(), accountQuota()]);
  const errors: Record<string, string> = {};
  let defaultPriority: string[] = [];
  try { defaultPriority = configuredPriority(); }
  catch (error) { errors.default_priority = (error as Error).message; }
  if (catalog.status === "rejected") errors.available_models = catalog.reason.message;
  if (quota.status === "rejected") errors.quota_groups = quota.reason.message;
  return {
    checked_at: new Date().toISOString(),
    default_priority: defaultPriority,
    available_models: catalog.status === "fulfilled" ? catalog.value : null,
    quota_groups: quota.status === "fulfilled" ? quota.value : null,
    guidance: [
      "Use the default priority for routine work. For complex cross-file reviews or concurrency bugs, consider Neon XHigh and Opus 5.5 High. Carbon High suits long architectural investigations, Argon High suits involved debugging, and Hydrogen or Flash suit quick, scoped checks. Select IDs offered in available_models.",
      "Consult the reported group descriptions and all remaining quota windows. When headroom is low, prefer a suitable model in a group with available quota. Preserve an explicitly requested model or order. Missing quota information means unknown.",
      "Pass models in the order to try for this job. A one-item list pins the model. Omit models to use default_priority.",
    ],
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}
