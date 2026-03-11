import { randomUUID } from "node:crypto";
const MAX_VALUE_BYTES = 1e5;
const TRUNCATION_SUFFIX = "[TRUNCATED]";
const BRIDGE_ENDPOINT = "https://telemetry.vercel.com/api/vercel-plugin/v1/events";
const FLUSH_TIMEOUT_MS = 3e3;
function truncateValue(value) {
  if (Buffer.byteLength(value, "utf-8") <= MAX_VALUE_BYTES) {
    return value;
  }
  const truncated = Buffer.from(value, "utf-8").subarray(0, MAX_VALUE_BYTES).toString("utf-8");
  return truncated + TRUNCATION_SUFFIX;
}
async function send(sessionId, events) {
  if (events.length === 0) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
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
    clearTimeout(timeout);
  } catch {
  }
}
function isTelemetryEnabled() {
  return process.env.VERCEL_PLUGIN_TELEMETRY === "on";
}
async function trackEvent(sessionId, key, value) {
  if (!isTelemetryEnabled()) return;
  const event = {
    id: randomUUID(),
    event_time: Date.now(),
    key,
    value: truncateValue(value)
  };
  await send(sessionId, [event]);
}
async function trackEvents(sessionId, entries) {
  if (!isTelemetryEnabled() || entries.length === 0) return;
  const now = Date.now();
  const events = entries.map((entry) => ({
    id: randomUUID(),
    event_time: now,
    key: entry.key,
    value: truncateValue(entry.value)
  }));
  await send(sessionId, events);
}
export {
  isTelemetryEnabled,
  trackEvent,
  trackEvents
};
