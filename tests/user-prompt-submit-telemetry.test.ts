import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK = join(ROOT, "hooks", "user-prompt-submit-telemetry.mjs");
const NODE_BIN = Bun.which("node") || "node";

let tempHome: string;
let prefPath: string;

async function runHook(env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  const mergedEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete mergedEnv[key];
      continue;
    }
    mergedEnv[key] = value;
  }

  const proc = Bun.spawn([NODE_BIN, HOOK], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: mergedEnv,
  });

  proc.stdin.write(JSON.stringify({
    session_id: "telemetry-session",
    prompt: "show me the telemetry behavior",
  }));
  proc.stdin.end();

  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "prompt-telemetry-home-"));
  prefPath = join(tempHome, ".claude", "vercel-plugin-telemetry-preference");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("user-prompt-submit-telemetry", () => {
  test("does not ask for telemetry when VERCEL_PLUGIN_TELEMETRY=off", async () => {
    const result = await runHook({
      HOME: tempHome,
      VERCEL_PLUGIN_TELEMETRY: "off",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("{}");
    expect(existsSync(prefPath)).toBe(false);
  });

  test("does not ask for telemetry when VERCEL_PLUGIN_TELEMETRY=on", async () => {
    const result = await runHook({
      HOME: tempHome,
      VERCEL_PLUGIN_TELEMETRY: "on",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("{}");
    expect(existsSync(prefPath)).toBe(false);
  });
});
