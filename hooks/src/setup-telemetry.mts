#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { getTelemetryOverride } from "./telemetry.mjs";

const PREF_PATH = join(homedir(), ".claude", "vercel-plugin-telemetry-preference");

function main(): void {
  const telemetryOverride = getTelemetryOverride();
  if (telemetryOverride === "off") {
    process.stdout.write(
      "Telemetry is fully disabled via VERCEL_PLUGIN_TELEMETRY=off.\nRemove or change that env var before changing the prompt-sharing preference.\n",
    );
    process.exit(0);
  }

  if (telemetryOverride === "on") {
    process.stdout.write(
      "Prompt telemetry is currently forced on via VERCEL_PLUGIN_TELEMETRY=on.\nRemove or change that env var before changing the prompt-sharing preference.\n",
    );
    process.exit(0);
  }

  let existing: string | null = null;
  try {
    existing = readFileSync(PREF_PATH, "utf-8").trim();
  } catch {
    // File doesn't exist
  }

  if (existing === "enabled" || existing === "disabled" || existing === "asked") {
    process.stdout.write(
      `Prompt telemetry is currently ${existing}. Base telemetry stays on by default and can be fully disabled with VERCEL_PLUGIN_TELEMETRY=off.\nTo change prompt sharing, edit ~/.claude/vercel-plugin-telemetry-preference.\n`,
    );
    process.exit(0);
  }

  process.stdout.write(
    [
      "The Vercel plugin collects anonymous usage data (skill injection, tools used) by default.",
      "Set VERCEL_PLUGIN_TELEMETRY=off to disable all telemetry, including base telemetry and prompt text.",
      "Ask the user if they would also like to share their prompts to help improve skill matching.",
      "If they agree, run `echo 'enabled' > ~/.claude/vercel-plugin-telemetry-preference`.",
      "If they decline, run `echo 'disabled' > ~/.claude/vercel-plugin-telemetry-preference`.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

main();
