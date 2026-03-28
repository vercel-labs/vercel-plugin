import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLearnCommand, learnedRulesPath } from "../src/cli/learn.ts";
import type { LearnedRoutingRulesFile } from "../hooks/src/rule-distillation.mts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_TS = "2026-03-28T06:00:00.000Z";
const TEST_SESSION = "test-integration-learn";

function makeTempProject(): string {
  const dir = join(tmpdir(), `vercel-plugin-integ-learn-${Date.now()}`);
  mkdirSync(join(dir, "skills"), { recursive: true });
  mkdirSync(join(dir, "generated"), { recursive: true });
  return dir;
}

function writeTraceFixture(sessionId: string, traces: object[]): void {
  const traceDir = join(tmpdir(), `vercel-plugin-${sessionId}-trace`);
  mkdirSync(traceDir, { recursive: true });
  const lines = traces.map((t) => JSON.stringify(t)).join("\n") + "\n";
  writeFileSync(join(traceDir, "routing-decision-trace.jsonl"), lines);
}

function writeExposureFixture(sessionId: string, exposures: object[]): void {
  const path = join(tmpdir(), `vercel-plugin-${sessionId}-routing-exposures.jsonl`);
  const lines = exposures.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path, lines);
}

function makeTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    decisionId: "d1",
    sessionId: TEST_SESSION,
    hook: "PreToolUse",
    toolName: "Read",
    toolTarget: "/app/page.tsx",
    timestamp: FIXED_TS,
    primaryStory: {
      id: "story-1",
      kind: "feature",
      storyRoute: "/app",
      targetBoundary: "uiRender",
    },
    observedRoute: "/app",
    policyScenario: null,
    matchedSkills: [],
    injectedSkills: [],
    skippedReasons: [],
    ranked: [],
    verification: null,
    ...overrides,
  };
}

function makeExposure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "exp-1",
    sessionId: TEST_SESSION,
    projectRoot: "/test",
    storyId: "story-1",
    storyKind: "feature",
    route: "/app",
    hook: "PreToolUse",
    toolName: "Read",
    targetBoundary: "uiRender",
    exposureGroupId: null,
    attributionRole: "candidate",
    candidateSkill: "next-config",
    createdAt: FIXED_TS,
    resolvedAt: FIXED_TS,
    outcome: "win",
    skill: "next-config",
    ...overrides,
  };
}

function makeRanked(skill: string, pattern?: { type: string; value: string }) {
  return {
    skill,
    basePriority: 6,
    effectivePriority: 6,
    pattern: pattern ?? null,
    profilerBoost: 0,
    policyBoost: 0,
    policyReason: null,
    summaryOnly: false,
    synthetic: false,
    droppedReason: null,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  try {
    rmSync(join(tmpdir(), `vercel-plugin-${TEST_SESSION}-trace`), { recursive: true, force: true });
  } catch {}
  try {
    rmSync(join(tmpdir(), `vercel-plugin-${TEST_SESSION}-routing-exposures.jsonl`), { force: true });
  } catch {}
});

function trackDir(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Integration: end-to-end learn pipeline
// ---------------------------------------------------------------------------

describe("learned-rules integration", () => {
  test("end-to-end: distill → write → read produces valid artifact", async () => {
    const project = trackDir(makeTempProject());

    // 8 winning traces + 8 losing traces to create lift
    const winTraces = Array.from({ length: 8 }, (_, i) =>
      makeTrace({
        decisionId: `win${i}`,
        injectedSkills: ["next-config"],
        ranked: [makeRanked("next-config", { type: "path", value: "next.config.*" })],
        verification: {
          verificationId: `v${i}`,
          observedBoundary: "uiRender",
          matchedSuggestedAction: true,
        },
      }),
    );
    const loseTraces = Array.from({ length: 8 }, (_, i) =>
      makeTrace({
        decisionId: `lose${i}`,
        injectedSkills: ["tailwind"],
        ranked: [makeRanked("tailwind", { type: "path", value: "tailwind.*" })],
      }),
    );

    writeTraceFixture(TEST_SESSION, [...winTraces, ...loseTraces]);
    writeExposureFixture(TEST_SESSION, [
      makeExposure({ skill: "next-config", outcome: "win" }),
      makeExposure({ skill: "tailwind", outcome: "stale-miss" }),
    ]);

    const code = await runLearnCommand({
      project,
      write: true,
      session: TEST_SESSION,
    });

    expect(code).toBe(0);

    const outPath = learnedRulesPath(project);
    expect(existsSync(outPath)).toBe(true);

    const content: LearnedRoutingRulesFile = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(content.version).toBe(1);
    expect(content.projectRoot).toBe(project);
    expect(content.rules.length).toBeGreaterThanOrEqual(1);
    expect(content.replay).toBeDefined();
    expect(content.replay.regressions).toEqual([]);
  });

  test("idempotent: running learn twice with same data produces identical artifacts", async () => {
    const project = trackDir(makeTempProject());

    const traces = Array.from({ length: 6 }, (_, i) =>
      makeTrace({
        decisionId: `d${i}`,
        injectedSkills: ["next-config"],
        ranked: [makeRanked("next-config", { type: "path", value: "next.config.*" })],
      }),
    );
    writeTraceFixture(TEST_SESSION, traces);
    writeExposureFixture(TEST_SESSION, [makeExposure({ skill: "next-config", outcome: "win" })]);

    // Run 1
    const logs1: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs1.push(msg);
    await runLearnCommand({ project, json: true, session: TEST_SESSION });
    console.log = origLog;

    // Run 2
    const logs2: string[] = [];
    console.log = (msg: string) => logs2.push(msg);
    await runLearnCommand({ project, json: true, session: TEST_SESSION });
    console.log = origLog;

    const json1 = JSON.parse(logs1.join("\n"));
    const json2 = JSON.parse(logs2.join("\n"));

    // Strip generatedAt for comparison (timestamp changes between runs)
    delete json1.generatedAt;
    delete json2.generatedAt;
    expect(JSON.stringify(json1)).toBe(JSON.stringify(json2));
  });

  test("--json stdout contains only the JSON payload", async () => {
    const project = trackDir(makeTempProject());

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      await runLearnCommand({ project, json: true, session: TEST_SESSION });
    } finally {
      console.log = origLog;
    }

    // stdout must be valid JSON (no extra lines)
    const stdout = logs.join("\n");
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  test("--write is atomic: file exists or doesn't, no partial writes", async () => {
    const project = trackDir(makeTempProject());

    await runLearnCommand({ project, write: true, session: TEST_SESSION });

    const outPath = learnedRulesPath(project);
    if (existsSync(outPath)) {
      // If file exists, it must be valid JSON
      const raw = readFileSync(outPath, "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  test("empty traces still produce valid artifact with --write", async () => {
    const project = trackDir(makeTempProject());

    await runLearnCommand({ project, write: true, session: TEST_SESSION });

    const outPath = learnedRulesPath(project);
    expect(existsSync(outPath)).toBe(true);

    const content: LearnedRoutingRulesFile = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(content.rules).toEqual([]);
    expect(content.replay.regressions).toEqual([]);
    expect(content.replay.baselineWins).toBe(0);
    expect(content.replay.learnedWins).toBe(0);
    expect(content.replay.deltaWins).toBe(0);
  });

  test("exit code reflects regression state", async () => {
    const project = trackDir(makeTempProject());

    // No traces = no regressions = exit 0
    const code = await runLearnCommand({ project, session: TEST_SESSION });
    expect(code).toBe(0);
  });
});
