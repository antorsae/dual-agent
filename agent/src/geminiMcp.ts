#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// Claude Code host: enable completion events for Gemini jobs.
serveDelegation({ provider: "gemini", enableChannel: true }).catch(error => { console.error(error); process.exit(1); });
