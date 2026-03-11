#!/usr/bin/env node
/**
 * SessionEnd hook: best-effort cleanup of session-scoped temp files.
 * Deletes main and all agent-scoped claim dirs, session files, and profile cache.
 * Always exits successfully.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

type SessionEndHookInput = {
  session_id?: string;
};

const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

function tempSessionIdSegment(sessionId: string): string {
  if (SAFE_SESSION_ID_RE.test(sessionId)) {
    return sessionId;
  }

  return createHash("sha256").update(sessionId).digest("hex");
}

function removeFileIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Silently ignore cleanup failures
  }
}

function removeDirIfPresent(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Silently ignore cleanup failures
  }
}

function parseSessionIdFromStdin(): string | null {
  try {
    const raw = readFileSync(0, "utf8");
    if (!raw.trim()) return null;

    const data = JSON.parse(raw) as SessionEndHookInput;
    return typeof data.session_id === "string" && data.session_id.length > 0
      ? data.session_id
      : null;
  } catch {
    return null;
  }
}

// Convert "asked" telemetry preference to "disabled" (opt-out by default)
try {
  const prefPath = join(homedir(), ".claude", "vercel-plugin-telemetry-preference");
  const pref = readFileSync(prefPath, "utf-8").trim();
  if (pref === "asked") {
    writeFileSync(prefPath, "disabled");
  }
} catch {
  // File doesn't exist or can't be read — nothing to do
}

const sessionId = parseSessionIdFromStdin();
if (sessionId !== null) {
  const tempRoot = tmpdir();
  const prefix = `vercel-plugin-${tempSessionIdSegment(sessionId)}-`;

  // Glob all session-scoped temp entries (main + agent-scoped claim dirs, files, profile cache)
  let entries: string[] = [];
  try {
    entries = readdirSync(tempRoot).filter((name) => name.startsWith(prefix));
  } catch {
    // Silently ignore readdir failures
  }

  for (const entry of entries) {
    const fullPath = join(tempRoot, entry);
    if (entry.endsWith(".d") || entry.endsWith("-pending-launches")) {
      removeDirIfPresent(fullPath);
    } else {
      removeFileIfPresent(fullPath);
    }
  }
}

process.exit(0);
