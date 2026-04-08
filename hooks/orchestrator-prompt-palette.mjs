// hooks/src/orchestrator-prompt-palette.mts
import {
  readPersistedSkillInstallPlan,
  refreshPersistedSkillInstallPlan
} from "./orchestrator-install-plan-state.mjs";
import {
  buildProfileNextActions
} from "./profile-next-actions.mjs";
import { renderLaunchLaneActionList } from "./session-start-launch-lane.mjs";
var DIRECT_ALIASES = {
  "/vercel install": "install-missing",
  "/vercel link": "vercel-link",
  "/vercel env": "vercel-env-pull",
  "/vercel deploy": "vercel-deploy",
  "/vercel bootstrap": "bootstrap-project",
  "vp install": "install-missing",
  "vp link": "vercel-link",
  "vp env": "vercel-env-pull",
  "vp deploy": "vercel-deploy",
  "vp bootstrap": "bootstrap-project"
};
var ACTION_TERMS = [
  {
    actionId: "bootstrap-project",
    terms: [
      "bootstrap",
      "scaffold",
      "set this up",
      "get this running",
      "start this project",
      "how do i start"
    ]
  },
  {
    actionId: "install-missing",
    terms: [
      "install missing",
      "missing skills",
      "warm cache",
      "cache warmup",
      "install what's missing",
      "install what is missing"
    ]
  },
  {
    actionId: "vercel-link",
    terms: [
      "link vercel",
      "connect vercel",
      "connect project",
      "link this repo",
      "link this project"
    ]
  },
  {
    actionId: "vercel-env-pull",
    terms: [
      "env pull",
      "pull env",
      "environment variables",
      ".env.local",
      "dotenv"
    ]
  },
  {
    actionId: "vercel-deploy",
    terms: [
      "deploy",
      "ship it",
      "ship this",
      "go live",
      "publish",
      "release",
      "get this on vercel"
    ]
  }
];
var GENERIC_PALETTE_RE = /\b(what(?:'s| is)? next|next step|where should i start|what should i do|what now|how do i get this running)\b/i;
function normalizePrompt(prompt) {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}
function loadFreshInstallPlan(args) {
  try {
    const persisted = readPersistedSkillInstallPlan({
      projectRoot: args.projectRoot
    });
    if (!persisted) {
      args.logger?.debug?.("orchestrator-prompt-palette:plan-missing", {
        projectRoot: args.projectRoot,
        reason: "no persisted plan"
      });
      return null;
    }
    const refreshed = refreshPersistedSkillInstallPlan({
      projectRoot: args.projectRoot,
      previousPlan: persisted,
      pluginRootOverride: args.pluginRoot
    });
    args.logger?.debug?.("orchestrator-prompt-palette:plan-loaded", {
      projectRoot: args.projectRoot,
      createdAt: refreshed.createdAt,
      likelySkills: refreshed.likelySkills,
      missingSkills: refreshed.missingSkills,
      vercelLinked: refreshed.vercelLinked,
      hasEnvLocal: refreshed.hasEnvLocal
    });
    return refreshed;
  } catch {
    args.logger?.debug?.("orchestrator-prompt-palette:plan-missing", {
      projectRoot: args.projectRoot,
      reason: "load or refresh failed"
    });
    return null;
  }
}
function scorePromptPaletteActions(args) {
  const prompt = normalizePrompt(args.prompt);
  const directAliasActionId = DIRECT_ALIASES[prompt];
  if (directAliasActionId) {
    const direct = args.actions.find(
      (action) => action.id === directAliasActionId
    );
    const matches2 = direct ? [
      {
        actionId: direct.id,
        score: 100,
        reasons: [`direct alias: ${prompt}`],
        direct: true
      }
    ] : [];
    args.logger?.debug?.("orchestrator-prompt-palette:intent-scored", {
      mode: "direct",
      prompt,
      matches: matches2
    });
    return matches2;
  }
  const matches = [];
  for (const action of args.actions) {
    const config = ACTION_TERMS.find(
      (entry) => entry.actionId === action.id
    );
    if (!config) continue;
    const reasons = config.terms.filter((term) => prompt.includes(term));
    if (reasons.length === 0) continue;
    matches.push({
      actionId: action.id,
      score: reasons.length * 4 + (prompt.includes("vercel") ? 1 : 0),
      reasons,
      direct: false
    });
  }
  matches.sort(
    (left, right) => right.score - left.score || left.actionId.localeCompare(right.actionId)
  );
  args.logger?.debug?.("orchestrator-prompt-palette:intent-scored", {
    mode: "keywords",
    prompt,
    matches
  });
  return matches;
}
function renderPromptActionPalette(args) {
  const nextActions = buildProfileNextActions({
    pluginRoot: args.pluginRoot,
    projectRoot: args.projectRoot,
    installPlan: args.plan
  });
  if (nextActions.length === 0) {
    args.logger?.debug?.("orchestrator-prompt-palette:suppressed", {
      projectRoot: args.projectRoot,
      reason: "no-visible-actions"
    });
    return null;
  }
  const matches = scorePromptPaletteActions({
    prompt: args.prompt,
    actions: nextActions,
    logger: args.logger
  });
  const selectedActions = matches.length > 0 ? matches.map(
    (match) => nextActions.find((action) => action.id === match.actionId) ?? null
  ).filter(
    (value) => value !== null
  ).slice(0, 3) : GENERIC_PALETTE_RE.test(args.prompt) ? nextActions.slice(0, 3) : [];
  if (selectedActions.length === 0) {
    args.logger?.debug?.("orchestrator-prompt-palette:suppressed", {
      projectRoot: args.projectRoot,
      promptPreview: args.prompt.slice(0, 120),
      reason: "no-orchestrator-intent"
    });
    return null;
  }
  const lines = [
    "### Vercel action palette",
    `- Linked: ${args.plan.vercelLinked ? "yes" : "no"}`,
    `- Env pulled: ${args.plan.hasEnvLocal ? "yes" : "no"}`,
    `- Missing skill cache: ${args.plan.missingSkills.length > 0 ? args.plan.missingSkills.join(", ") : "none"}`,
    "",
    "### Best next moves",
    ...renderLaunchLaneActionList(selectedActions, selectedActions.length)
  ];
  const rendered = lines.join("\n");
  args.logger?.debug?.("orchestrator-prompt-palette:rendered", {
    projectRoot: args.projectRoot,
    actionIds: selectedActions.map((action) => action.id),
    bytes: Buffer.byteLength(rendered, "utf8")
  });
  return rendered;
}
function buildPromptActionPalette(args) {
  const plan = loadFreshInstallPlan({
    projectRoot: args.projectRoot,
    pluginRoot: args.pluginRoot,
    logger: args.logger
  });
  if (!plan) return null;
  return renderPromptActionPalette({
    prompt: args.prompt,
    projectRoot: args.projectRoot,
    pluginRoot: args.pluginRoot,
    plan,
    logger: args.logger
  });
}
export {
  buildPromptActionPalette,
  loadFreshInstallPlan,
  renderPromptActionPalette,
  scorePromptPaletteActions
};
