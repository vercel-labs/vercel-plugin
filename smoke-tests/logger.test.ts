import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK_SCRIPT = resolve(ROOT, "hooks", "pretooluse-skill-inject.mjs");

/**
 * Run the hook with specific env vars and capture stderr.
 */
async function runHookWithEnv(
  input: object,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const session = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = JSON.stringify({ ...input, session_id: session });

  // Build env: inherit PATH and HOME, add caller-specified vars
  const hookEnv: Record<string, string> = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
    ...env,
  };

  const proc = Bun.spawn(["node", HOOK_SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: hookEnv,
  });
  proc.stdin.write(payload);
  proc.stdin.end();
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Unit tests for resolveLogLevel and createLogger
// ---------------------------------------------------------------------------

describe("logger.mjs", () => {
  // We import dynamically so each test can manipulate env before import
  // But since ESM caches, we test resolveLogLevel via the hook's behavior instead.

  describe("resolveLogLevel via hook output", () => {
    test("off (default) — no stderr output", async () => {
      const { code, stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        {},
      );
      expect(code).toBe(0);
      expect(stderr).toBe("");
    });

    test("VERCEL_PLUGIN_LOG_LEVEL=off — no stderr output", async () => {
      const { code, stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        { VERCEL_PLUGIN_LOG_LEVEL: "off" },
      );
      expect(code).toBe(0);
      expect(stderr).toBe("");
    });

    test("VERCEL_PLUGIN_LOG_LEVEL=summary — emits complete event only", async () => {
      const { code, stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        { VERCEL_PLUGIN_LOG_LEVEL: "summary" },
      );
      expect(code).toBe(0);
      const lines = stderr.trim().split("\n").filter(Boolean);
      // summary only emits complete (and issue events if any)
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(["complete", "issue"]).toContain(parsed.event);
      }
      // Must have at least the complete event
      const completeLines = lines.filter((l) => JSON.parse(l).event === "complete");
      expect(completeLines.length).toBe(1);
    });

    test("summary includes elapsed_ms and reason", async () => {
      const { stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        { VERCEL_PLUGIN_LOG_LEVEL: "summary" },
      );
      const lines = stderr.trim().split("\n").filter(Boolean);
      const complete = JSON.parse(lines.find((l) => JSON.parse(l).event === "complete")!);
      expect(complete.reason).toBeDefined();
      expect(typeof complete.elapsed_ms).toBe("number");
    });

    test("VERCEL_PLUGIN_LOG_LEVEL=debug — emits debug-level events", async () => {
      const { code, stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        { VERCEL_PLUGIN_LOG_LEVEL: "debug" },
      );
      expect(code).toBe(0);
      const lines = stderr.trim().split("\n").filter(Boolean);
      const events = lines.map((l) => JSON.parse(l).event);
      // debug mode should have match-related events beyond just complete
      expect(events).toContain("complete");
      // Should have debug-level events like input-parsed, skillmap-loaded, etc.
      expect(events.some((e) => e !== "complete" && e !== "issue")).toBe(true);
    });

    test("VERCEL_PLUGIN_LOG_LEVEL=trace — emits per-pattern evaluation", async () => {
      const { code, stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/Users/me/project/next.config.ts" } },
        { VERCEL_PLUGIN_LOG_LEVEL: "trace" },
      );
      expect(code).toBe(0);
      const lines = stderr.trim().split("\n").filter(Boolean);
      const events = lines.map((l) => JSON.parse(l).event);
      // trace mode should include per-pattern evaluation events
      expect(events).toContain("pattern-eval-start");
      expect(events).toContain("pattern-eval-result");
    });

    test("trace includes skill name and match result in pattern-eval-result", async () => {
      const { stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/Users/me/project/next.config.ts" } },
        { VERCEL_PLUGIN_LOG_LEVEL: "trace" },
      );
      const lines = stderr.trim().split("\n").filter(Boolean);
      const evalResults = lines
        .map((l) => JSON.parse(l))
        .filter((e) => e.event === "pattern-eval-result");
      expect(evalResults.length).toBeGreaterThan(0);
      for (const result of evalResults) {
        expect(typeof result.skill).toBe("string");
        expect(typeof result.matched).toBe("boolean");
      }
    });
  });

  describe("legacy compat", () => {
    test("VERCEL_PLUGIN_DEBUG=1 maps to debug level", async () => {
      const { stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        { VERCEL_PLUGIN_DEBUG: "1" },
      );
      const lines = stderr.trim().split("\n").filter(Boolean);
      const events = lines.map((l) => JSON.parse(l).event);
      // Should have debug-level output (not just summary)
      expect(events).toContain("complete");
      expect(events.some((e) => e !== "complete" && e !== "issue")).toBe(true);
    });

    test("VERCEL_PLUGIN_HOOK_DEBUG=1 maps to debug level", async () => {
      const { stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        { VERCEL_PLUGIN_HOOK_DEBUG: "1" },
      );
      const lines = stderr.trim().split("\n").filter(Boolean);
      const events = lines.map((l) => JSON.parse(l).event);
      expect(events).toContain("complete");
      expect(events.some((e) => e !== "complete" && e !== "issue")).toBe(true);
    });

    test("explicit LOG_LEVEL takes precedence over legacy DEBUG=1", async () => {
      const { stderr } = await runHookWithEnv(
        { tool_name: "Read", tool_input: { file_path: "/some/random/file.txt" } },
        { VERCEL_PLUGIN_LOG_LEVEL: "off", VERCEL_PLUGIN_DEBUG: "1" },
      );
      // off should silence all output even with DEBUG=1
      expect(stderr).toBe("");
    });
  });

  describe("summary mode issue reporting", () => {
    test("summary emits issue events for problems", async () => {
      // Send invalid JSON to trigger STDIN_PARSE_FAIL
      const session = `test-${Date.now()}`;
      const proc = Bun.spawn(["node", HOOK_SCRIPT], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH || "",
          HOME: process.env.HOME || "",
          VERCEL_PLUGIN_LOG_LEVEL: "summary",
        },
      });
      proc.stdin.write("not json at all");
      proc.stdin.end();
      await proc.exited;
      const stderr = await new Response(proc.stderr).text();
      const lines = stderr.trim().split("\n").filter(Boolean);
      const events = lines.map((l) => JSON.parse(l));
      const issues = events.filter((e) => e.event === "issue");
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe("STDIN_PARSE_FAIL");
    });
  });

  describe("functional output unchanged", () => {
    test("stdout output is identical regardless of log level", async () => {
      const input = { tool_name: "Read", tool_input: { file_path: "/Users/me/project/next.config.ts" } };

      const offResult = await runHookWithEnv(input, {});
      const summaryResult = await runHookWithEnv(input, { VERCEL_PLUGIN_LOG_LEVEL: "summary" });
      const debugResult = await runHookWithEnv(input, { VERCEL_PLUGIN_LOG_LEVEL: "debug" });
      const traceResult = await runHookWithEnv(input, { VERCEL_PLUGIN_LOG_LEVEL: "trace" });

      // All should produce the same stdout (functional output)
      expect(offResult.stdout).toBe(summaryResult.stdout);
      expect(offResult.stdout).toBe(debugResult.stdout);
      expect(offResult.stdout).toBe(traceResult.stdout);
    });
  });
});
