import { execFile } from "node:child_process";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { isFinished, type Job } from "./tasks.js";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Claude Code consumes these events from codex-delegate. The reverse server is
// hosted by Codex, which does not use Claude's channel protocol.
export async function notifyChannel(server: Pick<Server, "notification">, job: Job): Promise<void> {
  if (job.provider !== "codex" || !isFinished(job)) return;
  const duration = formatDuration((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.createdAt));
  try {
    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content: `Codex ${job.type} task ${job.id} ${job.status} after ${duration}. ` +
          `Call delegate_codex_status with task_id "${job.id}" to get the saved result and diagnostics.`,
        meta: { task_id: job.id, task_type: job.type, status: job.status, duration },
      },
    });
  } catch (error) {
    // Delivery is best effort and must never change the persisted job outcome.
    console.error(`[codex-delegate] Channel notification failed: ${error instanceof Error ? error.message : error}`);
  }
}

export function notifyCompletion(job: Job): void {
  if (process.env.DUAL_AGENT_NOTIFICATIONS === "0" || job.status === "interrupted") return;
  const title = `${job.provider === "claude" ? "Claude" : "Codex"} task ${job.status}`;
  const message = `Task ${job.id}. Read the result with delegate_${job.provider}_status.`;
  const command = process.platform === "darwin" ? "osascript" : process.platform === "win32" ? "powershell" : "notify-send";
  const args = process.platform === "darwin"
    ? ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]
    : process.platform === "win32"
      ? ["-Command", `New-BurntToastNotification -Text '${title}', '${message}'`]
      : [title, message, "--urgency=normal"];
  // Notifications are optional and never affect the persisted task result.
  execFile(command, args, { timeout: 2000 }, () => {});
}
