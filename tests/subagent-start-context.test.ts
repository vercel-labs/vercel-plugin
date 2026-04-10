import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK_SCRIPT = join(ROOT, "hooks", "subagent-start-bootstrap.mjs");

let testSession: string;
let tempDir: string;

beforeEach(() => {
  testSession = `subagent-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tempDir = mkdtempSync(join(tmpdir(), "subagent-ctx-"));
});

/**
 * Run the SubagentStart bootstrap hook by piping JSON on stdin.
 */
async function runSubagentStart(
  input: {
    session_id?: string;
    agent_id?: string;
    agent_type?: string;
    cwd?: string;
  },
  env?: Record<string, string | undefined>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const payload = JSON.stringify({
    session_id: testSession,
    hook_event_name: "SubagentStart",
    ...input,
  });

  const proc = Bun.spawn(["node", HOOK_SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      VERCEL_PLUGIN_LOG_LEVEL: "off",
      ...env,
    },
  });

  proc.stdin.write(payload);
  proc.stdin.end();

  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

function parseContext(stdout: string): string {
  if (!stdout.trim()) return "";
  const parsed = JSON.parse(stdout);
  return parsed?.hookSpecificOutput?.additionalContext || "";
}

/**
 * Write a fake profile cache to disk so the hook can read it.
 */
function writeProfileCache(sessionId: string, likelySkills: string[]): void {
  // Profile cache path follows: <tmpdir>/vercel-plugin-<sessionId>-profile.json
  const cachePath = join(tmpdir(), `vercel-plugin-${sessionId}-profile.json`);
  writeFileSync(
    cachePath,
    JSON.stringify({
      projectRoot: "/Users/me/project",
      likelySkills,
      greenfield: false,
      bootstrapHints: [],
      resourceHints: [],
      setupMode: false,
      agentBrowserAvailable: false,
      timestamp: new Date().toISOString(),
    }),
    "utf-8",
  );
}

function cleanupProfileCache(sessionId: string): void {
  const cachePath = join(tmpdir(), `vercel-plugin-${sessionId}-profile.json`);
  try {
    rmSync(cachePath, { force: true });
  } catch {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("subagent-start-context: additionalContext per agent type", () => {
  test("Explore agent receives minimal budget context", async () => {
    writeProfileCache(testSession, ["nextjs", "vercel-storage"]);

    try {
      const { code, stdout } = await runSubagentStart({
        agent_id: "explore-1",
        agent_type: "Explore",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(ctx).toContain('budget="minimal"');
      expect(ctx).toContain('agent_type="Explore"');
      expect(ctx).toContain("nextjs");
      expect(ctx).toContain("vercel-storage");
    } finally {
      cleanupProfileCache(testSession);
    }
  });

  test("Plan agent receives light budget context with summaries", async () => {
    writeProfileCache(testSession, ["nextjs", "vercel-storage"]);

    try {
      const { code, stdout } = await runSubagentStart({
        agent_id: "plan-1",
        agent_type: "Plan",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(ctx).toContain('budget="light"');
      expect(ctx).toContain('agent_type="Plan"');
      expect(ctx).toContain("nextjs");
    } finally {
      cleanupProfileCache(testSession);
    }
  });

  test("general-purpose agent receives standard budget context", async () => {
    writeProfileCache(testSession, ["nextjs"]);

    try {
      const { code, stdout } = await runSubagentStart({
        agent_id: "gp-1",
        agent_type: "general-purpose",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(ctx).toContain('budget="standard"');
      expect(ctx).toContain('agent_type="general-purpose"');
      expect(ctx).toContain("nextjs");
    } finally {
      cleanupProfileCache(testSession);
    }
  });

  test("unknown agent type falls back to standard budget", async () => {
    writeProfileCache(testSession, ["nextjs"]);

    try {
      const { code, stdout } = await runSubagentStart({
        agent_id: "custom-1",
        agent_type: "my-custom-agent",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(ctx).toContain('budget="standard"');
      expect(ctx).toContain('agent_type="my-custom-agent"');
    } finally {
      cleanupProfileCache(testSession);
    }
  });
});

describe("subagent-start-context: budget enforcement", () => {
  test("Explore context stays within 1KB budget", async () => {
    // Give it many skills to potentially exceed budget
    writeProfileCache(testSession, [
      "nextjs", "vercel-storage", "ai-sdk", "shadcn", "auth",
      "vercel-functions", "turborepo",
    ]);

    try {
      const { code, stdout } = await runSubagentStart({
        agent_id: "explore-budget",
        agent_type: "Explore",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(Buffer.byteLength(ctx, "utf8")).toBeLessThanOrEqual(1024);
    } finally {
      cleanupProfileCache(testSession);
    }
  });

  test("Plan context stays within 3KB budget", async () => {
    writeProfileCache(testSession, [
      "nextjs", "vercel-storage", "ai-sdk", "shadcn", "auth",
      "vercel-functions", "turborepo",
    ]);

    try {
      const { code, stdout } = await runSubagentStart({
        agent_id: "plan-budget",
        agent_type: "Plan",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(Buffer.byteLength(ctx, "utf8")).toBeLessThanOrEqual(3072);
    } finally {
      cleanupProfileCache(testSession);
    }
  });

  test("general-purpose context stays within 8KB budget", async () => {
    writeProfileCache(testSession, [
      "nextjs", "vercel-storage", "ai-sdk", "shadcn", "auth",
      "vercel-functions", "turborepo",
    ]);

    try {
      const { code, stdout } = await runSubagentStart({
        agent_id: "gp-budget",
        agent_type: "general-purpose",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(Buffer.byteLength(ctx, "utf8")).toBeLessThanOrEqual(8000);
    } finally {
      cleanupProfileCache(testSession);
    }
  });
});

describe("subagent-start-context: profile cache and fallback", () => {
  test("falls back to VERCEL_PLUGIN_LIKELY_SKILLS env when no profile cache", async () => {
    // No profile cache written — should fall back to env var
    const { code, stdout } = await runSubagentStart(
      {
        agent_id: "fallback-1",
        agent_type: "general-purpose",
      },
      {
        VERCEL_PLUGIN_LIKELY_SKILLS: "nextjs,ai-sdk",
      },
    );

    expect(code).toBe(0);
    const ctx = parseContext(stdout);
    expect(ctx).toContain("nextjs");
    expect(ctx).toContain("ai-sdk");
  });

  test("returns context even with no likely skills", async () => {
    const { code, stdout } = await runSubagentStart(
      {
        agent_id: "empty-1",
        agent_type: "Explore",
      },
      {
        VERCEL_PLUGIN_LIKELY_SKILLS: "",
      },
    );

    expect(code).toBe(0);
    const ctx = parseContext(stdout);
    expect(ctx).toContain("Vercel plugin active");
    expect(ctx).toContain("unknown stack");
  });

  test("empty stdin produces empty output (no crash)", async () => {
    const proc = Bun.spawn(["node", HOOK_SCRIPT], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, VERCEL_PLUGIN_LOG_LEVEL: "off" },
    });

    proc.stdin.write("");
    proc.stdin.end();

    const code = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
