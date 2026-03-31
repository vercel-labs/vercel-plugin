// hooks/src/orchestrator-install-plan.mts
function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value.trim() !== ""))].sort();
}
function formatReasonList(detection) {
  return detection.reasons.map((reason) => `${reason.kind}:${reason.source}`).join(", ");
}
function buildSkillInstallPlan(args) {
  const likelySkills = uniqueSorted(
    args.detections.map((d) => d.skill)
  );
  const installedSkills = uniqueSorted(args.installedSkills);
  const installedSet = new Set(installedSkills);
  const missingSkills = likelySkills.filter(
    (skill) => !installedSet.has(skill)
  );
  const installCommand = missingSkills.length === 0 ? null : `npx skills install ${missingSkills.join(" ")} --dir .skills`;
  return {
    schemaVersion: 1,
    createdAt: (args.now ? args.now() : /* @__PURE__ */ new Date()).toISOString(),
    projectRoot: args.projectRoot,
    likelySkills,
    installedSkills,
    missingSkills,
    bundledFallbackEnabled: args.bundledFallbackEnabled,
    zeroBundleReady: args.zeroBundleReady,
    projectSkillManifestPath: args.projectSkillManifestPath ?? null,
    detections: [...args.detections].sort(
      (a, b) => a.skill.localeCompare(b.skill)
    ),
    actions: [
      {
        id: "install-missing",
        label: "Install detected skills",
        description: missingSkills.length === 0 ? "All detected skills are already cached." : `Install ${missingSkills.length} missing skill${missingSkills.length === 1 ? "" : "s"} into .skills/.`,
        command: installCommand,
        default: !args.zeroBundleReady
      },
      {
        id: "activate-cache-only",
        label: "Use cache-only mode",
        description: args.zeroBundleReady ? "All detected skills are cached. This session can disable bundled fallback." : "Cache-only mode is blocked until the missing skills are installed.",
        command: args.zeroBundleReady ? "export VERCEL_PLUGIN_DISABLE_BUNDLED_FALLBACK=1" : null,
        default: args.zeroBundleReady
      },
      {
        id: "explain",
        label: "Explain detections",
        description: "Open the persisted install plan with full detection reasons.",
        command: "cat .skills/install-plan.json"
      }
    ]
  };
}
function serializeSkillInstallPlan(plan) {
  return JSON.stringify(plan);
}
function formatSkillInstallPalette(plan) {
  if (plan.likelySkills.length === 0) return null;
  const lines = [
    "### Vercel skill orchestrator",
    `- Detected: ${plan.likelySkills.join(", ")}`,
    `- Cached: ${plan.installedSkills.length > 0 ? plan.installedSkills.join(", ") : "none"}`,
    `- Missing: ${plan.missingSkills.length > 0 ? plan.missingSkills.join(", ") : "none"}`,
    `- Zero-bundle ready: ${plan.zeroBundleReady ? "yes" : "no"}`,
    `- Cache manifest: ${plan.projectSkillManifestPath ?? "none"}`
  ];
  const installAction = plan.actions.find(
    (action) => action.id === "install-missing"
  );
  if (installAction?.command) {
    lines.push(`- [1] Install now: ${installAction.command}`);
  }
  const cacheOnlyAction = plan.actions.find(
    (action) => action.id === "activate-cache-only"
  );
  if (cacheOnlyAction?.command) {
    lines.push(`- [2] Cache only: ${cacheOnlyAction.command}`);
  }
  lines.push("- [3] Explain: cat .skills/install-plan.json");
  if (plan.detections.length > 0) {
    lines.push("", "Detection reasons:");
    for (const detection of plan.detections) {
      lines.push(`- ${detection.skill}: ${formatReasonList(detection)}`);
    }
  }
  return lines.join("\n");
}
export {
  buildSkillInstallPlan,
  formatSkillInstallPalette,
  serializeSkillInstallPlan
};
