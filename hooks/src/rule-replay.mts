/**
 * rule-replay.mts — Deterministic replay gate for learned routing rules.
 *
 * Replays historical routing decision traces against baseline (existing)
 * routing vs learned (promoted) routing rules. Blocks promotion when any
 * trace that succeeded under baseline would regress under learned rules.
 *
 * Contract:
 * - Pure function: no file I/O, no project reads, no side effects beyond logging.
 * - Deterministic: identical inputs produce identical output, including
 *   regression ordering (sorted by decisionId).
 * - Machine-readable: ReplayResult is structured JSON.
 */

import type { RoutingDecisionTrace } from "./routing-decision-trace.mjs";
import type { LearnedRoutingRule, ReplayResult } from "./rule-distillation.mjs";
import { createLogger } from "./logger.mjs";

// ---------------------------------------------------------------------------
// Re-export ReplayResult so consumers can import from this module directly
// ---------------------------------------------------------------------------

export type { ReplayResult } from "./rule-distillation.mjs";

// ---------------------------------------------------------------------------
// Internal: scenario key from a trace (mirrors rule-distillation.mts)
// ---------------------------------------------------------------------------

function scenarioKeyFromTrace(trace: RoutingDecisionTrace): string {
  const story = trace.primaryStory;
  return [
    trace.hook,
    story.kind ?? "_",
    story.targetBoundary ?? "_",
    trace.toolName,
    story.storyRoute ?? "_",
  ].join("|");
}

// ---------------------------------------------------------------------------
// Internal: scenario key from a rule
// ---------------------------------------------------------------------------

function scenarioKeyFromRule(rule: LearnedRoutingRule): string {
  return [
    rule.scenario.hook,
    rule.scenario.storyKind ?? "_",
    rule.scenario.targetBoundary ?? "_",
    rule.scenario.toolName,
    rule.scenario.routeScope ?? "_",
  ].join("|");
}

// ---------------------------------------------------------------------------
// Core replay
// ---------------------------------------------------------------------------

/**
 * Replay historical traces against baseline vs learned routing.
 *
 * For each trace:
 * - **Baseline win**: verification succeeded and at least one skill was injected.
 * - **Learned win**: either (a) no promoted rules target this scenario so
 *   baseline carries through, or (b) at least one promoted rule's skill
 *   overlaps with the trace's injected skills.
 * - **Regression**: baseline won but promoted rules exist for this scenario
 *   and none of them cover the injected winning skill.
 *
 * Only rules with `confidence === "promote"` participate.
 */
export function replayLearnedRules(params: {
  traces: RoutingDecisionTrace[];
  rules: LearnedRoutingRule[];
}): ReplayResult {
  const { traces, rules } = params;
  const logger = createLogger("summary");

  logger.summary("replay_start", {
    traceCount: traces.length,
    ruleCount: rules.length,
    promotedCount: rules.filter((r) => r.confidence === "promote").length,
  });

  // Build promoted-skill set per scenario key
  const promotedByScenario = new Map<string, Set<string>>();
  for (const rule of rules) {
    if (rule.confidence !== "promote") continue;
    const sKey = scenarioKeyFromRule(rule);
    let skills = promotedByScenario.get(sKey);
    if (!skills) {
      skills = new Set();
      promotedByScenario.set(sKey, skills);
    }
    skills.add(rule.skill);
  }

  let baselineWins = 0;
  let learnedWins = 0;
  const regressions: string[] = [];

  for (const trace of traces) {
    const sKey = scenarioKeyFromTrace(trace);
    const promotedSkills = promotedByScenario.get(sKey);

    // Baseline: trace had verified success with at least one injected skill
    const baselineHit =
      trace.verification?.matchedSuggestedAction === true &&
      trace.injectedSkills.length > 0;

    if (baselineHit) baselineWins++;

    if (promotedSkills) {
      // Learned rules exist for this scenario
      const learnedOverlap = trace.injectedSkills.some((s) =>
        promotedSkills.has(s),
      );

      if (baselineHit && !learnedOverlap) {
        // Baseline won but promoted rules don't cover the winning skill.
        // This is a regression: learned rules would displace the winner.
        regressions.push(trace.decisionId);
        logger.summary("replay_regression", {
          decisionId: trace.decisionId,
          scenario: sKey,
          injectedSkills: trace.injectedSkills,
          promotedSkills: [...promotedSkills],
        });
      } else if (learnedOverlap) {
        // Promoted rule covers an injected skill — learned win
        learnedWins++;
      } else if (baselineHit) {
        // Dead path: baselineHit && !learnedOverlap is caught above.
        // Kept for defensive clarity.
        learnedWins++;
      }
    } else if (baselineHit) {
      // No promoted rules for this scenario — baseline win carries through
      learnedWins++;
    }
  }

  // Sort regressions for deterministic output
  regressions.sort();

  const result: ReplayResult = {
    baselineWins,
    learnedWins,
    deltaWins: learnedWins - baselineWins,
    regressions,
  };

  logger.summary("replay_complete", {
    baselineWins: result.baselineWins,
    learnedWins: result.learnedWins,
    deltaWins: result.deltaWins,
    regressionCount: result.regressions.length,
    regressionIds: result.regressions,
  });

  return result;
}
