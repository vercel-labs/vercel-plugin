import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const MAX_VALUE_BYTES = 100_000;
const TRUNCATION_SUFFIX = "[TRUNCATED]";

const BRIDGE_ENDPOINT = "https://telemetry.vercel.com/api/vercel-plugin/v1/events";
const FLUSH_TIMEOUT_MS = 3_000;

const DAU_STAMP_PATH = join(homedir(), ".config", "vercel-plugin", "dau-stamp");

export interface TelemetryEvent {
  id: string;
  event_time: number;
  key: string;
  value: string;
}

function truncateValue(value: string): string {
  if (Buffer.byteLength(value, "utf-8") <= MAX_VALUE_BYTES) {
    return value;
  }
  const truncated = Buffer.from(value, "utf-8").subarray(0, MAX_VALUE_BYTES).toString("utf-8");
  return truncated + TRUNCATION_SUFFIX;
}

async function send(sessionId: string, events: TelemetryEvent[]): Promise<void> {
  if (events.length === 0) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  try {
    await fetch(BRIDGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vercel-plugin-session-id": sessionId,
        "x-vercel-plugin-topic-id": "generic",
      },
      body: JSON.stringify(events),
      signal: controller.signal,
    });
  } catch {
    // Best-effort
  } finally {
    clearTimeout(timeout);
  }
}

async function sendDau(events: TelemetryEvent[]): Promise<boolean> {
  if (events.length === 0) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  try {
    const response = await fetch(BRIDGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vercel-plugin-topic-id": "dau",
      },
      body: JSON.stringify(events),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// DAU stamp — local once-per-day throttle (always-on unless opted out)
// ---------------------------------------------------------------------------

export function getDauStampPath(): string {
  return DAU_STAMP_PATH;
}

function utcDayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shouldSendDauPing(now: Date = new Date()): boolean {
  try {
    const existingMtime = statSync(DAU_STAMP_PATH).mtime;
    return utcDayStamp(existingMtime) !== utcDayStamp(now);
  } catch {
    return true;
  }
}

export function markDauPingSent(now: Date = new Date()): void {
  void now;
  try {
    mkdirSync(dirname(DAU_STAMP_PATH), { recursive: true });
    writeFileSync(DAU_STAMP_PATH, "", { flag: "w" });
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Telemetry tiers
// ---------------------------------------------------------------------------

export function getTelemetryOverride(env: NodeJS.ProcessEnv = process.env): "off" | "true" | null {
  const value = env.VERCEL_PLUGIN_TELEMETRY?.trim().toLowerCase();
  if (value === "off") return value;
  if (value === "true") return value;
  return null;
}

/**
 * DAU telemetry is enabled by default, but users can disable all telemetry
 * with VERCEL_PLUGIN_TELEMETRY=off.
 */
export function isDauTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getTelemetryOverride(env) !== "off";
}

/**
 * Expanded telemetry is opt-in and only enabled when
 * VERCEL_PLUGIN_TELEMETRY=true.
 */
export function isBaseTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getTelemetryOverride(env) === "true";
}

/**
 * Prompt/content telemetry is disabled entirely.
 */
export function isContentTelemetryEnabled(_env: NodeJS.ProcessEnv = process.env): boolean {
  return false;
}

/**
 * Backward-compatible alias for older callers that still refer to prompt telemetry.
 */
export function isPromptTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isContentTelemetryEnabled(env);
}

// ---------------------------------------------------------------------------
// DAU telemetry (default-on, opt-out via VERCEL_PLUGIN_TELEMETRY=off)
// ---------------------------------------------------------------------------

export async function trackDauActiveToday(now: Date = new Date()): Promise<void> {
  if (!isDauTelemetryEnabled() || !shouldSendDauPing(now)) return;

  const eventTime = now.getTime();
  const sent = await sendDau([{
    id: randomUUID(),
    event_time: eventTime,
    key: "dau:active_today",
    value: "1",
  }]);

  if (sent) {
    markDauPingSent(now);
  }
}

// ---------------------------------------------------------------------------
// Expanded telemetry (opt-in via VERCEL_PLUGIN_TELEMETRY=true)
// ---------------------------------------------------------------------------

export async function trackBaseEvent(sessionId: string, key: string, value: string): Promise<void> {
  if (!isBaseTelemetryEnabled()) return;

  const event: TelemetryEvent = {
    id: randomUUID(),
    event_time: Date.now(),
    key,
    value: truncateValue(value),
  };

  await send(sessionId, [event]);
}

export async function trackBaseEvents(
  sessionId: string,
  entries: Array<{ key: string; value: string }>,
): Promise<void> {
  if (!isBaseTelemetryEnabled() || entries.length === 0) return;

  const now = Date.now();
  const events: TelemetryEvent[] = entries.map((entry) => ({
    id: randomUUID(),
    event_time: now,
    key: entry.key,
    value: truncateValue(entry.value),
  }));

  await send(sessionId, events);
}

// ---------------------------------------------------------------------------
// Prompt/content telemetry is intentionally disabled.
// ---------------------------------------------------------------------------

export async function trackContentEvent(sessionId: string, key: string, value: string): Promise<void> {
  void sessionId;
  void key;
  void value;
}

export async function trackContentEvents(
  sessionId: string,
  entries: Array<{ key: string; value: string }>,
): Promise<void> {
  void sessionId;
  void entries;
}

/**
 * Backward-compatible aliases for older callers that still refer to prompt telemetry.
 */
export async function trackEvent(sessionId: string, key: string, value: string): Promise<void> {
  await trackContentEvent(sessionId, key, value);
}

export async function trackEvents(
  sessionId: string,
  entries: Array<{ key: string; value: string }>,
): Promise<void> {
  await trackContentEvents(sessionId, entries);
}
