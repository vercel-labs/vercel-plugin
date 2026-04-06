#!/usr/bin/env node

// hooks/src/user-prompt-submit-telemetry.mts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, dirname } from "path";
import { getTelemetryOverride, isPromptTelemetryEnabled, trackEvents } from "./telemetry.mjs";
var PREF_PATH = join(homedir(), ".claude", "vercel-plugin-telemetry-preference");
var MIN_PROMPT_LENGTH = 10;
function parseStdin() {
  try {
    const raw = readFileSync(0, "utf-8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function resolveSessionId(input) {
  return input.session_id || input.conversation_id || "";
}
function resolvePrompt(input) {
  return input.prompt || input.message || "";
}
async function main() {
  const input = parseStdin();
  const sessionId = input ? resolveSessionId(input) : "";
  const prompt = input ? resolvePrompt(input) : "";
  const telemetryOverride = getTelemetryOverride();
  if (isPromptTelemetryEnabled() && sessionId && prompt.length >= MIN_PROMPT_LENGTH) {
    await trackEvents(sessionId, [
      { key: "prompt:text", value: prompt }
    ]).catch(() => {
    });
  }
  if (telemetryOverride === "on" || telemetryOverride === "off") {
    process.stdout.write("{}");
    process.exit(0);
  }
  try {
    const pref = readFileSync(PREF_PATH, "utf-8").trim();
    if (pref === "enabled" || pref === "disabled" || pref === "asked") {
      process.stdout.write("{}");
      process.exit(0);
    }
  } catch {
  }
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
  try {
    mkdirSync(dirname(PREF_PATH), { recursive: true });
    writeFileSync(PREF_PATH, "asked");
  } catch {
  }
  const message = [
    "After responding to the user's message, use the AskUserQuestion tool to ask about telemetry.",
    "Use this exact question configuration:",
    '- question: "The Vercel plugin collects anonymous usage data (skill injection patterns, tools used) by default to improve the plugin unless VERCEL_PLUGIN_TELEMETRY=off is set. Would you also like to share your prompts to help us improve skill matching?"',
    '- header: "Telemetry"',
    '- options: [{"label": "Share prompts", "description": "Also share prompt text to help improve skill matching accuracy"}, {"label": "No thanks", "description": "Keep prompt text private \u2014 base telemetry stays on unless VERCEL_PLUGIN_TELEMETRY=off is set"}]',
    "- multiSelect: false",
    "",
    "After the user responds:",
    "- If they chose \"Share prompts\", run: `echo 'enabled' > ~/.claude/vercel-plugin-telemetry-preference`",
    "- If they chose \"No thanks\" or anything else, run: `echo 'disabled' > ~/.claude/vercel-plugin-telemetry-preference`"
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
