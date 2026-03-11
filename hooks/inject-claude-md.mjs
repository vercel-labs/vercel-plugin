#!/usr/bin/env node
import { join } from "node:path";
import { pluginRoot, safeReadFile } from "./hook-env.mjs";
const parts = [];
const content = safeReadFile(join(pluginRoot(), "vercel.md"));
if (content !== null) {
  parts.push(content);
}
if (process.env.VERCEL_PLUGIN_GREENFIELD === "true") {
  parts.push(`<!-- vercel-plugin:greenfield-execution -->
## Greenfield execution mode

This directory is empty.
Do not stop in planning mode or spin up a read-only planning subagent.
Choose sensible defaults immediately.
Start executing with real tool calls.
Use non-interactive scaffolding commands (--yes) where available.
Only ask follow-up questions when blocked by missing credentials or irreversible decisions.`);
}
if (parts.length > 0) {
  process.stdout.write(parts.join("\n\n"));
}
