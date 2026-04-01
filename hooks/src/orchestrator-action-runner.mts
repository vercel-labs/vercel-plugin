/**
 * Orchestrator Action Runner — explicit-only execution layer.
 *
 * Reads the persisted install-plan.json from the hashed home-state root
 * (~/.vercel-plugin/projects/<hash>/.skills/install-plan.json), delegates
 * to the existing registry-client (npx skills) and vercel-cli-delegator
 * adapters, then refreshes the plan from on-disk state.
 *
 * Not auto-invoked from any hook path — called explicitly via CLI
 * or agent Bash execution.
 */

import {
  createRegistryClient,
  type InstallSkillsResult,
  type RegistryClient,
} from "./registry-client.mjs";
import {
  createVercelCliDelegator,
  type VercelCliDelegator,
  type VercelCliRunResult,
} from "./vercel-cli-delegator.mjs";
import type { SkillInstallPlan } from "./orchestrator-install-plan.mjs";
import {
  requirePersistedSkillInstallPlan,
  refreshPersistedSkillInstallPlan,
} from "./orchestrator-install-plan-state.mjs";
import { pluginRoot } from "./hook-env.mjs";
import {
  buildOrchestratorRunnerCommand,
  ORCHESTRATOR_ACTION_IDS,
  type OrchestratorRunnerActionId,
} from "./orchestrator-action-command.mjs";
import {
  getOrchestratorActionSpec,
  getOrchestratorActionSpecs,
  type OrchestratorStepSpec,
} from "./orchestrator-action-spec.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestratorUnmetPostcondition =
  | "vercel-link"
  | "vercel-env-pull"
  | "install-missing";

export interface OrchestratorActionRunResult {
  schemaVersion: 1;
  type: "vercel-plugin-orchestrator-action-result";
  ok: boolean;
  actionId: OrchestratorRunnerActionId;
  projectRoot: string;
  commands: string[];
  installResult: InstallSkillsResult | null;
  vercelResults: VercelCliRunResult[];
  unmetPostconditions: OrchestratorUnmetPostcondition[];
  refreshedPlan: SkillInstallPlan;
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export type OrchestratorActionRunErrorCode =
  | "MISSING_INSTALL_PLAN"
  | "INVALID_ACTION"
  | "ACTION_BLOCKED"
  | "RUNNER_ERROR";

export interface OrchestratorActionRunError {
  schemaVersion: 1;
  type: "vercel-plugin-orchestrator-action-error";
  ok: false;
  code: OrchestratorActionRunErrorCode;
  message: string;
  hint: string | null;
  actionId: OrchestratorRunnerActionId | null;
  projectRoot: string | null;
}

function classifyOrchestratorActionError(
  error: unknown,
): OrchestratorActionRunErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Missing install plan")) {
    return "MISSING_INSTALL_PLAN";
  }
  if (message.includes("Invalid --action")) {
    return "INVALID_ACTION";
  }
  if (message.includes("Blocked action")) {
    return "ACTION_BLOCKED";
  }
  return "RUNNER_ERROR";
}

function blockedActionHint(
  actionId: OrchestratorRunnerActionId | null,
): string {
  switch (actionId) {
    case "vercel-env-pull":
      return "Run `bootstrap-project` or `vercel-link` first, then retry `vercel-env-pull`.";
    case "vercel-deploy":
      return "Run `bootstrap-project` or `vercel-link` first, then retry `vercel-deploy`.";
    default:
      return "Run `bootstrap-project` to satisfy prerequisites, then retry this wrapper action.";
  }
}

export function buildOrchestratorActionError(args: {
  error: unknown;
  actionId: OrchestratorRunnerActionId | null;
  projectRoot: string | null;
}): OrchestratorActionRunError {
  const message =
    args.error instanceof Error ? args.error.message : String(args.error);
  const code = classifyOrchestratorActionError(args.error);
  return {
    schemaVersion: 1,
    type: "vercel-plugin-orchestrator-action-error",
    ok: false,
    code,
    message,
    hint:
      code === "MISSING_INSTALL_PLAN"
        ? "Run SessionStart first so the install plan exists before calling the wrapper."
        : code === "INVALID_ACTION"
          ? `Use one of: ${ORCHESTRATOR_ACTION_IDS.join(", ")}`
          : code === "ACTION_BLOCKED"
            ? blockedActionHint(args.actionId)
            : "Inspect the delegated CLI output, fix the failing step, then rerun this wrapper action.",
    actionId: args.actionId,
    projectRoot: args.projectRoot,
  };
}

// ---------------------------------------------------------------------------
// Postcondition helpers
// ---------------------------------------------------------------------------

