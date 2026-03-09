import { describe, test, expect, beforeEach } from "bun:test";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK_SCRIPT = join(ROOT, "hooks", "pretooluse-skill-inject.mjs");

let testSession: string;
const UNLIMITED_BUDGET = "999999";

beforeEach(() => {
  testSession = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

/**
 * Extract skillInjection metadata from additionalContext.
 */
function extractSkillInjection(hookSpecificOutput: any): any {
  const ctx = hookSpecificOutput?.additionalContext || "";
  const match = ctx.match(/<!-- skillInjection: ({.*?}) -->/);
  if (!match) return undefined;
  try { return JSON.parse(match[1]); } catch { return undefined; }
}

/**
 * Check if the dev-server verify marker is in additionalContext.
 */
function hasDevVerifyMarker(hookSpecificOutput: any): boolean {
  const ctx = hookSpecificOutput?.additionalContext || "";
  return ctx.includes("<!-- marker:dev-server-verify");
}

/**
 * Check if the unavailable warning is in additionalContext.
 */
function hasUnavailableWarning(hookSpecificOutput: any): boolean {
  const ctx = hookSpecificOutput?.additionalContext || "";
  return ctx.includes("<!-- agent-browser-unavailable -->");
}

async function runHook(
  input: object,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string; parsed: any }> {
  const payload = JSON.stringify({ ...input, session_id: testSession });
  const proc = Bun.spawn(["node", HOOK_SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      VERCEL_PLUGIN_INJECTION_BUDGET: UNLIMITED_BUDGET,
      VERCEL_PLUGIN_SEEN_SKILLS: "",
      VERCEL_PLUGIN_DEV_VERIFY_COUNT: "0",
      VERCEL_PLUGIN_AGENT_BROWSER_AVAILABLE: "1",
      ...env,
    },
  });
  proc.stdin.write(payload);
  proc.stdin.end();
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { parsed = null; }
  return { code, stdout, stderr, parsed };
}

describe("Dev-server detection via regex", () => {
  const devCommands = [
    "next dev",
    "npm run dev",
    "pnpm dev",
    "bun run dev",
    "yarn dev",
    "vite",
    "vite dev",
    "nuxt dev",
    "vercel dev",
    "npx next dev --turbo",
    "npm run dev -- --port 3001",
  ];

  for (const cmd of devCommands) {
    test(`detects "${cmd}" as dev-server command`, async () => {
      const { parsed } = await runHook({
        tool_name: "Bash",
        tool_input: { command: cmd },
      });

      expect(parsed).not.toBeNull();
      expect(parsed.hookSpecificOutput).toBeDefined();
      const ctx = parsed.hookSpecificOutput.additionalContext;
      expect(ctx).toContain("skill:agent-browser-verify");
    });
  }

  test("does not trigger for non-dev-server commands", async () => {
    const { parsed } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });

    // git status should not match any skill patterns or dev-server detection
    if (parsed?.hookSpecificOutput) {
      expect(parsed.hookSpecificOutput.additionalContext).not.toContain("skill:agent-browser-verify");
    }
  });

  test("does not trigger for non-Bash tools", async () => {
    const { parsed } = await runHook({
      tool_name: "Read",
      tool_input: { file_path: "/project/package.json" },
    });

    if (parsed?.hookSpecificOutput) {
      expect(parsed.hookSpecificOutput.additionalContext).not.toContain("skill:agent-browser-verify");
    }
  });
});

describe("Dev-server verify marker", () => {
  test("includes verify marker with iteration metadata", async () => {
    const { parsed } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "npm run dev" },
    });

    expect(parsed).not.toBeNull();
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(hasDevVerifyMarker(parsed.hookSpecificOutput)).toBe(true);
    // Should include iteration count
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toMatch(/iteration="1"/);
    expect(ctx).toMatch(/max="2"/);
  });
});

describe("Loop guard", () => {
  test("blocks injection when verify count reaches max (2)", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      { VERCEL_PLUGIN_DEV_VERIFY_COUNT: "2" },
    );

    // Should still match via bashPatterns but loop guard prevents synthetic injection
    // The skill may still be injected via normal pattern matching, but no verify marker
    if (parsed?.hookSpecificOutput) {
      // The key assertion: no verify marker (loop guard hit)
      expect(hasDevVerifyMarker(parsed.hookSpecificOutput)).toBe(false);
    }
  });

  test("blocks injection when verify count exceeds max", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "next dev" },
      },
      { VERCEL_PLUGIN_DEV_VERIFY_COUNT: "5" },
    );

    if (parsed?.hookSpecificOutput) {
      expect(hasDevVerifyMarker(parsed.hookSpecificOutput)).toBe(false);
    }
  });
});

