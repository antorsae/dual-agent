#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// Claude Code host: enable completion events for Antigravity jobs.
serveDelegation({ provider: "agy", enableChannel: true }).catch(error => { console.error(error); process.exit(1); });
