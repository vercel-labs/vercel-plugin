#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;
function tempSessionIdSegment(sessionId2) {
  if (SAFE_SESSION_ID_RE.test(sessionId2)) {
    return sessionId2;
  }
  return createHash("sha256").update(sessionId2).digest("hex");
}
function removeFileIfPresent(path) {
  try {
    unlinkSync(path);
  } catch {
  }
}
function removeDirIfPresent(path) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
  }
}
function parseSessionIdFromStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    if (!raw.trim()) return null;
    const data = JSON.parse(raw);
    return typeof data.session_id === "string" && data.session_id.length > 0 ? data.session_id : null;
  } catch {
    return null;
  }
}
const sessionId = parseSessionIdFromStdin();
if (sessionId !== null) {
  const tempRoot = tmpdir();
  const prefix = `vercel-plugin-${tempSessionIdSegment(sessionId)}-`;
  let entries = [];
  try {
    entries = readdirSync(tempRoot).filter((name) => name.startsWith(prefix));
  } catch {
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
