import { normalizePromptText, compilePromptSignals, matchPromptWithReason } from "./prompt-patterns.mjs";
import { parseSeenSkills } from "./patterns.mjs";
function analyzePrompt(prompt, skillMap, seenSkills, budgetBytes, maxSkills) {
  const t0 = performance.now();
  const normalizedPrompt = normalizePromptText(prompt);
  const dedupOff = process.env.VERCEL_PLUGIN_HOOK_DEDUP === "off";
  const hasEnvVar = typeof seenSkills === "string";
  const strategy = dedupOff ? "disabled" : hasEnvVar ? "env-var" : "memory-only";
  const seenSet = dedupOff ? /* @__PURE__ */ new Set() : parseSeenSkills(seenSkills);
  const perSkillResults = {};
  const matched = [];
  for (const [skill, config] of Object.entries(skillMap)) {
    if (!config.promptSignals) continue;
    const compiled = compilePromptSignals(config.promptSignals);
    const result = matchPromptWithReason(normalizedPrompt, compiled);
    perSkillResults[skill] = {
      score: result.score,
      reason: result.reason,
      matched: result.matched,
      suppressed: result.score === -Infinity
    };
    if (result.matched) {
      matched.push({ skill, score: result.score, priority: config.priority });
    }
  }
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.skill.localeCompare(b.skill);
  });
  const filteredByDedup = [];
  const afterDedup = matched.filter((m) => {
    if (!dedupOff && seenSet.has(m.skill)) {
      filteredByDedup.push(m.skill);
      return false;
    }
    return true;
  });
  const selected = afterDedup.slice(0, maxSkills);
  const droppedByCap = afterDedup.slice(maxSkills).map((m) => m.skill);
  const selectedSkills = selected.map((m) => m.skill);
  const droppedByBudget = [];
  let usedBytes = 0;
  const finalSelected = [];
  for (const skill of selectedSkills) {
    const config = skillMap[skill];
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
      filteredByDedup
    },
    budgetBytes,
    timingMs
  };
}
export {
  analyzePrompt
};
