/**
 * `vercel-plugin learn` — Distill verified routing wins into learned rules.
 *
 * Reads routing decision traces, exposure ledgers, and verification outcomes
 * from session history, distills high-precision routing rules, replays them
 * against historical traces to guard against regressions, and outputs or
 * writes the result as a deterministic JSON artifact.
 *
 * Usage:
 *   vercel-plugin learn --project . --json
 *   vercel-plugin learn --project . --write
 */

import { existsSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { readRoutingDecisionTrace } from "../../hooks/src/routing-decision-trace.mts";
import { loadSessionExposures, loadProjectRoutingPolicy } from "../../hooks/src/routing-policy-ledger.mts";
import { distillRulesFromTrace } from "../../hooks/src/rule-distillation.mts";
import type { LearnedRoutingRulesFile } from "../../hooks/src/rule-distillation.mts";
import type { RoutingDecisionTrace } from "../../hooks/src/routing-decision-trace.mts";
import type { SkillExposure } from "../../hooks/src/routing-policy-ledger.mts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LearnCommandOptions {
  project?: string;
  json?: boolean;
  write?: boolean;
  session?: string;
  minSupport?: number;
  minPrecision?: number;
  minLift?: number;
}

// ---------------------------------------------------------------------------
// Session discovery
// ---------------------------------------------------------------------------

/**
 * Discover session IDs from tmpdir by scanning for trace directories and
 * keeping only sessions whose exposure ledger belongs to the target project.
 * Pattern: vercel-plugin-<sessionId>-trace/
 */
function discoverSessionIds(projectRoot: string): string[] {
  const tmp = tmpdir();
  try {
    const entries = readdirSync(tmp);
    const ids: string[] = [];
    for (const entry of entries) {
      const match = entry.match(/^vercel-plugin-(.+)-trace$/);
      if (!match || !match[1]) continue;
      const sessionExposures = loadSessionExposures(match[1]);
      if (
        sessionExposures.some((exposure) => exposure.projectRoot === projectRoot)
      ) {
        ids.push(match[1]);
      }
    }
    return ids.sort();
  } catch {
    return [];
  }
}

/**
 * Load all traces, optionally scoped to a single session.
 */
function loadTraces(
  sessionId: string | null,
  projectRoot: string,
): RoutingDecisionTrace[] {
  if (sessionId) {
    return readRoutingDecisionTrace(sessionId);
  }
  // Aggregate across all discovered sessions
  const sessionIds = discoverSessionIds(projectRoot);
  const all: RoutingDecisionTrace[] = [];
  for (const id of sessionIds) {
    all.push(...readRoutingDecisionTrace(id));
  }
  return all;
}

/**
 * Load all exposures, optionally scoped to a single session.
 */
function loadExposures(
  sessionId: string | null,
  projectRoot: string,
): SkillExposure[] {
  if (sessionId) {
    return loadSessionExposures(sessionId);
  }
  const sessionIds = discoverSessionIds(projectRoot);
  const all: SkillExposure[] = [];
  for (const id of sessionIds) {
    all.push(...loadSessionExposures(id));
  }
  return all;
}

// ---------------------------------------------------------------------------
// Output path
// ---------------------------------------------------------------------------

export function learnedRulesPath(projectRoot: string): string {
  return join(projectRoot, "generated", "learned-routing-rules.json");
}

// ---------------------------------------------------------------------------
// Core command
// ---------------------------------------------------------------------------

export async function runLearnCommand(options: LearnCommandOptions): Promise<number> {
  const projectRoot = resolve(options.project ?? ".");
  const jsonOutput = options.json ?? false;
  const writeOutput = options.write ?? false;
  const sessionId = options.session ?? null;

  // Validate project root
  const skillsDir = join(projectRoot, "skills");
  if (!existsSync(skillsDir)) {
    const msg = `error: no skills/ directory found at ${projectRoot}`;
    if (jsonOutput) {
      console.log(JSON.stringify({ ok: false, error: msg }));
    } else {
      console.error(msg);
    }
    return 2;
  }

  // Load inputs
  const traces = loadTraces(sessionId, projectRoot);
  const exposures = loadExposures(sessionId, projectRoot);
  const policy = loadProjectRoutingPolicy(projectRoot);

  console.error(JSON.stringify({
    event: "learn_inputs_loaded",
    traceCount: traces.length,
    exposureCount: exposures.length,
    sessionScope: sessionId ?? "all",
  }));

  if (traces.length === 0) {
    const result: LearnedRoutingRulesFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      projectRoot,
      rules: [],
      replay: { baselineWins: 0, learnedWins: 0, deltaWins: 0, regressions: [] },
    };
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error("No routing decision traces found. Run some sessions first.");
      // Still emit human-readable summary for consistent output
      console.log([
        "Learned routing rules: 0",
        "  promoted: 0",
        "  candidate: 0",
        "  holdout-fail: 0",
        "",
        "Replay:",
        "  baseline wins: 0",
        "  learned wins:  0",
        "  delta:         0",
        "  regressions:   0",
      ].join("\n"));
    }
    if (writeOutput) {
      const outPath = learnedRulesPath(projectRoot);
      writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
      console.error(JSON.stringify({ event: "learn_written", path: outPath }));
    }
    return 0;
  }

  // Distill
  const result = distillRulesFromTrace({
    projectRoot,
    traces,
    exposures,
    policy,
    minSupport: options.minSupport,
    minPrecision: options.minPrecision,
    minLift: options.minLift,
  });

  const promoted = result.rules.filter((r) => r.confidence === "promote").length;
  const candidates = result.rules.filter((r) => r.confidence === "candidate").length;
  const holdoutFail = result.rules.filter((r) => r.confidence === "holdout-fail").length;

  console.error(JSON.stringify({
    event: "learn_distill_complete",
    ruleCount: result.rules.length,
    promoted,
    candidates,
    holdoutFail,
    replayDelta: result.replay.deltaWins,
    regressions: result.replay.regressions.length,
  }));

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Human-readable summary
    const lines: string[] = [
      `Learned routing rules: ${result.rules.length}`,
      `  promoted: ${promoted}`,
      `  candidate: ${candidates}`,
      `  holdout-fail: ${holdoutFail}`,
      "",
      `Replay:`,
      `  baseline wins: ${result.replay.baselineWins}`,
      `  learned wins:  ${result.replay.learnedWins}`,
      `  delta:         ${result.replay.deltaWins > 0 ? "+" : ""}${result.replay.deltaWins}`,
      `  regressions:   ${result.replay.regressions.length}`,
    ];

    if (result.replay.regressions.length > 0) {
      lines.push("");
      lines.push("Regression decision IDs:");
      for (const id of result.replay.regressions) {
        lines.push(`  - ${id}`);
      }
    }

    if (promoted > 0) {
      lines.push("");
      lines.push("Promoted rules:");
      for (const rule of result.rules) {
        if (rule.confidence !== "promote") continue;
        lines.push(`  ${rule.id} (${rule.kind}, precision=${rule.precision}, lift=${rule.lift}, support=${rule.support})`);
      }
    }

    console.log(lines.join("\n"));
  }

  // Write
  if (writeOutput) {
    const outPath = learnedRulesPath(projectRoot);
    const payload = JSON.stringify(result, null, 2) + "\n";
    writeFileSync(outPath, payload);
    console.error(JSON.stringify({ event: "learn_written", path: outPath }));
  }

  // Non-zero exit if regressions detected
  if (result.replay.regressions.length > 0) {
    console.error(JSON.stringify({
      event: "learn_regressions_detected",
      count: result.replay.regressions.length,
    }));
    return 1;
  }

  return 0;
}
