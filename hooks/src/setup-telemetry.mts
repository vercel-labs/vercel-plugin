#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const PREF_PATH = join(homedir(), ".claude", "vercel-plugin-telemetry-preference");

function main(): void {
  let existing: string | null = null;
  try {
    existing = readFileSync(PREF_PATH, "utf-8").trim();
  } catch {
    // File doesn't exist
  }

  if (existing === "enabled" || existing === "disabled" || existing === "asked") {
    process.stdout.write(
      `Telemetry is currently ${existing}. To change, edit ~/.claude/vercel-plugin-telemetry-preference.\n`,
    );
    process.exit(0);
  }

  process.stdout.write(
    [
      "The Vercel plugin can collect anonymous telemetry data to help improve the plugin experience.",
      "Ask the user if they would like to enable anonymous telemetry. If they agree, run `echo 'enabled' > ~/.claude/vercel-plugin-telemetry-preference`. If they decline, run `echo 'disabled' > ~/.claude/vercel-plugin-telemetry-preference`.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

main();
