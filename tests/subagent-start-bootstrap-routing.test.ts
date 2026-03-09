import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { appendPendingLaunch, type PendingLaunch } from "../hooks/src/subagent-state.mts";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK_SCRIPT = join(ROOT, "hooks", "subagent-start-bootstrap.mjs");

async function runSubagentStart(
  input: {
    session_id: string;
    agent_id?: string;
    agent_type?: string;
    cwd?: string;
  },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const payload = JSON.stringify({
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

function writeProfileCache(sessionId: string, likelySkills: string[]): void {
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

function cleanupSessionFiles(sessionId: string): void {
  rmSync(join(tmpdir(), `vercel-plugin-${sessionId}-profile.json`), { force: true });
  rmSync(join(tmpdir(), `vercel-plugin-${sessionId}-pending-launches.jsonl`), { force: true });
  rmSync(join(tmpdir(), `vercel-plugin-${sessionId}-pending-launches.jsonl.lock`), { force: true });
}

describe("subagent-start-bootstrap pending launch routing", () => {
  test("adds prompt-scored skills ahead of profiler skills when a pending launch is claimed", async () => {
    const sessionId = `subagent-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const launch: PendingLaunch = {
      description: "Build a durable workflow that survives crashes",
      prompt: "Use Vercel Workflow DevKit for a multi-step pipeline with retries",
      subagent_type: "Plan",
      createdAt: Date.now(),
    };

    writeProfileCache(sessionId, ["nextjs", "vercel-storage"]);
    appendPendingLaunch(sessionId, launch);

    try {
      const { code, stdout } = await runSubagentStart({
        session_id: sessionId,
        agent_id: "plan-routing",
        agent_type: "Plan",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(ctx).toContain("Project likely uses: workflow, nextjs, vercel-storage.");
    } finally {
      cleanupSessionFiles(sessionId);
    }
  });

  test("falls back to profiler routing when no pending launch is available", async () => {
    const sessionId = `subagent-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    writeProfileCache(sessionId, ["nextjs", "vercel-storage"]);

    try {
      const { code, stdout } = await runSubagentStart({
        session_id: sessionId,
        agent_id: "plan-routing",
        agent_type: "Plan",
      });

      expect(code).toBe(0);
      const ctx = parseContext(stdout);
      expect(ctx).toContain("Project likely uses: nextjs, vercel-storage.");
      expect(ctx).not.toContain("Project likely uses: workflow, nextjs, vercel-storage.");
    } finally {
      cleanupSessionFiles(sessionId);
    }
  });
});
