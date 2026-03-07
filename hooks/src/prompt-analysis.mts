/**
 * Prompt analysis report module.
 *
 * Provides a structured report of prompt-signal evaluation for debugging,
 * dry-run CLI, and agentic workflows. Reuses matching logic from
 * prompt-patterns.mts — no logic duplication.
 */

import { normalizePromptText, compilePromptSignals, matchPromptWithReason } from "./prompt-patterns.mjs";
import type { CompiledPromptSignals, PromptMatchResult } from "./prompt-patterns.mjs";
import { parseSeenSkills } from "./patterns.mjs";
import type { SkillConfig, PromptSignals } from "./skill-map-frontmatter.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerSkillResult {
  score: number;
  reason: string;
  matched: boolean;
  suppressed: boolean;
}

export interface PromptAnalysisReport {
  normalizedPrompt: string;
  perSkillResults: Record<string, PerSkillResult>;
  selectedSkills: string[];
  droppedByCap: string[];
  droppedByBudget: string[];
  dedupState: {
    strategy: "env-var" | "memory-only" | "disabled";
    seenSkills: string[];
    filteredByDedup: string[];
  };
  budgetBytes: number;
  timingMs: number;
}

// ---------------------------------------------------------------------------
// analyzePrompt
// ---------------------------------------------------------------------------

/**
 * Analyze a prompt against a skill map and return a structured report.
 *
 * This is a pure analysis function — it does not perform injection, does not
 * read stdin, and does not write to stdout. It reuses normalizePromptText,
 * compilePromptSignals, and matchPromptWithReason from prompt-patterns.mts.
 */
export function analyzePrompt(
  prompt: string,
  skillMap: Record<string, SkillConfig>,
  seenSkills: string,
  budgetBytes: number,
  maxSkills: number,
): PromptAnalysisReport {
  const t0 = performance.now();

  const normalizedPrompt = normalizePromptText(prompt);

  // Determine dedup strategy
  const dedupOff = process.env.VERCEL_PLUGIN_HOOK_DEDUP === "off";
  const hasEnvVar = typeof seenSkills === "string";
  const strategy: PromptAnalysisReport["dedupState"]["strategy"] = dedupOff
    ? "disabled"
    : hasEnvVar
      ? "env-var"
      : "memory-only";
  const seenSet = dedupOff ? new Set<string>() : parseSeenSkills(seenSkills);

  // Evaluate all skills with promptSignals
  const perSkillResults: Record<string, PerSkillResult> = {};
  const matched: Array<{ skill: string; score: number; priority: number }> = [];

  for (const [skill, config] of Object.entries(skillMap)) {
    if (!config.promptSignals) continue;

    const compiled = compilePromptSignals(config.promptSignals);
    const result = matchPromptWithReason(normalizedPrompt, compiled);

    perSkillResults[skill] = {
      score: result.score,
      reason: result.reason,
      matched: result.matched,
      suppressed: result.score === -Infinity,
    };

    if (result.matched) {
      matched.push({ skill, score: result.score, priority: config.priority });
    }
  }

  // Sort by score DESC, priority DESC, skill ASC (same as matchPromptSignals)
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.skill.localeCompare(b.skill);
  });

  // Filter deduped skills
  const filteredByDedup: string[] = [];
  const afterDedup = matched.filter((m) => {
    if (!dedupOff && seenSet.has(m.skill)) {
      filteredByDedup.push(m.skill);
      return false;
    }
    return true;
  });

  // Apply max-skills cap
  const selected = afterDedup.slice(0, maxSkills);
  const droppedByCap = afterDedup.slice(maxSkills).map((m) => m.skill);

  // Simulate budget enforcement — estimate body sizes from skillMap summaries
  // Real budget enforcement happens during injection (reads SKILL.md files),
  // but for analysis we track what would be selected pre-budget.
  const selectedSkills = selected.map((m) => m.skill);
  const droppedByBudget: string[] = [];

  // Budget simulation: use summary length as proxy (real injection reads files)
  let usedBytes = 0;
  const finalSelected: string[] = [];
  for (const skill of selectedSkills) {
    const config = skillMap[skill];
    // Estimate: summary is typically a small fraction of SKILL.md body
    // Use summary length * 10 as rough proxy, minimum 500 bytes
    const estimatedSize = config?.summary ? Math.max(config.summary.length * 10, 500) : 500;
    if (usedBytes + estimatedSize > budgetBytes && finalSelected.length > 0) {
      droppedByBudget.push(skill);
    } else {
      usedBytes += estimatedSize;
      finalSelected.push(skill);
    }
  }

  const timingMs = Math.round(performance.now() - t0);

  return {
    normalizedPrompt,
    perSkillResults,
    selectedSkills: finalSelected,
    droppedByCap,
    droppedByBudget,
    dedupState: {
      strategy,
      seenSkills: [...seenSet],
      filteredByDedup,
    },
    budgetBytes,
    timingMs,
  };
}
