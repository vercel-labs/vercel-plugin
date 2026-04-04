// hooks/src/profile-next-actions.mts
import {
  buildOrchestratorRunnerCommand
} from "./orchestrator-action-command.mjs";
import { getOrchestratorActionSpecs } from "./orchestrator-action-spec.mjs";
var FAST_LANE_ACTION_IDS = [
  "bootstrap-project",
  "install-missing",
  "vercel-link",
  "vercel-env-pull",
  "vercel-deploy"
];
var PROFILE_NEXT_ACTION_PRIORITY = {
  "bootstrap-project": 100,
  "vercel-link": 95,
  "vercel-env-pull": 90,
  "install-missing": 85,
  "vercel-deploy": 70
};
var PROFILE_NEXT_ACTION_COPY = {
  "bootstrap-project": {
    title: "Bootstrap the project",
    reason: "Lay down the baseline structure now so the rest of setup stops fighting you."
  },
  "vercel-link": {
    title: "Link this repo to Vercel",
    reason: "Connect local work to the right project before you pull env or deploy anything."
  },
  "vercel-env-pull": {
    title: "Pull environment variables",
    reason: "Get local runtime state aligned before you debug auth, data, or build issues."
  },
  "install-missing": {
    title: "Install the missing pieces",
    reason: "Clear the obvious blockers first so the next few steps go through cleanly."
  },
  "vercel-deploy": {
    title: "Ship a first deploy",
    reason: "Use one clean deploy to validate the happy path end to end."
  }
};
function isFastLaneActionId(value) {
  return FAST_LANE_ACTION_IDS.includes(value);
}
function buildProfileNextActions(args) {
  const visibleSpecs = getOrchestratorActionSpecs(args.installPlan).filter(
    (spec) => spec.visible && isFastLaneActionId(spec.id)
  );
  return visibleSpecs.map((spec) => {
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
        json: false
      }),
      priority: PROFILE_NEXT_ACTION_PRIORITY[id]
    };
  }).sort(
    (left, right) => right.priority - left.priority || left.title.localeCompare(right.title)
  );
}
export {
  buildProfileNextActions
};