function collectUnmetPostconditions(args: {
  refreshedPlan: SkillInstallPlan;
  vercelResults: VercelCliRunResult[];
  installResult: InstallSkillsResult | null;
}): OrchestratorUnmetPostcondition[] {
  const unmet: OrchestratorUnmetPostcondition[] = [];
  const attempted = new Set(
    args.vercelResults.map((entry) => entry.subcommand),
  );
  if (attempted.has("link") && !args.refreshedPlan.vercelLinked) {
    unmet.push("vercel-link");
  }
  if (attempted.has("env-pull") && !args.refreshedPlan.hasEnvLocal) {
    unmet.push("vercel-env-pull");
  }
  if (
    args.installResult !== null &&
    args.refreshedPlan.missingSkills.length > 0
  ) {
    unmet.push("install-missing");
  }
  return unmet;
}

// ---------------------------------------------------------------------------
// Human output formatters
// ---------------------------------------------------------------------------

function deriveHumanStatus(result: OrchestratorActionRunResult): string {
  if (result.ok) return "success";
  const hasPartialProgress =
    result.vercelResults.some((entry) => entry.ok) ||
    (result.installResult
      ? result.installResult.installed.length > 0 ||
        result.installResult.reused.length > 0
      : false);
  return hasPartialProgress ? "partial" : "failed";
}

function formatVercelResultLine(result: VercelCliRunResult): string {
  if (result.ok) {
    return `- ${result.subcommand}: ok (\`${result.command}\`)`;
  }
  const detail = result.stderr.trim() || "delegated CLI failed";
  return `- ${result.subcommand}: failed (\`${result.command}\`) — ${detail}`;
}

/** Bootstrap progression order for next-step suggestions. */
const NEXT_STEP_ORDER: readonly OrchestratorRunnerActionId[] = [
  "vercel-link",
  "vercel-env-pull",
  "install-missing",
  "vercel-deploy",
];

function formatNextStep(args: {
  plan: SkillInstallPlan;
  currentActionId: OrchestratorRunnerActionId;
}): string {
  // Find the next action following bootstrap progression order (link →
  // env-pull → install-missing → deploy) so users who run individual steps
  // see the logical continuation. Skip the composite bootstrap-project and
  // the action that was just run.
  const specMap = new Map(
    getOrchestratorActionSpecs(args.plan).map((entry) => [entry.id, entry]),
  );
  const next = NEXT_STEP_ORDER.map((id) => specMap.get(id))
    .filter(
      (entry): entry is NonNullable<typeof entry> =>
        entry != null &&
        entry.visible &&
        entry.runnable &&
        entry.id !== args.currentActionId,
    )[0];

  if (next) {
    const command = buildOrchestratorRunnerCommand({
      pluginRoot: pluginRoot(),
      projectRoot: args.plan.projectRoot,
      actionId: next.id,
      json: false,
    });
    return `Run \`${next.id}\` next: \`${command}\``;
  }

  if (args.plan.zeroBundleReady) {
    return "Project cache is ready; cache-only mode can be enabled if desired.";
  }
  return "Wrapper action completed.";
}

export function formatOrchestratorActionHumanOutput(
  result: OrchestratorActionRunResult,
): string {
  const lines: string[] = [
    "### Vercel wrapper result",
    `- Status: ${deriveHumanStatus(result)}`,
    `- Action: ${result.actionId}`,
    `- Linked: ${result.refreshedPlan.vercelLinked ? "yes" : "no"}`,
    `- .env.local: ${result.refreshedPlan.hasEnvLocal ? "present" : "missing"}`,
    `- Missing skills: ${
      result.refreshedPlan.missingSkills.length > 0
        ? result.refreshedPlan.missingSkills.join(", ")
        : "none"
    }`,
  ];

  if (result.unmetPostconditions.length > 0) {
    lines.push(`- Unmet: ${result.unmetPostconditions.join(", ")}`);
  }

  if (result.commands.length > 0) {
    lines.push(`- Commands run: ${result.commands.length}`);
  }

  for (const entry of result.vercelResults) {
    lines.push(formatVercelResultLine(entry));
  }

  if (result.installResult?.installed.length) {
    lines.push(
      `- Installed now: ${result.installResult.installed.join(", ")}`,
    );
  }
  if (result.installResult?.reused.length) {
    lines.push(
      `- Already cached: ${result.installResult.reused.join(", ")}`,
    );
  }
  if (result.installResult?.missing.length) {
    lines.push(
      `- Still missing: ${result.installResult.missing.join(", ")}`,
    );
  }

  lines.push(
    `- Next: ${formatNextStep({ plan: result.refreshedPlan, currentActionId: result.actionId })}`,
  );

  return lines.join("\n");
}

