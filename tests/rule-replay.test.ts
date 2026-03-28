import { describe, test, expect } from "bun:test";
import { replayLearnedRules } from "../hooks/src/rule-replay.mts";
import type { ReplayResult } from "../hooks/src/rule-replay.mts";
import type { LearnedRoutingRule } from "../hooks/src/rule-distillation.mts";
import type {
  RoutingDecisionTrace,
  RankedSkillTrace,
} from "../hooks/src/routing-decision-trace.mts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TS = "2026-03-28T06:00:00.000Z";

function makeTrace(
  overrides: Partial<RoutingDecisionTrace> & { decisionId: string },
): RoutingDecisionTrace {
  return {
    version: 2,
    sessionId: "sess-1",
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

function makeRule(
  overrides: Partial<LearnedRoutingRule> & { id: string; skill: string },
): LearnedRoutingRule {
  return {
    kind: "pathPattern",
    value: "*.tsx",
    scenario: {
      hook: "PreToolUse",
      storyKind: "feature",
      targetBoundary: "uiRender",
      toolName: "Read",
      routeScope: "/app",
    },
    support: 10,
    wins: 9,
    directiveWins: 0,
    staleMisses: 0,
    precision: 0.9,
    lift: 2.0,
    sourceDecisionIds: [],
    confidence: "promote",
    promotedAt: FIXED_TS,
    ...overrides,
  };
}

function verifiedTrace(
  decisionId: string,
  injectedSkills: string[],
): RoutingDecisionTrace {
  return makeTrace({
    decisionId,
    injectedSkills,
    verification: {
      verificationId: `v-${decisionId}`,
      observedBoundary: "uiRender",
      matchedSuggestedAction: true,
    },
  });
}

function unverifiedTrace(
  decisionId: string,
  injectedSkills: string[],
): RoutingDecisionTrace {
  return makeTrace({ decisionId, injectedSkills, verification: null });
}

// ---------------------------------------------------------------------------
// Empty / trivial inputs
// ---------------------------------------------------------------------------

describe("replayLearnedRules — empty inputs", () => {
  test("returns zeros with no traces and no rules", () => {
    const result = replayLearnedRules({ traces: [], rules: [] });
    expect(result).toEqual({
      baselineWins: 0,
      learnedWins: 0,
      deltaWins: 0,
      regressions: [],
    });
  });

  test("returns zeros with traces but no rules", () => {
    const result = replayLearnedRules({
      traces: [unverifiedTrace("d1", ["next-config"])],
      rules: [],
    });
    expect(result).toEqual({
      baselineWins: 0,
      learnedWins: 0,
      deltaWins: 0,
      regressions: [],
    });
  });

  test("returns zeros with rules but no traces", () => {
    const result = replayLearnedRules({
      traces: [],
      rules: [makeRule({ id: "r1", skill: "next-config" })],
    });
    expect(result).toEqual({
      baselineWins: 0,
      learnedWins: 0,
      deltaWins: 0,
      regressions: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Baseline carry-through (no promoted rules for scenario)
// ---------------------------------------------------------------------------

describe("replayLearnedRules — baseline carry-through", () => {
  test("baseline wins carry through when no promoted rules apply", () => {
    const result = replayLearnedRules({
      traces: [verifiedTrace("d1", ["next-config"])],
      rules: [],
    });
    expect(result.baselineWins).toBe(1);
    expect(result.learnedWins).toBe(1);
    expect(result.deltaWins).toBe(0);
    expect(result.regressions).toEqual([]);
  });

  test("multiple baseline wins carry through independently", () => {
    const result = replayLearnedRules({
      traces: [
        verifiedTrace("d1", ["next-config"]),
        verifiedTrace("d2", ["tailwind"]),
        unverifiedTrace("d3", ["react"]),
      ],
      rules: [],
    });
    expect(result.baselineWins).toBe(2);
    expect(result.learnedWins).toBe(2);
    expect(result.deltaWins).toBe(0);
    expect(result.regressions).toEqual([]);
  });

  test("non-promoted rules do not affect replay", () => {
    const result = replayLearnedRules({
      traces: [verifiedTrace("d1", ["next-config"])],
      rules: [
        makeRule({ id: "r1", skill: "next-config", confidence: "candidate", promotedAt: null }),
        makeRule({ id: "r2", skill: "next-config", confidence: "holdout-fail", promotedAt: null }),
      ],
    });
    // candidate and holdout-fail rules are ignored → baseline carries through
    expect(result.baselineWins).toBe(1);
    expect(result.learnedWins).toBe(1);
    expect(result.regressions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Improvement cases (learned rules add wins)
// ---------------------------------------------------------------------------

describe("replayLearnedRules — improvements", () => {
  test("learned rules that overlap with injected skills count as wins", () => {
    const result = replayLearnedRules({
      traces: [verifiedTrace("d1", ["next-config"])],
      rules: [makeRule({ id: "r1", skill: "next-config" })],
    });
    expect(result.baselineWins).toBe(1);
    expect(result.learnedWins).toBe(1);
    expect(result.deltaWins).toBe(0);
    expect(result.regressions).toEqual([]);
  });

  test("learned overlap on unverified trace counts as learned win", () => {
    // Trace has no baseline win (no verification), but promoted rule overlaps
    const result = replayLearnedRules({
      traces: [
        makeTrace({
          decisionId: "d1",
          injectedSkills: ["next-config"],
          verification: null,
        }),
      ],
      rules: [makeRule({ id: "r1", skill: "next-config" })],
    });
    expect(result.baselineWins).toBe(0);
    expect(result.learnedWins).toBe(1);
    expect(result.deltaWins).toBe(1);
    expect(result.regressions).toEqual([]);
  });

  test("positive delta when learned rules cover unverified traces", () => {
    const result = replayLearnedRules({
      traces: [
        verifiedTrace("d1", ["next-config"]),
        // d2: no verification but promoted rule covers it
        makeTrace({
          decisionId: "d2",
          injectedSkills: ["next-config"],
          verification: null,
        }),
      ],
      rules: [makeRule({ id: "r1", skill: "next-config" })],
    });
    expect(result.baselineWins).toBe(1);
    expect(result.learnedWins).toBe(2);
    expect(result.deltaWins).toBe(1);
    expect(result.regressions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regression cases
// ---------------------------------------------------------------------------

describe("replayLearnedRules — regressions", () => {
  test("detects regression when promoted rule does not cover baseline winner", () => {
    const result = replayLearnedRules({
      traces: [verifiedTrace("d1", ["next-config"])],
      // Promoted rule covers a DIFFERENT skill
      rules: [makeRule({ id: "r1", skill: "tailwind" })],
    });
    expect(result.baselineWins).toBe(1);
    expect(result.learnedWins).toBe(0);
    expect(result.deltaWins).toBe(-1);
    expect(result.regressions).toEqual(["d1"]);
  });

  test("multiple regressions are all captured", () => {
    const result = replayLearnedRules({
      traces: [
        verifiedTrace("d1", ["skill-a"]),
        verifiedTrace("d2", ["skill-a"]),
        verifiedTrace("d3", ["skill-a"]),
      ],
      rules: [makeRule({ id: "r1", skill: "skill-b" })],
    });
    expect(result.baselineWins).toBe(3);
    expect(result.regressions.length).toBe(3);
    expect(result.regressions).toEqual(["d1", "d2", "d3"]);
  });

  test("regressions block all promotions (zero promoted rules downstream)", () => {
    const result = replayLearnedRules({
      traces: [verifiedTrace("d1", ["skill-a"])],
      rules: [makeRule({ id: "r1", skill: "skill-b" })],
    });
    // Any caller of replayLearnedRules should check: if regressions.length > 0,
    // demote all promoted rules to holdout-fail
    expect(result.regressions.length).toBeGreaterThan(0);
  });

  test("mixed: some traces regress, some improve", () => {
    const result = replayLearnedRules({
      traces: [
        // d1: baseline win with skill-a, but promoted rule is skill-b → regression
        verifiedTrace("d1", ["skill-a"]),
        // d2: no baseline win, promoted rule covers injected skill → improvement
        makeTrace({
          decisionId: "d2",
          injectedSkills: ["skill-b"],
          verification: null,
        }),
      ],
      rules: [makeRule({ id: "r1", skill: "skill-b" })],
    });
    expect(result.baselineWins).toBe(1);
    expect(result.learnedWins).toBe(1); // only d2
    expect(result.deltaWins).toBe(0);
    expect(result.regressions).toEqual(["d1"]);
  });

  test("regression not triggered when promoted skill matches injected skill", () => {
    // Same skill promoted as was injected and verified — no regression
    const result = replayLearnedRules({
      traces: [verifiedTrace("d1", ["next-config"])],
      rules: [makeRule({ id: "r1", skill: "next-config" })],
    });
    expect(result.regressions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("replayLearnedRules — determinism", () => {
  test("identical inputs produce identical output", () => {
    const traces = [
      verifiedTrace("d1", ["next-config"]),
      verifiedTrace("d2", ["tailwind"]),
      unverifiedTrace("d3", ["react"]),
    ];
    const rules = [makeRule({ id: "r1", skill: "next-config" })];

    const r1 = replayLearnedRules({ traces, rules });
    const r2 = replayLearnedRules({ traces, rules });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  test("regression IDs are sorted regardless of trace order", () => {
    const traces = [
      verifiedTrace("z-trace", ["skill-a"]),
      verifiedTrace("m-trace", ["skill-a"]),
      verifiedTrace("a-trace", ["skill-a"]),
    ];
    const rules = [makeRule({ id: "r1", skill: "different-skill" })];

    const result = replayLearnedRules({ traces, rules });
    expect(result.regressions).toEqual(["a-trace", "m-trace", "z-trace"]);
  });

  test("output is stable across repeated runs with shuffled traces", () => {
    const base = [
      verifiedTrace("d3", ["skill-a"]),
      verifiedTrace("d1", ["skill-a"]),
      verifiedTrace("d2", ["skill-a"]),
    ];
    const rules = [makeRule({ id: "r1", skill: "other" })];

    const r1 = replayLearnedRules({ traces: base, rules });
    // Shuffle order
    const r2 = replayLearnedRules({
      traces: [base[1]!, base[2]!, base[0]!],
      rules,
    });

    // Counts are the same
    expect(r1.baselineWins).toBe(r2.baselineWins);
    expect(r1.learnedWins).toBe(r2.learnedWins);
    expect(r1.deltaWins).toBe(r2.deltaWins);
    // Regressions sorted identically
    expect(r1.regressions).toEqual(r2.regressions);
  });
});

// ---------------------------------------------------------------------------
// Scenario scoping
// ---------------------------------------------------------------------------

describe("replayLearnedRules — scenario scoping", () => {
  test("rules only apply to matching scenario", () => {
    // Rule targets PreToolUse/feature/uiRender/Read//app
    const rule = makeRule({ id: "r1", skill: "other-skill" });

    // Trace in a DIFFERENT scenario (different hook)
    const trace = verifiedTrace("d1", ["skill-a"]);
    // Override to put in different scenario
    const diffScenarioTrace: RoutingDecisionTrace = {
      ...trace,
      hook: "UserPromptSubmit",
    };

    const result = replayLearnedRules({
      traces: [diffScenarioTrace],
      rules: [rule],
    });
    // No promoted rules match this scenario → baseline carries through
    expect(result.baselineWins).toBe(1);
    expect(result.learnedWins).toBe(1);
    expect(result.regressions).toEqual([]);
  });

  test("same skill in different scenarios are independent", () => {
    const ruleA = makeRule({
      id: "r1",
      skill: "skill-b",
      scenario: {
        hook: "PreToolUse",
        storyKind: "feature",
        targetBoundary: "uiRender",
        toolName: "Read",
        routeScope: "/app",
      },
    });
    const ruleB = makeRule({
      id: "r2",
      skill: "skill-a",
      scenario: {
        hook: "PreToolUse",
        storyKind: "bugfix",
        targetBoundary: "serverHandler",
        toolName: "Bash",
        routeScope: "/api",
      },
    });

    // Trace in scenario A — skill-a wins baseline but promoted is skill-b → regression
    const traceA = verifiedTrace("d1", ["skill-a"]);

    // Trace in scenario B — skill-a is promoted and injected → no regression
    const traceB: RoutingDecisionTrace = {
      ...verifiedTrace("d2", ["skill-a"]),
      hook: "PreToolUse",
      toolName: "Bash",
      primaryStory: {
        id: "story-2",
        kind: "bugfix",
        storyRoute: "/api",
        targetBoundary: "serverHandler",
      },
    };

    const result = replayLearnedRules({
      traces: [traceA, traceB],
      rules: [ruleA, ruleB],
    });
    expect(result.baselineWins).toBe(2);
    expect(result.learnedWins).toBe(1); // only traceB
    expect(result.regressions).toEqual(["d1"]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("replayLearnedRules — edge cases", () => {
  test("trace with empty injectedSkills and verification is not a baseline win", () => {
    const trace = makeTrace({
      decisionId: "d1",
      injectedSkills: [],
      verification: {
        verificationId: "v1",
        observedBoundary: "uiRender",
        matchedSuggestedAction: true,
      },
    });
    const result = replayLearnedRules({ traces: [trace], rules: [] });
    expect(result.baselineWins).toBe(0);
  });

  test("trace with verification false is not a baseline win", () => {
    const trace = makeTrace({
      decisionId: "d1",
      injectedSkills: ["next-config"],
      verification: {
        verificationId: "v1",
        observedBoundary: "uiRender",
        matchedSuggestedAction: false,
      },
    });
    const result = replayLearnedRules({ traces: [trace], rules: [] });
    expect(result.baselineWins).toBe(0);
  });

  test("trace with verification null matchedSuggestedAction is not a baseline win", () => {
    const trace = makeTrace({
      decisionId: "d1",
      injectedSkills: ["next-config"],
      verification: {
        verificationId: "v1",
        observedBoundary: "uiRender",
        matchedSuggestedAction: null,
      },
    });
    const result = replayLearnedRules({ traces: [trace], rules: [] });
    expect(result.baselineWins).toBe(0);
  });

  test("multiple promoted rules for same scenario are unioned", () => {
    const result = replayLearnedRules({
      traces: [
        verifiedTrace("d1", ["skill-a"]),
        verifiedTrace("d2", ["skill-b"]),
      ],
      rules: [
        makeRule({ id: "r1", skill: "skill-a" }),
        makeRule({ id: "r2", skill: "skill-b" }),
      ],
    });
    expect(result.baselineWins).toBe(2);
    expect(result.learnedWins).toBe(2);
    expect(result.regressions).toEqual([]);
  });

  test("trace with multiple injected skills: one overlaps promoted → no regression", () => {
    const result = replayLearnedRules({
      traces: [verifiedTrace("d1", ["skill-a", "skill-b"])],
      rules: [makeRule({ id: "r1", skill: "skill-b" })],
    });
    expect(result.regressions).toEqual([]);
    expect(result.learnedWins).toBe(1);
  });
});
