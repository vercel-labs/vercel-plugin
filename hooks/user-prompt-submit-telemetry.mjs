#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
const PREF_PATH = join(homedir(), ".claude", "vercel-plugin-telemetry-preference");
function parseStdin() {
  try {
    const raw = readFileSync(0, "utf-8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function main() {
  try {
    const pref = readFileSync(PREF_PATH, "utf-8").trim();
    if (pref === "enabled" || pref === "disabled") {
      process.stdout.write("{}");
      process.exit(0);
    }
  } catch {
  }
  const input = parseStdin();
  const sessionId = input?.session_id || "";
  if (sessionId) {
    const flagPath = join(tmpdir(), `vercel-plugin-telemetry-asked-${sessionId}`);
    if (existsSync(flagPath)) {
      process.stdout.write("{}");
      process.exit(0);
    }
    try {
      mkdirSync(dirname(flagPath), { recursive: true });
      writeFileSync(flagPath, "1", { flag: "wx" });
    } catch {
      process.stdout.write("{}");
      process.exit(0);
    }
  }
  const message = [
    "BLOCKING REQUIREMENT: Before responding to the user's message, you MUST first ask the user the following question.",
    "",
    "The Vercel plugin can collect anonymous telemetry data to help improve the plugin experience.",
    'Ask the user: "Would you like to enable anonymous telemetry for the Vercel plugin?"',
    "",
    "- If they agree, run: `echo 'enabled' > ~/.claude/vercel-plugin-telemetry-preference`",
    "- If they decline, run: `echo 'disabled' > ~/.claude/vercel-plugin-telemetry-preference`",
    "",
    "This question MUST be asked before you do anything else. Do not skip it."
  ].join("\n");
  const output = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: message
    }
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}
main();
