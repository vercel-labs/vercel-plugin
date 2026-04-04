/**
 * Profile Next Actions — shared builder for Fast Lane cache entries.
 *
 * Derives Fast Lane entries from `getOrchestratorActionSpecs(installPlan)`,
 * keeps only visible Fast Lane action IDs, applies authored copy and fixed
 * priorities, and emits `buildOrchestratorRunnerCommand(...)` for the
 * bootstrap action.
 */

import type { SkillInstallPlan } from "./orchestrator-install-plan.mjs";
import {
  buildOrchestratorRunnerCommand,
  type OrchestratorRunnerActionId,
} from "./orchestrator-action-command.mjs";
import { getOrchestratorActionSpecs } from "./orchestrator-action-spec.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileNextAction {
  id: OrchestratorRunnerActionId;
  title: string;
  reason: string;
  command: string | null;
  priority: number;
}

// ---------------------------------------------------------------------------
// Authored copy and priority
// ---------------------------------------------------------------------------

const FAST_LANE_ACTION_IDS: readonly OrchestratorRunnerActionId[] = [
  "bootstrap-project",
  "install-missing",
  "vercel-link",
  "vercel-env-pull",
  "vercel-deploy",
];

const PROFILE_NEXT_ACTION_PRIORITY: Record<OrchestratorRunnerActionId, number> =
  {
    "bootstrap-project": 100,
    "vercel-link": 95,
    "vercel-env-pull": 90,
    "install-missing": 85,
    "vercel-deploy": 70,
  };

const PROFILE_NEXT_ACTION_COPY: Record<
  OrchestratorRunnerActionId,
  { title: string; reason: string }
> = {
  "bootstrap-project": {
    title: "Bootstrap the project",
    reason:
      "Lay down the baseline structure now so the rest of setup stops fighting you.",
  },
  "vercel-link": {
    title: "Link this repo to Vercel",
    reason:
      "Connect local work to the right project before you pull env or deploy anything.",
  },
  "vercel-env-pull": {
    title: "Pull environment variables",
    reason:
      "Get local runtime state aligned before you debug auth, data, or build issues.",
  },
  "install-missing": {
    title: "Install the missing pieces",
    reason:
      "Clear the obvious blockers first so the next few steps go through cleanly.",
  },
  "vercel-deploy": {
    title: "Ship a first deploy",
    reason: "Use one clean deploy to validate the happy path end to end.",
  },
};

function isFastLaneActionId(
  value: string,
): value is OrchestratorRunnerActionId {
  return (FAST_LANE_ACTION_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildProfileNextActions(args: {
  pluginRoot: string;
  projectRoot: string;
  installPlan: SkillInstallPlan;
}): ProfileNextAction[] {
  const visibleSpecs = getOrchestratorActionSpecs(args.installPlan).filter(
    (spec) => spec.visible && isFastLaneActionId(spec.id),
  );

  return visibleSpecs
    .map((spec) => {
      const id = spec.id;
      const copy = PROFILE_NEXT_ACTION_COPY[id];
      return {
        id,
        title: copy.title || spec.label,
        reason: copy.reason || spec.description,
        command: buildOrchestratorRunnerCommand({
          pluginRoot: args.pluginRoot,
          projectRoot: args.projectRoot,
          actionId: id,
          json: false,
        }),
        priority: PROFILE_NEXT_ACTION_PRIORITY[id],
      };
    })
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.title.localeCompare(right.title),
    );
}
