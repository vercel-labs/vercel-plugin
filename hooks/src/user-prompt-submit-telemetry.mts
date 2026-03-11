#!/usr/bin/env node
/**
 * UserPromptSubmit hook: telemetry opt-in prompt.
 *
 * Fires once per session on the first user message if the user hasn't
 * recorded a telemetry preference yet. Returns a focused additionalContext
 * asking the model to prompt the user — isolated from skill injection
 * so it doesn't get buried.
 *
 * Writes "asked" to the preference file immediately so the user is never
 * re-prompted even if the model fails to persist the final answer.
 * session-end-cleanup converts "asked" → "disabled" (opt-out by default).
 *
 * Input:  JSON on stdin with { session_id }
 * Output: JSON on stdout with { hookSpecificOutput: { hookEventName, additionalContext } } or {}
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";

const PREF_PATH = join(homedir(), ".claude", "vercel-plugin-telemetry-preference");

function parseStdin(): Record<string, unknown> | null {
  try {
    const raw = readFileSync(0, "utf-8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function main(): void {
  // Already opted in, out, or asked — nothing to do
  try {
    const pref = readFileSync(PREF_PATH, "utf-8").trim();
    if (pref === "enabled" || pref === "disabled" || pref === "asked") {
      process.stdout.write("{}");
      process.exit(0);
    }
  } catch {
    // File doesn't exist — user hasn't decided yet
  }

  const input = parseStdin();
  const sessionId = (input?.session_id as string) || "";

  // Once-per-session guard: don't ask again after the first message
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
      // Race or permission issue — skip this time
      process.stdout.write("{}");
      process.exit(0);
    }
  }

  // Write "asked" immediately so we never re-prompt across sessions
  try {
    mkdirSync(dirname(PREF_PATH), { recursive: true });
    writeFileSync(PREF_PATH, "asked");
  } catch {
    // If we can't write, fall through — tmpdir flag still guards this session
  }

  const message = [
    "After responding to the user's message, use the AskUserQuestion tool to ask about telemetry.",
    "Use this exact question configuration:",
    '- question: "The Vercel plugin can collect anonymous telemetry data (skill usage, code changes, and commands) to help improve the plugin. Would you like to opt in?"',
    '- header: "Telemetry"',
    '- options: [{"label": "Enable telemetry", "description": "Share anonymous usage data to help improve the plugin"}, {"label": "No thanks", "description": "Disable telemetry — no data will be collected"}]',
    "- multiSelect: false",
    "",
    "After the user responds:",
    "- If they chose \"Enable telemetry\", run: `echo 'enabled' > ~/.claude/vercel-plugin-telemetry-preference`",
    "- If they chose \"No thanks\" or anything else, run: `echo 'disabled' > ~/.claude/vercel-plugin-telemetry-preference`",
  ].join("\n");

  const output: SyncHookJSONOutput = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit" as const,
      additionalContext: message,
    },
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
