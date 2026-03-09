#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginRoot as resolvePluginRoot, profileCachePath, safeReadFile, safeReadJson } from "./hook-env.mjs";
import { createLogger, logCaughtError } from "./logger.mjs";
import { compilePromptSignals, matchPromptWithReason, normalizePromptText } from "./prompt-patterns.mjs";
import { loadSkills } from "./pretooluse-skill-inject.mjs";
import { extractFrontmatter } from "./skill-map-frontmatter.mjs";
import { claimPendingLaunch } from "./subagent-state.mjs";
const PLUGIN_ROOT = resolvePluginRoot();
const MINIMAL_BUDGET_BYTES = 1024;
const LIGHT_BUDGET_BYTES = 3072;
const STANDARD_BUDGET_BYTES = 8e3;
const log = createLogger();
function parseInput() {
  try {
    const raw = readFileSync(0, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function getLikelySkills(sessionId) {
  if (sessionId) {
    const cache = safeReadJson(profileCachePath(sessionId));
    if (cache && Array.isArray(cache.likelySkills) && cache.likelySkills.length > 0) {
      log.debug("subagent-start-bootstrap:profile-cache-hit", { sessionId, skills: cache.likelySkills });
      return cache.likelySkills;
    }
    log.debug("subagent-start-bootstrap:profile-cache-miss", { sessionId });
  }
  const raw = process.env.VERCEL_PLUGIN_LIKELY_SKILLS;
  if (!raw || raw.trim() === "") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
function resolveBudgetCategory(agentType) {
  if (agentType === "Explore") return "minimal";
  if (agentType === "Plan") return "light";
  return "standard";
}
function budgetBytesForCategory(category) {
  switch (category) {
    case "minimal":
      return MINIMAL_BUDGET_BYTES;
    case "light":
      return LIGHT_BUDGET_BYTES;
    case "standard":
      return STANDARD_BUDGET_BYTES;
  }
}
function getPromptMatchedSkills(promptText) {
  const normalizedPrompt = normalizePromptText(promptText);
  if (!normalizedPrompt) return [];
  try {
    const loaded = loadSkills(PLUGIN_ROOT, log);
    if (!loaded) return [];
    const matches = [];
    for (const [skill, config] of Object.entries(loaded.skillMap)) {
      if (!config.promptSignals) continue;
      const compiled = compilePromptSignals(config.promptSignals);
      const result = matchPromptWithReason(normalizedPrompt, compiled);
      if (!result.matched) continue;
      matches.push({
        skill,
        score: result.score,
        priority: config.priority
      });
    }
    matches.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.skill.localeCompare(right.skill);
    });
    log.debug("subagent-start-bootstrap:prompt-skill-match", {
      promptLength: promptText.length,
      matchedSkills: matches.map(({ skill, score }) => ({ skill, score }))
    });
    return matches;
  } catch (error) {
    logCaughtError(log, "subagent-start-bootstrap:prompt-skill-match-failed", error, {
      promptLength: promptText.length
    });
    return [];
  }
}
function mergeLikelySkills(likelySkills, promptMatchedSkills) {
  if (promptMatchedSkills.length === 0) return likelySkills;
  const promptSkillNames = promptMatchedSkills.map((entry) => entry.skill);
  return [.../* @__PURE__ */ new Set([...promptSkillNames, ...likelySkills])];
}
function resolveLikelySkillsFromPendingLaunch(sessionId, agentType, likelySkills) {
  if (!sessionId) return likelySkills;
  try {
    const pendingLaunch = claimPendingLaunch(sessionId, agentType);
    if (!pendingLaunch) {
      log.debug("subagent-start-bootstrap:pending-launch", {
        sessionId,
        agentType,
        claimedLaunch: false,
        likelySkills
      });
      return likelySkills;
    }
    const promptText = `${pendingLaunch.description} ${pendingLaunch.prompt}`.trim();
    const promptMatchedSkills = getPromptMatchedSkills(promptText);
    const effectiveLikelySkills = mergeLikelySkills(likelySkills, promptMatchedSkills);
    log.debug("subagent-start-bootstrap:pending-launch", {
      sessionId,
      agentType,
      claimedLaunch: true,
      promptMatchedSkills: promptMatchedSkills.map(({ skill, score }) => ({ skill, score })),
      likelySkills: effectiveLikelySkills
    });
    return effectiveLikelySkills;
  } catch (error) {
    logCaughtError(log, "subagent-start-bootstrap:pending-launch-route-failed", error, {
      sessionId,
      agentType,
      likelySkills
    });
    return likelySkills;
  }
}
function profileLine(agentType, likelySkills) {
  return "Vercel plugin active. Project likely uses: " + (likelySkills.length > 0 ? likelySkills.join(", ") : "unknown stack") + ".";
}
function buildMinimalContext(agentType, likelySkills) {
  const parts = [];
  parts.push(`<!-- vercel-plugin:subagent-bootstrap agent_type="${agentType}" budget="minimal" -->`);
  parts.push(profileLine(agentType, likelySkills));
  parts.push("<!-- /vercel-plugin:subagent-bootstrap -->");
  return parts.join("\n");
}
function buildLightContext(agentType, likelySkills, budgetBytes) {
  const parts = [];
  parts.push(`<!-- vercel-plugin:subagent-bootstrap agent_type="${agentType}" budget="light" -->`);
  parts.push(profileLine(agentType, likelySkills));
  let usedBytes = Buffer.byteLength(parts.join("\n"), "utf8");
  const loaded = loadSkills(PLUGIN_ROOT, log);
  if (loaded) {
    for (const skill of likelySkills) {
      const config = loaded.skillMap[skill];
      if (!config) continue;
      const summary = config.summary;
      if (!summary) continue;
      const line = `- **${skill}**: ${summary}`;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (usedBytes + lineBytes + 1 > budgetBytes) break;
      parts.push(line);
      usedBytes += lineBytes + 1;
    }
  }
  const constraints = [
    "Deployment targets Vercel. Use framework conventions (e.g. Next.js app router, API routes).",
    "Environment variables are managed via `vercel env`. Do not hardcode secrets."
  ];
  for (const constraint of constraints) {
    const lineBytes = Buffer.byteLength(constraint, "utf8");
    if (usedBytes + lineBytes + 1 > budgetBytes) break;
    parts.push(constraint);
    usedBytes += lineBytes + 1;
  }
  parts.push("<!-- /vercel-plugin:subagent-bootstrap -->");
  return parts.join("\n");
}
function buildStandardContext(agentType, likelySkills, budgetBytes) {
  const parts = [];
  parts.push(`<!-- vercel-plugin:subagent-bootstrap agent_type="${agentType}" budget="standard" -->`);
  parts.push(profileLine(agentType, likelySkills));
  let usedBytes = Buffer.byteLength(parts.join("\n"), "utf8");
  const loaded = loadSkills(PLUGIN_ROOT, log);
  for (const skill of likelySkills) {
    const skillPath = join(PLUGIN_ROOT, "skills", skill, "SKILL.md");
    const raw = safeReadFile(skillPath);
    if (raw !== null) {
      const { body } = extractFrontmatter(raw);
      const content = body.trimStart();
      const wrapped = `<!-- skill:${skill} -->
${content}
<!-- /skill:${skill} -->`;
      const byteLen = Buffer.byteLength(wrapped, "utf8");
      if (usedBytes + byteLen + 1 <= budgetBytes) {
        parts.push(wrapped);
        usedBytes += byteLen + 1;
        continue;
      }
    }
    const summary = loaded?.skillMap[skill]?.summary;
    if (summary) {
      const line = `<!-- skill:${skill} mode:summary -->
${summary}
<!-- /skill:${skill} -->`;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (usedBytes + lineBytes + 1 <= budgetBytes) {
        parts.push(line);
        usedBytes += lineBytes + 1;
      }
    }
  }
  parts.push("<!-- /vercel-plugin:subagent-bootstrap -->");
  return parts.join("\n");
}
function main() {
  const input = parseInput();
  if (!input) {
    process.exit(0);
  }
  const agentId = input.agent_id ?? "unknown";
  const agentType = input.agent_type ?? "unknown";
  const sessionId = input.session_id;
  log.debug("subagent-start-bootstrap", { agentId, agentType, sessionId });
  const profilerLikelySkills = getLikelySkills(sessionId);
  const likelySkills = resolveLikelySkillsFromPendingLaunch(
    sessionId,
    agentType,
    profilerLikelySkills
  );
  const category = resolveBudgetCategory(agentType);
  const maxBytes = budgetBytesForCategory(category);
  let context;
  switch (category) {
    case "minimal":
      context = buildMinimalContext(agentType, likelySkills);
      break;
    case "light":
      context = buildLightContext(agentType, likelySkills, maxBytes);
      break;
    case "standard":
      context = buildStandardContext(agentType, likelySkills, maxBytes);
      break;
  }
  if (Buffer.byteLength(context, "utf8") > maxBytes) {
    context = Buffer.from(context, "utf8").subarray(0, maxBytes).toString("utf8");
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: context
    }
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}
const ENTRYPOINT = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] ? resolve(process.argv[1]) === ENTRYPOINT : false;
if (isEntrypoint) {
  main();
}
export {
  LIGHT_BUDGET_BYTES,
  MINIMAL_BUDGET_BYTES,
  STANDARD_BUDGET_BYTES,
  buildLightContext,
  buildMinimalContext,
  buildStandardContext,
  getLikelySkills,
  main,
  parseInput
};
