/**
 * Prompt-native orchestrator palette — mid-session workflow accelerator.
 *
 * Reads the freshest persisted install plan from disk, scores the current
 * prompt against orchestrator intents (direct aliases + keyword matching),
 * and renders a compact action palette without executing anything.
 *
 * Integration: called from UserPromptSubmit to attach a small companion
 * surface alongside normal skill injection.
 */

import type { SkillInstallPlan } from "./orchestrator-install-plan.mjs";
import {
  readPersistedSkillInstallPlan,
  refreshPersistedSkillInstallPlan,
} from "./orchestrator-install-plan-state.mjs";
import {
  buildProfileNextActions,
  type ProfileNextAction,
} from "./profile-next-actions.mjs";
import { renderLaunchLaneActionList } from "./session-start-launch-lane.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptPaletteLogger {
  debug?: (event: string, data: Record<string, unknown>) => void;
}

export type PromptPaletteActionId = ProfileNextAction["id"];

export interface PromptPaletteMatch {
  actionId: PromptPaletteActionId;
  score: number;
  reasons: string[];
  direct: boolean;
}

// ---------------------------------------------------------------------------
// Direct aliases (exact prompt → action)
// ---------------------------------------------------------------------------

const DIRECT_ALIASES: Record<string, PromptPaletteActionId> = {
  "/vercel install": "install-missing",
  "/vercel link": "vercel-link",
  "/vercel env": "vercel-env-pull",
  "/vercel deploy": "vercel-deploy",
  "/vercel bootstrap": "bootstrap-project",
  "vp install": "install-missing",
  "vp link": "vercel-link",
  "vp env": "vercel-env-pull",
  "vp deploy": "vercel-deploy",
  "vp bootstrap": "bootstrap-project",
};

// ---------------------------------------------------------------------------
// Keyword scoring
// ---------------------------------------------------------------------------

const ACTION_TERMS: Array<{
  actionId: PromptPaletteActionId;
  terms: readonly string[];
}> = [
  {
    actionId: "bootstrap-project",
    terms: [
      "bootstrap",
      "scaffold",
      "set this up",
      "get this running",
      "start this project",
      "how do i start",
    ],
  },
  {
    actionId: "install-missing",
    terms: [
      "install missing",
      "missing skills",
      "warm cache",
      "cache warmup",
      "install what's missing",
      "install what is missing",
    ],
  },
  {
    actionId: "vercel-link",
    terms: [
      "link vercel",
      "connect vercel",
      "connect project",
      "link this repo",
      "link this project",
    ],
  },
  {
    actionId: "vercel-env-pull",
    terms: [
      "env pull",
      "pull env",
      "environment variables",
      ".env.local",
      "dotenv",
    ],
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
      "get this on vercel",
    ],
  },
];

