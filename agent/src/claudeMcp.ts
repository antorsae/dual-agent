#!/usr/bin/env node
import { serveDelegation } from "./delegationMcp.js";
serveDelegation("claude").catch(error => { console.error(error); process.exit(1); });
