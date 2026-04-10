#!/usr/bin/env node

// hooks/src/setup-telemetry.mts
import { getTelemetryOverride } from "./telemetry.mjs";
function main() {
  const telemetryOverride = getTelemetryOverride();
  if (telemetryOverride === "off") {
    process.stdout.write("Telemetry is fully disabled via VERCEL_PLUGIN_TELEMETRY=off.\n");
    process.exit(0);
  }
  if (telemetryOverride === "true") {
    process.stdout.write("Expanded telemetry is enabled via VERCEL_PLUGIN_TELEMETRY=true.\n");
    process.exit(0);
  }
  process.stdout.write(
    [
      "The default telemetry profile is a once-per-day DAU phone-home that sends only dau:active_today.",
      "To opt in to expanded telemetry, set VERCEL_PLUGIN_TELEMETRY=true in the environment that launches your agent. Expanded telemetry is currently limited to skill-injection events.",
      "To disable all telemetry, set VERCEL_PLUGIN_TELEMETRY=off.",
      ""
    ].join("\n")
  );
  process.exit(0);
}
main();
