#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// This is the entrypoint registered in the interactive Antigravity client.
const provider = process.argv[2];
if (provider !== "codex" && provider !== "claude" && provider !== "rosalind" && provider !== "agy") {
  console.error("Expected a review worker: codex, claude, rosalind or agy.");
  process.exit(1);
}
serveDelegation({ provider, reviewsOnly: true, enableChannel: false }).catch(error => { console.error(error); process.exit(1); });
