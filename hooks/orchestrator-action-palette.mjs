// hooks/src/orchestrator-action-palette.mts
import {
  buildOrchestratorRunnerCommand
} from "./orchestrator-action-command.mjs";
import { getOrchestratorActionSpecs } from "./orchestrator-action-spec.mjs";
function buildActionCommand(args) {
  return buildOrchestratorRunnerCommand({
    pluginRoot: args.pluginRoot,
    projectRoot: args.projectRoot,
    actionId: args.actionId,
    json: args.json
  });
}
function formatOrchestratorActionPalette(args) {
  const specs = getOrchestratorActionSpecs(args.plan).filter(
    (entry) => entry.discoverable
  );
  if (specs.length === 0) {
    return null;
  }
  const runnable = specs.filter((entry) => entry.runnable);
  const blocked = specs.filter((entry) => !entry.runnable);
  const lines = [
    "### Vercel wrapper palette",
    "- These commands run the real `npx skills` / `vercel` CLIs and print a readable wrapper summary."
  ];
  if (runnable.length > 0) {
    lines.push("", "Run now:");
    for (const [index, entry] of runnable.entries()) {
      const human = buildActionCommand({
        pluginRoot: args.pluginRoot,
        projectRoot: args.plan.projectRoot,
        actionId: entry.id,
        json: false
      });
      const json = buildActionCommand({
        pluginRoot: args.pluginRoot,
        projectRoot: args.plan.projectRoot,
        actionId: entry.id,
        json: true
      });
      lines.push(`- [${index + 1}] ${entry.label}: \`${human}\``);
      lines.push(`  JSON: \`${json}\``);
      lines.push(`  ${entry.description}`);
    }
  }
  if (blocked.length > 0) {
    const bootstrapVisibleAndRunnable = runnable.some(
      (entry) => entry.id === "bootstrap-project"
    );
    const bootstrapCommand = bootstrapVisibleAndRunnable ? buildActionCommand({
      pluginRoot: args.pluginRoot,
      projectRoot: args.plan.projectRoot,
      actionId: "bootstrap-project",
      json: false
    }) : null;
    lines.push("", "Unlock next:");
    for (const entry of blocked) {
      lines.push(
        `- ${entry.label}: ${entry.blockedReason ?? "Blocked by current project state."}`
      );
      if (bootstrapCommand && entry.id !== "bootstrap-project") {
        lines.push(`  Use: \`${bootstrapCommand}\``);
      }
    }
  }
  return lines.join("\n");
}
export {
  formatOrchestratorActionPalette
};