describe("Agent-browser availability", () => {
  test("injects unavailable warning when agent-browser not available", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      { VERCEL_PLUGIN_AGENT_BROWSER_AVAILABLE: "0" },
    );

    expect(parsed).not.toBeNull();
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(hasUnavailableWarning(parsed.hookSpecificOutput)).toBe(true);
    // Should NOT have the verify marker
    expect(hasDevVerifyMarker(parsed.hookSpecificOutput)).toBe(false);
  });

  test("injects skill normally when agent-browser is available", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      { VERCEL_PLUGIN_AGENT_BROWSER_AVAILABLE: "1" },
    );

    expect(parsed).not.toBeNull();
    expect(parsed.hookSpecificOutput).toBeDefined();
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("skill:agent-browser-verify");
    expect(hasUnavailableWarning(parsed.hookSpecificOutput)).toBe(false);
  });

  test("unavailable warning only injected once per session (dedup via SEEN_SKILLS)", async () => {
    // Simulate: agent-browser-unavailable-warning already in seen skills
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      {
        VERCEL_PLUGIN_AGENT_BROWSER_AVAILABLE: "0",
        VERCEL_PLUGIN_SEEN_SKILLS: "agent-browser-unavailable-warning",
      },
    );

    // The warning slug is parsed from SEEN_SKILLS into injectedSkills set,
    // so the dedup check correctly prevents re-injection
    if (parsed?.hookSpecificOutput) {
      expect(hasUnavailableWarning(parsed.hookSpecificOutput)).toBe(false);
    } else {
      // No output at all means it was correctly suppressed
      expect(parsed).toBeDefined();
    }
  });
});

describe("Dedup bypass integration", () => {
  test("re-injects verify skill when already seen but count < max", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      {
        VERCEL_PLUGIN_SEEN_SKILLS: "agent-browser-verify",
        VERCEL_PLUGIN_DEV_VERIFY_COUNT: "0",
      },
    );

    // Dedup bypass: counter < max triggers re-injection even when slug is in SEEN_SKILLS
    expect(parsed).not.toBeNull();
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.additionalContext).toContain("skill:agent-browser-verify");
    expect(hasDevVerifyMarker(parsed.hookSpecificOutput)).toBe(true);
  });

  test("re-injects verify skill on second iteration (count=1, max=2)", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      {
        VERCEL_PLUGIN_SEEN_SKILLS: "agent-browser-verify",
        VERCEL_PLUGIN_DEV_VERIFY_COUNT: "1",
      },
    );

    // iteration 2 of 2 — still allowed
    expect(parsed).not.toBeNull();
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.additionalContext).toContain("skill:agent-browser-verify");
    expect(hasDevVerifyMarker(parsed.hookSpecificOutput)).toBe(true);
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toMatch(/iteration="2"/);
  });

  test("blocks verify skill when count >= max even without SEEN_SKILLS", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      {
        VERCEL_PLUGIN_SEEN_SKILLS: "",
        VERCEL_PLUGIN_DEV_VERIFY_COUNT: "2",
      },
    );

    // Loop guard: count >= max blocks regardless of dedup state
    if (parsed?.hookSpecificOutput) {
      expect(hasDevVerifyMarker(parsed.hookSpecificOutput)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Companion skill (verification) injection behavior
// ---------------------------------------------------------------------------

describe("Verification companion injection", () => {
  test("dev server start co-injects verification skill alongside agent-browser-verify", async () => {
    const { parsed } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "npm run dev" },
    });

    expect(parsed).not.toBeNull();
    expect(parsed.hookSpecificOutput).toBeDefined();
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("skill:agent-browser-verify");
    expect(ctx).toContain("skill:verification");
  });

  test("verification injects as summary-only on second dev server start (dedup bypass)", async () => {
    const { parsed } = await runHook(
      {
        tool_name: "Bash",
        tool_input: { command: "npm run dev" },
      },
      {
        VERCEL_PLUGIN_SEEN_SKILLS: "verification",
        VERCEL_PLUGIN_DEV_VERIFY_COUNT: "0",
      },
    );

    expect(parsed).not.toBeNull();
    expect(parsed.hookSpecificOutput).toBeDefined();
    const ctx = parsed.hookSpecificOutput.additionalContext;
    // Verification should still appear but in summary mode
    expect(ctx).toContain("skill:verification");
    expect(ctx).toContain("mode:summary");
  });

  test("skillInjection metadata includes reasons map and verificationId", async () => {
    const { parsed } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "npm run dev" },
    });

    expect(parsed).not.toBeNull();
    const injection = extractSkillInjection(parsed.hookSpecificOutput);
    expect(injection).toBeDefined();
    // verificationId should be a UUID
    expect(injection.verificationId).toBeDefined();
    expect(injection.verificationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // reasons map should have entries for injected skills
    expect(injection.reasons).toBeDefined();
    expect(injection.reasons["agent-browser-verify"]).toBeDefined();
    expect(injection.reasons["agent-browser-verify"].trigger).toBe("dev-server-start");
    expect(injection.reasons["agent-browser-verify"].reasonCode).toBe("bash-dev-server-pattern");
    expect(injection.reasons["verification"]).toBeDefined();
    expect(injection.reasons["verification"].trigger).toBe("dev-server-companion");
  });
});

describe("SessionStart profiler - agent-browser check", () => {
  test("checkAgentBrowser function is exported from profiler", async () => {
    // Import the source module to test the function directly
    const mod = await import("../hooks/src/session-start-profiler.mts");
    expect(typeof mod.checkAgentBrowser).toBe("function");
    // The result depends on whether agent-browser is installed on the system
    const result = mod.checkAgentBrowser();
    expect(typeof result).toBe("boolean");
  });
});
