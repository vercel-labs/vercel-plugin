// hooks/src/rule-replay.mts
import { createLogger } from "./logger.mjs";
function scenarioKeyFromTrace(trace) {
  const story = trace.primaryStory;
  return [
    trace.hook,
    story.kind ?? "_",
    story.targetBoundary ?? "_",
    trace.toolName,
    story.storyRoute ?? "_"
  ].join("|");
}
function scenarioKeyFromRule(rule) {
  return [
    rule.scenario.hook,
    rule.scenario.storyKind ?? "_",
    rule.scenario.targetBoundary ?? "_",
    rule.scenario.toolName,
    rule.scenario.routeScope ?? "_"
  ].join("|");
}
function replayLearnedRules(params) {
  const { traces, rules } = params;
  const logger = createLogger("summary");
  logger.summary("replay_start", {
    traceCount: traces.length,
    ruleCount: rules.length,
    promotedCount: rules.filter((r) => r.confidence === "promote").length
  });
  const promotedByScenario = /* @__PURE__ */ new Map();
  for (const rule of rules) {
    if (rule.confidence !== "promote") continue;
    const sKey = scenarioKeyFromRule(rule);
    let skills = promotedByScenario.get(sKey);
    if (!skills) {
      skills = /* @__PURE__ */ new Set();
      promotedByScenario.set(sKey, skills);
    }
    skills.add(rule.skill);
  }
  let baselineWins = 0;
  let learnedWins = 0;
  const regressions = [];
  for (const trace of traces) {
    const sKey = scenarioKeyFromTrace(trace);
    const promotedSkills = promotedByScenario.get(sKey);
    const baselineHit = trace.verification?.matchedSuggestedAction === true && trace.injectedSkills.length > 0;
    if (baselineHit) baselineWins++;
    if (promotedSkills) {
      const learnedOverlap = trace.injectedSkills.some(
        (s) => promotedSkills.has(s)
      );
      if (baselineHit && !learnedOverlap) {
        regressions.push(trace.decisionId);
        logger.summary("replay_regression", {
          decisionId: trace.decisionId,
          scenario: sKey,
          injectedSkills: trace.injectedSkills,
          promotedSkills: [...promotedSkills]
        });
      } else if (learnedOverlap) {
        learnedWins++;
      } else if (baselineHit) {
        learnedWins++;
      }
    } else if (baselineHit) {
      learnedWins++;
    }
  }
  regressions.sort();
  const result = {
    baselineWins,
    learnedWins,
    deltaWins: learnedWins - baselineWins,
    regressions
  };
  logger.summary("replay_complete", {
    baselineWins: result.baselineWins,
    learnedWins: result.learnedWins,
    deltaWins: result.deltaWins,
    regressionCount: result.regressions.length,
    regressionIds: result.regressions
  });
  return result;
}
export {
  replayLearnedRules
};
