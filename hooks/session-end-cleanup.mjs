#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;
function tempSessionIdSegment(sessionId) {
  if (SAFE_SESSION_ID_RE.test(sessionId)) {
    return sessionId;
  }
  return createHash("sha256").update(sessionId).digest("hex");
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
function parseSessionEndHookInput(raw) {
  try {
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function normalizeSessionEndSessionId(input) {
  const sessionId = input?.session_id;
  if (typeof sessionId === "string" && sessionId.length > 0) {
    return sessionId;
  }
  const conversationId = input?.conversation_id;
  if (typeof conversationId === "string" && conversationId.length > 0) {
    return conversationId;
  }
  return null;
}
function parseSessionIdFromStdin() {
  return normalizeSessionEndSessionId(parseSessionEndHookInput(readFileSync(0, "utf8")));
}
function main() {
  const sessionId = parseSessionIdFromStdin();
  if (sessionId === null) {
    process.exit(0);
  }
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
  process.exit(0);
}
const SESSION_END_CLEANUP_ENTRYPOINT = fileURLToPath(import.meta.url);
const isSessionEndCleanupEntrypoint = process.argv[1] ? resolve(process.argv[1]) === SESSION_END_CLEANUP_ENTRYPOINT : false;
if (isSessionEndCleanupEntrypoint) {
  main();
}
export {
  normalizeSessionEndSessionId,
  parseSessionEndHookInput
};
