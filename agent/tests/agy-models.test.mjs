import assert from "node:assert/strict";
import { test } from "node:test";
import { isAgyQuotaError, parseAgyError, parseAgyModels } from "../dist/agyModels.mjs";

test("quota detection accepts native model-limit errors and rejects unrelated failures", () => {
  for (const error of [
    { status: "RESOURCE_EXHAUSTED", code: 8 }, { http_status: 429 },
    { error: { code: "429" } }, "RESOURCE_EXHAUSTED", "quota exceeded for this model",
    "You have reached the quota limit for this model", "Rate limit exceeded", "HTTP 429: too many requests",
  ]) assert.equal(isAgyQuotaError(error), true, JSON.stringify(error));
  for (const error of [
    undefined, null, {}, 429, { status: "UNAUTHENTICATED", message: "quota exceeded", code: 429 },
    "PERMISSION_DENIED: quota exceeded", "authentication required", "unknown model", "connection refused",
    "invalid API key", "tool execution failed", "quota report unavailable", "429 files inspected",
    { response: "quota exceeded", status: "SUCCESS" },
  ]) assert.equal(isAgyQuotaError(error), false, JSON.stringify(error));
  assert.deepEqual(parseAgyError('AGY_ERROR: {"status":"RESOURCE_EXHAUSTED"}'), { status: "RESOURCE_EXHAUSTED" });
  assert.equal(parseAgyError('tool output says AGY_ERROR: {"code":429}'), undefined);
  assert.equal(parseAgyError("AGY_ERROR: broken JSON"), undefined);
});

test("model priority preserves order, deduplicates, and rejects malformed configuration", () => {
  assert.deepEqual(parseAgyModels("second, first,second"), ["second", "first"]);
  for (const input of ["", "first,", ",first", "first,,second", "--model", "first > second"]) {
    assert.throws(() => parseAgyModels(input), /AGY_MODELS/);
  }
});
