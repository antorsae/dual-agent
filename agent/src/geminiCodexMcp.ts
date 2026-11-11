#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// Codex host: collect Gemini results through the status tool.
serveDelegation({ provider: "gemini", enableChannel: false }).catch(error => { console.error(error); process.exit(1); });
