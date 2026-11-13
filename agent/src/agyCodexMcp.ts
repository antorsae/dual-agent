#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// Codex host: collect Antigravity results through the status tool.
serveDelegation({ provider: "agy", enableChannel: false }).catch(error => { console.error(error); process.exit(1); });
