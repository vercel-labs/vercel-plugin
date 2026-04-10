// hooks/src/telemetry.mts
import { randomUUID } from "crypto";
import { mkdirSync, statSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
var MAX_VALUE_BYTES = 1e5;
var TRUNCATION_SUFFIX = "[TRUNCATED]";
var BRIDGE_ENDPOINT = "https://telemetry.vercel.com/api/vercel-plugin/v1/events";
var FLUSH_TIMEOUT_MS = 3e3;
var DAU_STAMP_PATH = join(homedir(), ".config", "vercel-plugin", "dau-stamp");
function truncateValue(value) {
  if (Buffer.byteLength(value, "utf-8") <= MAX_VALUE_BYTES) {
    return value;
  }
  const truncated = Buffer.from(value, "utf-8").subarray(0, MAX_VALUE_BYTES).toString("utf-8");
  return truncated + TRUNCATION_SUFFIX;
}
async function send(sessionId, events) {
  if (events.length === 0) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  try {
    await fetch(BRIDGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vercel-plugin-session-id": sessionId,
        "x-vercel-plugin-topic-id": "generic"
      },
      body: JSON.stringify(events),
      signal: controller.signal
    });
  } catch {
  } finally {
    clearTimeout(timeout);
  }
}
async function sendDau(events) {
  if (events.length === 0) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  try {
    const response = await fetch(BRIDGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vercel-plugin-topic-id": "dau"
      },
      body: JSON.stringify(events),
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
function getDauStampPath() {
  return DAU_STAMP_PATH;
}
function utcDayStamp(date) {
  return date.toISOString().slice(0, 10);
}
function shouldSendDauPing(now = /* @__PURE__ */ new Date()) {
  try {
    const existingMtime = statSync(DAU_STAMP_PATH).mtime;
    return utcDayStamp(existingMtime) !== utcDayStamp(now);
  } catch {
    return true;
  }
}
function markDauPingSent(now = /* @__PURE__ */ new Date()) {
  void now;
  try {
    mkdirSync(dirname(DAU_STAMP_PATH), { recursive: true });
    writeFileSync(DAU_STAMP_PATH, "", { flag: "w" });
  } catch {
  }
}
function getTelemetryOverride(env = process.env) {
  const value = env.VERCEL_PLUGIN_TELEMETRY?.trim().toLowerCase();
  if (value === "off") return value;
  if (value === "true") return value;
  return null;
}
function isDauTelemetryEnabled(env = process.env) {
  return getTelemetryOverride(env) !== "off";
}
function isBaseTelemetryEnabled(env = process.env) {
  return getTelemetryOverride(env) === "true";
}
function isContentTelemetryEnabled(_env = process.env) {
  return false;
}
function isPromptTelemetryEnabled(env = process.env) {
  return isContentTelemetryEnabled(env);
}
async function trackDauActiveToday(now = /* @__PURE__ */ new Date()) {
  if (!isDauTelemetryEnabled() || !shouldSendDauPing(now)) return;
  const eventTime = now.getTime();
  const sent = await sendDau([{
    id: randomUUID(),
    event_time: eventTime,
    key: "dau:active_today",
    value: "1"
  }]);
  if (sent) {
    markDauPingSent(now);
  }
}
async function trackBaseEvent(sessionId, key, value) {
  if (!isBaseTelemetryEnabled()) return;
  const event = {
    id: randomUUID(),
    event_time: Date.now(),
    key,
    value: truncateValue(value)
  };
  await send(sessionId, [event]);
}
async function trackBaseEvents(sessionId, entries) {
  if (!isBaseTelemetryEnabled() || entries.length === 0) return;
  const now = Date.now();
  const events = entries.map((entry) => ({
    id: randomUUID(),
    event_time: now,
    key: entry.key,
    value: truncateValue(entry.value)
  }));
  await send(sessionId, events);
}
async function trackContentEvent(sessionId, key, value) {
  void sessionId;
  void key;
  void value;
}
async function trackContentEvents(sessionId, entries) {
  void sessionId;
  void entries;
}
async function trackEvent(sessionId, key, value) {
  await trackContentEvent(sessionId, key, value);
}
async function trackEvents(sessionId, entries) {
  await trackContentEvents(sessionId, entries);
}
export {
  getDauStampPath,
  getTelemetryOverride,
  isBaseTelemetryEnabled,
  isContentTelemetryEnabled,
  isDauTelemetryEnabled,
  isPromptTelemetryEnabled,
  markDauPingSent,
  shouldSendDauPing,
  trackBaseEvent,
  trackBaseEvents,
  trackContentEvent,
  trackContentEvents,
  trackDauActiveToday,
  trackEvent,
  trackEvents
};
