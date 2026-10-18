#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";

// Claude Code host: retain the same completion-channel behavior as Codex
// delegation while running Codex under the Rosalind profile.
serveDelegation({
  provider: "rosalind",
  serverName: "rosalind-delegate",
  toolPrefix: "delegate_rosalind",
  label: "Rosalind",
  enableChannel: true,
  channelSource: "rosalind-delegate",
}).catch(error => { console.error(error); process.exit(1); });
