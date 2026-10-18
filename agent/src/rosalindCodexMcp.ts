#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// Codex host: expose the same Rosalind task tools without Claude Code's
// development-only completion channel capability.
serveDelegation({
  provider: "rosalind",
  serverName: "rosalind-delegate",
  toolPrefix: "delegate_rosalind",
  label: "Rosalind",
  enableChannel: false,
}).catch(error => { console.error(error); process.exit(1); });
