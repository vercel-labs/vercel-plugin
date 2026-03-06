#!/usr/bin/env node
/**
 * SessionStart hook: initialize the seen-skills dedup env var.
 * Appends `export VERCEL_PLUGIN_SEEN_SKILLS=""` to CLAUDE_ENV_FILE
 * so the PreToolUse hook can track which skills have already been injected.
 */

import { appendFileSync } from "node:fs";

const envFile = process.env.CLAUDE_ENV_FILE;

if (!envFile) {
  process.exit(0);
}

try {
  appendFileSync(envFile, 'export VERCEL_PLUGIN_SEEN_SKILLS=""\n');
} catch {
  // Silently ignore — non-critical
}
