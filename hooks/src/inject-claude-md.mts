#!/usr/bin/env node
/**
 * SessionStart hook: inject vercel.md as additional context.
 * Outputs the contents of vercel.md to stdout so Claude Code adds it
 * to the conversation context at session start.
 */

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const content = readFileSync(join(PLUGIN_ROOT, "vercel.md"), "utf-8");
  process.stdout.write(content);
} catch {
  // vercel.md not found — silently exit
}
