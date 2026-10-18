import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { isCodexProvider, isFinished, providerLabel, type Job } from "./tasks.js";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Claude Code consumes these events from Codex-backed delegation servers. The
// reverse Claude server is hosted by Codex, which does not use this protocol.
export async function notifyChannel(server: Pick<Server, "notification">, job: Job, options: {
  source: string;
  toolPrefix: string;
} = { source: `${job.provider}-delegate`, toolPrefix: `delegate_${job.provider}` }): Promise<void> {
  if (!isCodexProvider(job.provider) || !isFinished(job)) return;
  const duration = formatDuration((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.createdAt));
  try {
    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content: `${providerLabel(job.provider)} ${job.type} task ${job.id} ${job.status} after ${duration}. ` +
          `Call ${options.toolPrefix}_status with task_id "${job.id}" to get the saved result and diagnostics.`,
        meta: { task_id: job.id, task_type: job.type, status: job.status, duration },
      },
    });
  } catch (error) {
    // Delivery is best effort and must never change the persisted job outcome.
    console.error(`[${options.source}] Channel notification failed: ${error instanceof Error ? error.message : error}`);
  }
}
