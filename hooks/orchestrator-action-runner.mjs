// hooks/src/orchestrator-action-runner.mts
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  createRegistryClient
} from "./registry-client.mjs";
import {
  createVercelCliDelegator
} from "./vercel-cli-delegator.mjs";
import { pluginRoot, safeReadJson } from "./hook-env.mjs";
import { loadProjectInstalledSkillState } from "./project-installed-skill-state.mjs";
import {
  buildSkillInstallPlan
} from "./orchestrator-install-plan.mjs";
function installPlanPath(projectRoot) {
  return join(projectRoot, ".skills", "install-plan.json");
}
function readPersistedPlan(projectRoot) {
  const plan = safeReadJson(installPlanPath(projectRoot));
  if (!plan) {
    throw new Error(
      `Missing install plan at ${installPlanPath(projectRoot)}. Run SessionStart first.`
    );
  }
  return plan;
}
function writePersistedPlan(plan) {
  mkdirSync(join(plan.projectRoot, ".skills"), { recursive: true });
  writeFileSync(
    installPlanPath(plan.projectRoot),
    JSON.stringify(plan, null, 2) + "\n",
    "utf-8"
  );
}
function refreshPlan(previous) {
  const bundledFallbackEnabled = process.env.VERCEL_PLUGIN_DISABLE_BUNDLED_FALLBACK !== "1" && previous.bundledFallbackEnabled;
  const installedState = loadProjectInstalledSkillState({
    projectRoot: previous.projectRoot,
    pluginRoot: pluginRoot(),
    likelySkills: previous.likelySkills,
    bundledFallbackEnabled
  });
  const refreshed = buildSkillInstallPlan({
    projectRoot: previous.projectRoot,
    detections: previous.detections,
    installedSkills: installedState.installedSkills,
    bundledFallbackEnabled,
    zeroBundleReady: installedState.cacheStatus.zeroBundleReady,
    projectSkillManifestPath: installedState.projectState.projectSkillStatePath,
    vercelLinked: existsSync(join(previous.projectRoot, ".vercel")),
    hasEnvLocal: existsSync(join(previous.projectRoot, ".env.local"))
  });
  writePersistedPlan(refreshed);
  return refreshed;
}
async function runOrchestratorAction(args) {
  let plan = readPersistedPlan(args.projectRoot);
  const registryClient = args.registryClient ?? createRegistryClient();
  const vercelDelegator = args.vercelDelegator ?? createVercelCliDelegator();
  const state = { commands: [], vercelResults: [], installResult: null };
  async function runVercel(subcommand) {
    const result = await vercelDelegator.run({
      projectRoot: args.projectRoot,
      subcommand
    });
    state.vercelResults.push(result);
    state.commands.push(result.command);
    return result;
  }
  async function runInstallMissing() {
    plan = refreshPlan(plan);
    if (plan.missingSkills.length === 0) {
      return null;
    }
    const result = await registryClient.installSkills({
      projectRoot: args.projectRoot,
      skillNames: plan.missingSkills
    });
    state.installResult = result;
    if (result.command) {
      state.commands.push(result.command);
    }
    return result;
  }
  switch (args.actionId) {
    case "bootstrap-project": {
      if (!existsSync(join(args.projectRoot, ".vercel"))) {
        await runVercel("link");
      }
      if (existsSync(join(args.projectRoot, ".vercel")) && !existsSync(join(args.projectRoot, ".env.local"))) {
        await runVercel("env-pull");
      }
      await runInstallMissing();
      break;
    }
    case "install-missing":
      await runInstallMissing();
      break;
    case "vercel-link":
      await runVercel("link");
      break;
    case "vercel-env-pull":
      await runVercel("env-pull");
      break;
    case "vercel-deploy":
      await runVercel("deploy");
      break;
  }
  const refreshedPlan = refreshPlan(plan);
  const ok = state.vercelResults.every((result) => result.ok) && (state.installResult ? state.installResult.missing.length === 0 : true);
  return {
    schemaVersion: 1,
    type: "vercel-plugin-orchestrator-action-result",
    ok,
    actionId: args.actionId,
    projectRoot: args.projectRoot,
    commands: state.commands,
    installResult: state.installResult,
    vercelResults: state.vercelResults,
    refreshedPlan
  };
}
function getRequiredArg(flag) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return value;
}
async function main() {
  const projectRoot = getRequiredArg("--project-root");
  const actionId = getRequiredArg(
    "--action"
  );
  const result = await runOrchestratorAction({ projectRoot, actionId });
  const wantJson = process.argv.includes("--json");
  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    [
      `ok=${result.ok}`,
      `action=${result.actionId}`,
      ...result.commands.map((command) => `command=${command}`),
      `missing=${result.refreshedPlan.missingSkills.join(",")}`
    ].join("\n") + "\n"
  );
}
var isEntrypoint = process.argv[1]?.endsWith("/orchestrator-action-runner.mjs") ?? false;
if (isEntrypoint) {
  await main();
}
export {
  runOrchestratorAction
};