export function formatOrchestratorActionErrorHumanOutput(
  error: OrchestratorActionRunError,
): string {
  return [
    "### Vercel wrapper result",
    "- Status: failed",
    error.actionId ? `- Action: ${error.actionId}` : null,
    error.projectRoot ? `- Project: ${error.projectRoot}` : null,
    `- Error: ${error.message}`,
    error.hint ? `- Next: ${error.hint}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runOrchestratorAction(args: {
  projectRoot: string;
  actionId: OrchestratorRunnerActionId;
  registryClient?: RegistryClient;
  vercelDelegator?: VercelCliDelegator;
}): Promise<OrchestratorActionRunResult> {
  let plan = requirePersistedSkillInstallPlan({
    projectRoot: args.projectRoot,
  });

  // Always re-read the filesystem before deciding whether the action is runnable.
  plan = refreshPersistedSkillInstallPlan({
    projectRoot: args.projectRoot,
    previousPlan: plan,
  });

  const spec = getOrchestratorActionSpec(plan, args.actionId);

  if (!spec.runnable) {
    throw new Error(
      `Blocked action ${args.actionId}: ${spec.blockedReason ?? "Action prerequisites are not met."}`,
    );
  }

  const registryClient = args.registryClient ?? createRegistryClient();
  const vercelDelegator = args.vercelDelegator ?? createVercelCliDelegator();

  const state: {
    commands: string[];
    vercelResults: VercelCliRunResult[];
    installResult: InstallSkillsResult | null;
  } = { commands: [], vercelResults: [], installResult: null };

  async function refreshPlan(): Promise<SkillInstallPlan> {
    plan = refreshPersistedSkillInstallPlan({
      projectRoot: args.projectRoot,
      previousPlan: plan,
    });
    return plan;
  }

  async function runVercel(subcommand: "link" | "env-pull" | "deploy") {
    const result = await vercelDelegator.run({
      projectRoot: args.projectRoot,
      subcommand,
    });
    state.vercelResults.push(result);
    state.commands.push(result.command);
    return result;
  }

  async function runInstallMissing() {
    await refreshPlan();
    if (plan.missingSkills.length === 0) {
      return null;
    }
    const result = await registryClient.installSkills({
      projectRoot: args.projectRoot,
      skillNames: plan.missingSkills,
    });
    state.installResult = result;
    if (result.command) {
      state.commands.push(result.command);
    }
    return result;
  }

  async function runStep(stepSpec: OrchestratorStepSpec): Promise<void> {
    await refreshPlan();
    switch (stepSpec.step) {
      case "vercel-link":
        if (stepSpec.mode === "if-needed" && plan.vercelLinked) return;
        await runVercel("link");
        return;
      case "vercel-env-pull":
        if (
          stepSpec.mode === "if-needed" &&
          (!plan.vercelLinked || plan.hasEnvLocal)
        ) {
          return;
        }
        await runVercel("env-pull");
        return;
      case "install-missing":
        await runInstallMissing();
        return;
      case "vercel-deploy":
        if (stepSpec.mode === "if-needed" && !plan.vercelLinked) return;
        await runVercel("deploy");
        return;
    }
  }

  for (const step of spec.steps) {
    await runStep(step);
  }

  const refreshedPlan = await refreshPlan();

  const unmetPostconditions = collectUnmetPostconditions({
    refreshedPlan,
    vercelResults: state.vercelResults,
    installResult: state.installResult,
  });

  const ok =
    state.vercelResults.every((result) => result.ok) &&
    (state.installResult ? state.installResult.missing.length === 0 : true) &&
    unmetPostconditions.length === 0;

  return {
    schemaVersion: 1,
    type: "vercel-plugin-orchestrator-action-result",
    ok,
    actionId: args.actionId,
    projectRoot: args.projectRoot,
    commands: state.commands,
    installResult: state.installResult,
    vercelResults: state.vercelResults,
    unmetPostconditions,
    refreshedPlan,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

function getOptionalArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function getRequiredArg(flag: string): string {
  const value = getOptionalArg(flag);
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return value;
}

function isOrchestratorActionId(
  value: string,
): value is OrchestratorRunnerActionId {
  return ORCHESTRATOR_ACTION_IDS.includes(
    value as OrchestratorRunnerActionId,
  );
}

async function main(): Promise<void> {
  const projectRoot = getRequiredArg("--project-root");
  const rawAction = getRequiredArg("--action");
  if (!isOrchestratorActionId(rawAction)) {
    throw new Error(`Invalid --action: ${rawAction}`);
  }

  const result = await runOrchestratorAction({ projectRoot, actionId: rawAction });

  const wantJson = process.argv.includes("--json");
  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  process.stdout.write(formatOrchestratorActionHumanOutput(result) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}

const isEntrypoint =
  process.argv[1]?.endsWith("/orchestrator-action-runner.mjs") ?? false;

if (isEntrypoint) {
  const wantJson = process.argv.includes("--json");
  const projectRoot = getOptionalArg("--project-root");
  const rawAction = getOptionalArg("--action");
  const actionId =
    rawAction && isOrchestratorActionId(rawAction) ? rawAction : null;

  await main().catch((error: unknown) => {
    const formatted = buildOrchestratorActionError({
      error,
      actionId,
      projectRoot,
    });
    if (wantJson) {
      process.stdout.write(JSON.stringify(formatted, null, 2) + "\n");
    } else {
      process.stderr.write(
        formatOrchestratorActionErrorHumanOutput(formatted) + "\n",
      );
    }
    process.exitCode = 1;
  });
}
