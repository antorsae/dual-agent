import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyChannel } from "../dist/notifications.js";

test("a disconnected channel cannot reject completion or change the job outcome", async t => {
  const errors = t.mock.method(console, "error", () => {});
  const job = Object.freeze({
    id: "saved-job", provider: "codex", type: "review", status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
  });
  await assert.doesNotReject(notifyChannel({
    notification: async () => { throw new Error("Not connected"); },
  }, job));
  assert.equal(errors.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments[0], /Channel notification failed: Not connected/);
  assert.equal(job.status, "completed");
});
