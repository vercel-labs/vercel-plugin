/**
 * Structured log-level system for hook output.
 *
 * Levels (ascending verbosity):
 *   off     — no output (default, preserves existing behavior)
 *   summary — outcome + latency + issues only
 *   debug   — adds match reasons, dedup info, skill map stats
 *   trace   — adds per-pattern evaluation details
 *
 * Env vars (checked in order):
 *   VERCEL_PLUGIN_LOG_LEVEL  — explicit level name
 *   VERCEL_PLUGIN_DEBUG=1    — legacy, maps to "debug"
 *   VERCEL_PLUGIN_HOOK_DEBUG=1 — legacy, maps to "debug"
 */
import { randomBytes } from "node:crypto";
const LEVELS = ["off", "summary", "debug", "trace"];
const LEVEL_INDEX = {
    off: 0,
    summary: 1,
    debug: 2,
    trace: 3,
};
/**
 * Resolve the active log level from environment variables.
 */
export function resolveLogLevel() {
    const explicit = (process.env.VERCEL_PLUGIN_LOG_LEVEL || "").toLowerCase().trim();
    if (explicit && LEVEL_INDEX[explicit] !== undefined) {
        return explicit;
    }
    // Legacy boolean flags → debug
    if (process.env.VERCEL_PLUGIN_DEBUG === "1" ||
        process.env.VERCEL_PLUGIN_HOOK_DEBUG === "1") {
        return "debug";
    }
    return "off";
}
/**
 * Create a logger instance bound to a specific invocation.
 */
export function createLogger(opts) {
    const level = typeof opts === "string" ? opts : (opts && opts.level) || resolveLogLevel();
    const rank = LEVEL_INDEX[level] || 0;
    const active = rank > 0;
    const invocationId = active ? randomBytes(4).toString("hex") : "";
    const safeNow = typeof performance !== "undefined" && typeof performance.now === "function"
        ? () => performance.now()
        : () => Date.now();
    const t0 = active ? safeNow() : 0;
    function emit(minLevel, event, data) {
        if (rank < (LEVEL_INDEX[minLevel] || 0))
            return;
        const line = JSON.stringify({
            invocationId,
            event,
            timestamp: new Date().toISOString(),
            ...data,
        });
        process.stderr.write(line + "\n");
    }
    return {
        level,
        active,
        t0,
        now: safeNow,
        elapsed() {
            return Math.round(safeNow() - t0);
        },
        issue(code, message, hint, context) {
            emit("summary", "issue", { code, message, hint, context });
        },
        complete(reason, counts, timing) {
            const { matchedCount = 0, injectedCount = 0, dedupedCount = 0, cappedCount = 0, } = counts || {};
            emit("summary", "complete", {
                reason,
                matchedCount,
                injectedCount,
                dedupedCount,
                cappedCount,
                elapsed_ms: Math.round(safeNow() - t0),
                ...(timing ? { timing_ms: timing } : {}),
            });
        },
        debug(event, data) {
            emit("debug", event, data);
        },
        trace(event, data) {
            emit("trace", event, data);
        },
        isEnabled(minLevel) {
            return rank >= (LEVEL_INDEX[minLevel] || 0);
        },
    };
}
export { LEVELS, LEVEL_INDEX };
