import { execFile } from "node:child_process";
import type { Job } from "./tasks.js";

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
