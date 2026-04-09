/**
 * Tests for the unified launch-lane renderer.
 */

import { describe, expect, test } from "bun:test";
import type { ProfileNextAction } from "./profile-next-actions.mjs";
import {
  buildLaunchLaneSteps,
  renderLaunchLane,
  renderLaunchLaneActionList,
  renderLaunchLaneGroupEvent,
  type LaunchLaneSnapshot,
} from "./session-start-launch-lane.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTIONS: ProfileNextAction[] = [
  {
    id: "bootstrap-project",
    title: "Bootstrap the project",
    reason:
      "Lay down the baseline structure now so the rest of setup stops fighting you.",
    command:
      "node /plugin/hooks/orchestrator-action-runner.mjs --project-root /repo --action bootstrap-project",
    priority: 100,
  },
  {
    id: "install-missing",
    title: "Install the missing pieces",
    reason:
      "Clear the obvious blockers first so the next few steps go through cleanly.",
    command:
      "node /plugin/hooks/orchestrator-action-runner.mjs --project-root /repo --action install-missing",
    priority: 85,
  },
];

function makeSnapshot(
  overrides: Partial<LaunchLaneSnapshot> = {},
): LaunchLaneSnapshot {
  return {
    likelySkills: ["ai-sdk", "deployments-cicd"],
    installedSkills: ["ai-sdk"],
    missingSkills: ["deployments-cicd"],
    vercelLinked: false,
    hasEnvLocal: false,
    zeroBundleReady: false,
    installOutcome: "idle",
    nextActions: ACTIONS,
    installGroups: [
      {
        registry: "vercel-labs/agent-skills",
        requestedSkills: ["deployments-cicd"],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderLaunchLane
// ---------------------------------------------------------------------------

describe("renderLaunchLane", () => {
  test("returns null when no likely skills", () => {
    const result = renderLaunchLane(makeSnapshot({ likelySkills: [] }));
    expect(result).toBeNull();
  });

  test("renders the expected output for the spec example", () => {
    const result = renderLaunchLane(makeSnapshot());
    expect(result).not.toBeNull();
    expect(result).toContain("### Vercel launch lane");
    expect(result).toContain("Skills in play: ai-sdk, deployments-cicd");
    expect(result).toContain("Cached now: ai-sdk");
    expect(result).toContain("Still missing: deployments-cicd");
    expect(result).toContain("### Progress");
    expect(result).toContain("### Next moves");
    expect(result).toContain("**Start here: Bootstrap the project**");
    expect(result).toContain("**Worth doing: Install the missing pieces**");
  });

  test("omits Still missing when cache is warm", () => {
    const result = renderLaunchLane(
      makeSnapshot({ missingSkills: [], installOutcome: "ready" }),
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("Still missing");
    expect(result).toContain("cache warm");
  });

  test("shows zero-bundle-ready status", () => {
    const result = renderLaunchLane(
      makeSnapshot({
        missingSkills: [],
        installOutcome: "ready",
        zeroBundleReady: true,
      }),
    );
    expect(result).toContain("body-cache-only mode is ready");
  });

  test("shows partial install outcome", () => {
    const result = renderLaunchLane(
      makeSnapshot({ installOutcome: "partial" }),
    );
    expect(result).toContain("partly warm");
  });

  test("shows failed install outcome", () => {
    const result = renderLaunchLane(
      makeSnapshot({ installOutcome: "failed" }),
    );
    expect(result).toContain("needs attention");
  });

  test("shows installing status", () => {
    const result = renderLaunchLane(
      makeSnapshot({ installOutcome: "installing" }),
    );
    expect(result).toContain("installing 1 missing skill now");
  });

  test("omits install groups section when only one group", () => {
    const result = renderLaunchLane(makeSnapshot());
    expect(result).not.toContain("### Install groups");
  });

  test("shows install groups when more than one", () => {
    const result = renderLaunchLane(
      makeSnapshot({
        installGroups: [
          { registry: "vercel/vercel-skills", requestedSkills: ["ai-sdk"] },
          {
            registry: "vercel-labs/agent-skills",
            requestedSkills: ["deployments-cicd"],
          },
        ],
      }),
    );
    expect(result).toContain("### Install groups");
    expect(result).toContain("vercel/vercel-skills: ai-sdk");
    expect(result).toContain("vercel-labs/agent-skills: deployments-cicd");
  });

  test("omits next moves when no actions", () => {
    const result = renderLaunchLane(makeSnapshot({ nextActions: [] }));
    expect(result).not.toContain("### Next moves");
  });

  test("limits next moves to 3", () => {
    const manyActions: ProfileNextAction[] = [
      { ...ACTIONS[0], id: "a", priority: 100 },
      { ...ACTIONS[0], id: "b", priority: 95 },
      { ...ACTIONS[0], id: "c", priority: 90 },
      { ...ACTIONS[0], id: "d", priority: 80 },
    ];
    const result = renderLaunchLane(
      makeSnapshot({ nextActions: manyActions }),
    )!;
    const moveMatches = result.match(/\*\*Start here:|Do next:|Worth doing:|Later:/g);
    expect(moveMatches).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// renderLaunchLaneActionList (shared helper)
// ---------------------------------------------------------------------------

describe("renderLaunchLaneActionList", () => {
  test("renders badge text, detail copy, and Run: lines", () => {
    const lines = renderLaunchLaneActionList(ACTIONS);
    expect(lines).toContain(
      "- **Start here: Bootstrap the project** \u2014 Lay down the baseline structure now so the rest of setup stops fighting you.",
    );
    expect(lines).toContain(
      `  Run: \`${ACTIONS[0].command}\``,
    );
    expect(lines).toContain(
      "- **Worth doing: Install the missing pieces** \u2014 Clear the obvious blockers first so the next few steps go through cleanly.",
    );
    expect(lines).toContain(
      `  Run: \`${ACTIONS[1].command}\``,
    );
  });

  test("limits to the specified number of actions", () => {
    const fourActions: ProfileNextAction[] = [
      { ...ACTIONS[0], id: "bootstrap-project", priority: 100 },
      { ...ACTIONS[0], id: "vercel-link", priority: 95, title: "Link repo" },
      { ...ACTIONS[0], id: "vercel-env-pull", priority: 90, title: "Pull env" },
      { ...ACTIONS[0], id: "vercel-deploy", priority: 70, title: "Deploy" },
    ];
    const lines = renderLaunchLaneActionList(fourActions, 2);
    const badges = lines.filter((l) => l.startsWith("- **"));
    expect(badges).toHaveLength(2);
  });

  test("defaults limit to 3", () => {
    const fourActions: ProfileNextAction[] = [
      { ...ACTIONS[0], id: "bootstrap-project", priority: 100 },
      { ...ACTIONS[0], id: "vercel-link", priority: 95, title: "Link repo" },
      { ...ACTIONS[0], id: "vercel-env-pull", priority: 90, title: "Pull env" },
      { ...ACTIONS[0], id: "vercel-deploy", priority: 70, title: "Deploy" },
    ];
    const lines = renderLaunchLaneActionList(fourActions);
    const badges = lines.filter((l) => l.startsWith("- **"));
    expect(badges).toHaveLength(3);
  });

  test("returns empty array for empty actions", () => {
    const lines = renderLaunchLaneActionList([]);
    expect(lines).toEqual([]);
  });

  test("omits Run: line when action has no command", () => {
    const noCmd: ProfileNextAction[] = [
      { id: "bootstrap-project", title: "Do something", reason: "Why not", command: null, priority: 100 },
    ];
    const lines = renderLaunchLaneActionList(noCmd);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("**Start here: Do something**");
    expect(lines.some((l) => l.includes("Run:"))).toBe(false);
  });

  test("produces identical output to renderLaunchLane next-moves section", () => {
    const snapshot = makeSnapshot();
    const fullOutput = renderLaunchLane(snapshot)!;
    const nextMovesStart = fullOutput.indexOf("### Next moves\n") + "### Next moves\n".length;
    const nextMovesSection = fullOutput.slice(nextMovesStart);
    const helperOutput = renderLaunchLaneActionList(snapshot.nextActions.slice(0, 3), 3).join("\n");
    expect(nextMovesSection).toBe(helperOutput);
  });
});

// ---------------------------------------------------------------------------
// buildLaunchLaneSteps
// ---------------------------------------------------------------------------

describe("buildLaunchLaneSteps", () => {
  test("link done, env active when linked but no env", () => {
    const steps = buildLaunchLaneSteps(
      makeSnapshot({ vercelLinked: true, hasEnvLocal: false }),
    );
    expect(steps[0].state).toBe("done");
    expect(steps[1].state).toBe("active");
  });

  test("env blocked when not linked", () => {
    const steps = buildLaunchLaneSteps(
      makeSnapshot({ vercelLinked: false, hasEnvLocal: false }),
    );
    expect(steps[0].state).toBe("active");
    expect(steps[1].state).toBe("blocked");
  });

  test("all done when everything is ready", () => {
    const steps = buildLaunchLaneSteps(
      makeSnapshot({
        vercelLinked: true,
        hasEnvLocal: true,
        missingSkills: [],
        installOutcome: "ready",
      }),
    );
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  test("cache blocked when install failed", () => {
    const steps = buildLaunchLaneSteps(
      makeSnapshot({ installOutcome: "failed" }),
    );
    expect(steps[2].state).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// renderLaunchLaneGroupEvent
// ---------------------------------------------------------------------------

describe("renderLaunchLaneGroupEvent", () => {
  test("renders group-start", () => {
    const lines = renderLaunchLaneGroupEvent({
      kind: "group-start",
      index: 1,
      total: 2,
      registry: "vercel/vercel-skills",
      requestedSkills: ["ai-sdk"],
    });
    expect(lines).toContain(
      "- Installing group 1/2: vercel/vercel-skills",
    );
    expect(lines).toContain("- Queue: ai-sdk");
  });

  test("renders group-result", () => {
    const lines = renderLaunchLaneGroupEvent({
      kind: "group-result",
      index: 2,
      total: 2,
      registry: "vercel-labs/agent-skills",
      requestedSkills: ["deployments-cicd"],
      installed: ["deployments-cicd"],
      reused: [],
      missing: [],
    });
    expect(lines).toContain(
      "- Finished group 2/2: vercel-labs/agent-skills",
    );
    expect(lines).toContain("- Installed: deployments-cicd");
    expect(lines).toContain("- Already cached: none");
    expect(lines).toContain("- Remaining in group: none");
  });
});

// ---------------------------------------------------------------------------
// Presentation-contract: launch lane is the sole SessionStart action surface
// ---------------------------------------------------------------------------

describe("presentation contract", () => {
  test("launch lane uses ### heading, not ## (avoids colliding with engine context)", () => {
    const result = renderLaunchLane(makeSnapshot())!;
    expect(result).toContain("### Vercel launch lane");
    expect(result).not.toContain("## Fast Lane");
    // Ensure no bare ## heading (### is fine — regex anchors on line start)
    expect(result).not.toMatch(/^## Vercel launch lane/m);
  });

  test("launch lane output contains no duplicate headings", () => {
    const result = renderLaunchLane(makeSnapshot())!;
    const headingMatches = result.match(/### Vercel launch lane/g);
    expect(headingMatches).toHaveLength(1);
  });
});