const GENERIC_PALETTE_RE =
  /\b(what(?:'s| is)? next|next step|where should i start|what should i do|what now|how do i get this running)\b/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Plan loading (always from disk — never stale env snapshot)
// ---------------------------------------------------------------------------

export function loadFreshInstallPlan(args: {
  projectRoot: string;
  pluginRoot?: string;
  logger?: PromptPaletteLogger;
}): SkillInstallPlan | null {
  try {
    const persisted = readPersistedSkillInstallPlan({
      projectRoot: args.projectRoot,
    });
    if (!persisted) {
      args.logger?.debug?.("orchestrator-prompt-palette:plan-missing", {
        projectRoot: args.projectRoot,
        reason: "no persisted plan",
      });
      return null;
    }
    const refreshed = refreshPersistedSkillInstallPlan({
      projectRoot: args.projectRoot,
      previousPlan: persisted,
      pluginRootOverride: args.pluginRoot,
    });
    args.logger?.debug?.("orchestrator-prompt-palette:plan-loaded", {
      projectRoot: args.projectRoot,
      createdAt: refreshed.createdAt,
      likelySkills: refreshed.likelySkills,
      missingSkills: refreshed.missingSkills,
      vercelLinked: refreshed.vercelLinked,
      hasEnvLocal: refreshed.hasEnvLocal,
    });
    return refreshed;
  } catch {
    args.logger?.debug?.("orchestrator-prompt-palette:plan-missing", {
      projectRoot: args.projectRoot,
      reason: "load or refresh failed",
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Intent scoring
// ---------------------------------------------------------------------------

export function scorePromptPaletteActions(args: {
  prompt: string;
  actions: ProfileNextAction[];
  logger?: PromptPaletteLogger;
}): PromptPaletteMatch[] {
  const prompt = normalizePrompt(args.prompt);

  // Check direct aliases first
  const directAliasActionId = DIRECT_ALIASES[prompt];
  if (directAliasActionId) {
    const direct = args.actions.find(
      (action) => action.id === directAliasActionId,
    );
    const matches = direct
      ? [
          {
            actionId: direct.id,
            score: 100,
            reasons: [`direct alias: ${prompt}`],
            direct: true,
          },
        ]
      : [];
    args.logger?.debug?.("orchestrator-prompt-palette:intent-scored", {
      mode: "direct",
      prompt,
      matches,
    });
    return matches;
  }

  // Keyword scoring
  const matches: PromptPaletteMatch[] = [];
  for (const action of args.actions) {
    const config = ACTION_TERMS.find(
      (entry) => entry.actionId === action.id,
    );
    if (!config) continue;
    const reasons = config.terms.filter((term) => prompt.includes(term));
    if (reasons.length === 0) continue;
    matches.push({
      actionId: action.id,
      score: reasons.length * 4 + (prompt.includes("vercel") ? 1 : 0),
      reasons,
      direct: false,
    });
  }

  matches.sort(
    (left, right) =>
      right.score - left.score || left.actionId.localeCompare(right.actionId),
  );

  args.logger?.debug?.("orchestrator-prompt-palette:intent-scored", {
    mode: "keywords",
    prompt,
    matches,
  });

  return matches;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderPromptActionPalette(args: {
  prompt: string;
  projectRoot: string;
  pluginRoot: string;
  plan: SkillInstallPlan;
  logger?: PromptPaletteLogger;
}): string | null {
  const nextActions = buildProfileNextActions({
    pluginRoot: args.pluginRoot,
    projectRoot: args.projectRoot,
    installPlan: args.plan,
  });

  if (nextActions.length === 0) {
    args.logger?.debug?.("orchestrator-prompt-palette:suppressed", {
      projectRoot: args.projectRoot,
      reason: "no-visible-actions",
    });
    return null;
  }

  const matches = scorePromptPaletteActions({
    prompt: args.prompt,
    actions: nextActions,
    logger: args.logger,
  });

  const selectedActions =
    matches.length > 0
      ? matches
          .map(
            (match) =>
              nextActions.find((action) => action.id === match.actionId) ??
              null,
          )
          .filter(
            (value): value is ProfileNextAction => value !== null,
          )
          .slice(0, 3)
      : GENERIC_PALETTE_RE.test(args.prompt)
        ? nextActions.slice(0, 3)
        : [];

  if (selectedActions.length === 0) {
    args.logger?.debug?.("orchestrator-prompt-palette:suppressed", {
      projectRoot: args.projectRoot,
      promptPreview: args.prompt.slice(0, 120),
      reason: "no-orchestrator-intent",
    });
    return null;
  }

  const lines: string[] = [
    "### Vercel action palette",
    `- Linked: ${args.plan.vercelLinked ? "yes" : "no"}`,
    `- Env pulled: ${args.plan.hasEnvLocal ? "yes" : "no"}`,
    `- Missing skill cache: ${args.plan.missingSkills.length > 0 ? args.plan.missingSkills.join(", ") : "none"}`,
    "",
    "### Best next moves",
    ...renderLaunchLaneActionList(selectedActions, selectedActions.length),
  ];

  const rendered = lines.join("\n");

  args.logger?.debug?.("orchestrator-prompt-palette:rendered", {
    projectRoot: args.projectRoot,
    actionIds: selectedActions.map((action) => action.id),
    bytes: Buffer.byteLength(rendered, "utf8"),
  });

  return rendered;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export function buildPromptActionPalette(args: {
  prompt: string;
  projectRoot: string;
  pluginRoot: string;
  logger?: PromptPaletteLogger;
}): string | null {
  const plan = loadFreshInstallPlan({
    projectRoot: args.projectRoot,
    pluginRoot: args.pluginRoot,
    logger: args.logger,
  });
  if (!plan) return null;

  return renderPromptActionPalette({
    prompt: args.prompt,
    projectRoot: args.projectRoot,
    pluginRoot: args.pluginRoot,
    plan,
    logger: args.logger,
  });
}
