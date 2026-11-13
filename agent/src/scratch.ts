import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Job } from "./tasks.js";

export async function createScratch(workspace: string, jobDirectory: string): Promise<string> {
  const parent = await realpath(jobDirectory);
  const fromWorkspace = relative(workspace, parent);
  if (!isAbsolute(fromWorkspace) && fromWorkspace !== ".." && !fromWorkspace.startsWith(`..${sep}`)) {
    throw new Error("Read-only jobs need DUAL_AGENT_STATE_DIR outside the workspace so scratch writes cannot modify project files.");
  }
  const scratch = join(parent, "scratch");
  await mkdir(scratch, { mode: 0o700 });
  await Promise.all(["tmp", "cache", "pycache"].map(name => mkdir(join(scratch, name), { mode: 0o700 })));
  return scratch;
}

export function readOnlyCodexArgs(job: Job): string[] {
  if (!job.scratch) throw new Error("Read-only Codex job has no isolated scratch directory.");
  // A unique profile prevents inheriting another profile's writable paths.
  const profile = `dual-agent-review-${job.id}`;
  return [
    // Unsupported Codex versions must reject the configuration, not ignore it.
    "--strict-config", "-c", 'approval_policy="never"',
    "-c", `default_permissions=${JSON.stringify(profile)}`,
    "-c", `permissions.${profile}={filesystem={":root"="read",${JSON.stringify(job.scratch)}="write"},network={enabled=false}}`,
  ];
}

export function scratchEnvironment(scratch: string): Record<string, string> {
  // pytest parses this variable with shlex, including when paths contain spaces.
  const cacheOption = `'${`cache_dir=${join(scratch, "pytest-cache")}`.replaceAll("'", "'\"'\"'")}'`;
  return {
    DUAL_AGENT_SCRATCH_DIR: scratch,
    TMPDIR: join(scratch, "tmp"), TMP: join(scratch, "tmp"), TEMP: join(scratch, "tmp"),
    XDG_CACHE_HOME: join(scratch, "cache"),
    PYTHONPYCACHEPREFIX: join(scratch, "pycache"),
    PYTEST_ADDOPTS: `${process.env.PYTEST_ADDOPTS ?? ""} -o ${cacheOption}`.trim(),
    COVERAGE_FILE: join(scratch, ".coverage"),
    npm_config_cache: join(scratch, "cache", "npm"),
  };
}
