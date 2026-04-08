// hooks/src/session-start-launch-lane.mts
import { createLogger } from "./logger.mjs";
var log = createLogger();
function fastLaneBadge(action, index) {
  if (index === 0) return "Start here";
  if (action.priority >= 90) return "Do next";
  if (action.priority >= 80) return "Worth doing";
  return "Later";
}
function fastLaneDetail(action, index) {
  if (action.reason) return action.reason;
  if (index === 0) {
    return "This is the highest-leverage move based on the current project state.";
  }
  if (action.command) {
    return "Ready to run when you are.";
  }
  return null;
}
function renderLaunchLaneActionList(actions, limit = 3) {
  const selected = actions.slice(0, limit);
  const lines = [];
  selected.forEach((action, index) => {
    const detail = fastLaneDetail(action, index);
    lines.push(
      `- **${fastLaneBadge(action, index)}: ${action.title}**${detail ? ` \u2014 ${detail}` : ""}`
    );
    if (action.command) {
      lines.push(`  Run: \`${action.command}\``);
    }
  });
  log.debug("session-start-launch-lane:action-list-rendered", {
    actionIds: selected.map((action) => action.id),
    limit
  });
  return lines;
}
function stateBadge(state) {
  switch (state) {
    case "done":
      return "\u2713";
    case "active":
      return "\u2192";
    case "blocked":
      return "!";
    case "pending":
      return "\xB7";
  }
}
function installOutcomeLine(snapshot) {
  if (snapshot.installOutcome === "installing") {
    return `Status: installing ${snapshot.missingSkills.length} missing skill${snapshot.missingSkills.length === 1 ? "" : "s"} now`;
  }
  if (snapshot.missingSkills.length === 0) {
    return snapshot.zeroBundleReady ? "Status: cache warm \u2014 body-cache-only mode is ready" : "Status: cache warm";
  }
  if (snapshot.installOutcome === "partial") {
    return `Status: partly warm \u2014 ${snapshot.missingSkills.length} skill${snapshot.missingSkills.length === 1 ? "" : "s"} still falling back to docs/rules`;
  }
  if (snapshot.installOutcome === "failed") {
    return `Status: needs attention \u2014 ${snapshot.missingSkills.length} skill${snapshot.missingSkills.length === 1 ? "" : "s"} still missing`;
  }
  return `Status: ${snapshot.missingSkills.length} skill${snapshot.missingSkills.length === 1 ? "" : "s"} still need${snapshot.missingSkills.length === 1 ? "s" : ""} cache warmup`;
}
function buildLaunchLaneSteps(snapshot) {
  const linkState = snapshot.vercelLinked ? "done" : "active";
  const envState = snapshot.hasEnvLocal ? "done" : snapshot.vercelLinked ? "active" : "blocked";
  const cacheState = snapshot.missingSkills.length === 0 ? "done" : snapshot.installOutcome === "failed" ? "blocked" : "active";
  return [
    {
      label: "Link project",
      state: linkState,
      detail: snapshot.vercelLinked ? "Project is already linked to Vercel." : "Link once so env pull and deploy can stop failing on setup."
    },
    {
      label: "Pull env",
      state: envState,
      detail: snapshot.hasEnvLocal ? "`.env.local` is already present." : snapshot.vercelLinked ? "Ready to pull `.env.local` from the linked project." : "Blocked until the project is linked."
    },
    {
      label: "Warm skill cache",
      state: cacheState,
      detail: snapshot.missingSkills.length === 0 ? `Cached for ${snapshot.installedSkills.length} detected skill${snapshot.installedSkills.length === 1 ? "" : "s"}.` : snapshot.installOutcome === "installing" ? `Installing ${snapshot.missingSkills.join(", ")}.` : snapshot.installOutcome === "failed" ? `Still missing: ${snapshot.missingSkills.join(", ")}.` : `Needs cache entries for ${snapshot.missingSkills.join(", ")}.`
    }
  ];
}
function renderLaunchLane(snapshot) {
  if (snapshot.likelySkills.length === 0) {
    return null;
  }
  const lines = [
    "### Vercel launch lane",
    `- ${installOutcomeLine(snapshot)}`,
    `- Skills in play: ${snapshot.likelySkills.join(", ")}`,
    `- Cached now: ${snapshot.installedSkills.length > 0 ? snapshot.installedSkills.join(", ") : "none"}`
  ];
  if (snapshot.missingSkills.length > 0) {
    lines.push(`- Still missing: ${snapshot.missingSkills.join(", ")}`);
  }
  lines.push("", "### Progress");
  for (const step of buildLaunchLaneSteps(snapshot)) {
    lines.push(
      `- [${stateBadge(step.state)}] ${step.label} \u2014 ${step.detail}`
    );
  }
  if (snapshot.installGroups.length > 1) {
    lines.push("", "### Install groups");
    for (const group of snapshot.installGroups) {
      lines.push(`- ${group.registry}: ${group.requestedSkills.join(", ")}`);
    }
  }
  const topActions = snapshot.nextActions.slice(0, 3);
  if (topActions.length > 0) {
    lines.push("", "### Next moves", ...renderLaunchLaneActionList(topActions, 3));
  }
  return lines.join("\n");
}
function renderLaunchLaneGroupEvent(event) {
  if (event.kind === "group-start") {
    return [
      "### Vercel launch lane",
      `- Installing group ${event.index}/${event.total}: ${event.registry}`,
      `- Queue: ${event.requestedSkills.join(", ")}`
    ];
  }
  return [
    "### Vercel launch lane",
    `- Finished group ${event.index}/${event.total}: ${event.registry}`,
    `- Installed: ${(event.installed ?? []).length > 0 ? event.installed.join(", ") : "none"}`,
    `- Already cached: ${(event.reused ?? []).length > 0 ? event.reused.join(", ") : "none"}`,
    `- Remaining in group: ${(event.missing ?? []).length > 0 ? event.missing.join(", ") : "none"}`
  ];
}
export {
  buildLaunchLaneSteps,
  renderLaunchLane,
  renderLaunchLaneActionList,
  renderLaunchLaneGroupEvent
};
