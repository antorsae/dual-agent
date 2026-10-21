#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// Codex host: expose the same Codex task tools without Claude Code's
// development-only completion channel capability.
serveDelegation({ provider: "codex", enableChannel: false }).catch(error => { console.error(error); process.exit(1); });
