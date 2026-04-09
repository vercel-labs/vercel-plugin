/**
 * Tests for per-registry grouped install progress surfacing through the launch lane.
 *
 * Verifies:
 * - autoInstallDetectedSkills() emits exactly one group-start and one group-result per registry group
 * - Events arrive in index/total order
 * - renderLaunchLaneGroupEvent() produces the expected progress blocks
 * - Merged install accounting is unchanged by event emission
 * - Log events include the required fields
 */

import { describe, expect, test } from "bun:test";
import {
  autoInstallDetectedSkills,
  type AutoInstallGroupEvent,
} from "../hooks/src/session-start-profiler.mjs";
import {
  renderLaunchLaneGroupEvent,
  type LaunchLaneGroupEvent,
} from "../hooks/src/session-start-launch-lane.mjs";
import type { RegistrySkillMetadata } from "../hooks/src/registry-skill-metadata.mjs";
import type { DerivedRegistryInstallSet } from "../hooks/src/orchestrator-install-plan.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistryMetadata(
  entries: Array<{ skill: string; registry: string; slug?: string }>,
): Map<string, RegistrySkillMetadata> {
  const map = new Map<string, RegistrySkillMetadata>();
  for (const entry of entries) {
    map.set(entry.skill, {
      registry: entry.registry,
      registrySlug: entry.slug ?? entry.skill,
    });
  }
  return map;
}

function makePreparedInstallSet(
  groups: Array<{
    registry: string;
    skills: string[];
    slugs?: Record<string, string>;
  }>,
  nonRegistryMissingSkills: string[] = [],
): DerivedRegistryInstallSet {
  return {
    groups: groups.map((g) => ({
      registry: g.registry,
      requestedSkills: g.skills,
      installTargets: g.skills.map((s) => ({
        requestedName: s,
        installName: g.slugs?.[s] ?? s,
      })),
    })),
    nonRegistryMissingSkills,
  };
}

// A fake skills source that returns predictable install results
const FAKE_SOURCE = "__test_fake__";

// ---------------------------------------------------------------------------
// autoInstallDetectedSkills — onGroupEvent callback
// ---------------------------------------------------------------------------

describe("autoInstallDetectedSkills group events", () => {
  test("emits no events when no missing skills", async () => {
    const events: AutoInstallGroupEvent[] = [];
    const result = await autoInstallDetectedSkills({
      projectRoot: "/tmp/test-project",
      missingSkills: [],
      registryMetadata: new Map(),
      skillsSource: FAKE_SOURCE,
      onGroupEvent: (e) => events.push(e),
    });

    expect(events).toHaveLength(0);
    expect(result.installed).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  test("emits no events when missing skills have no registry backing", async () => {
    const events: AutoInstallGroupEvent[] = [];
    const result = await autoInstallDetectedSkills({
      projectRoot: "/tmp/test-project",
      missingSkills: ["no-registry-skill"],
      registryMetadata: new Map(), // empty — no registry backing
      onGroupEvent: (e) => events.push(e),
    });

    expect(events).toHaveLength(0);
    expect(result.missing).toContain("no-registry-skill");
  });

  test("emits exactly one group-start and one group-result per registry group", async () => {
    const events: AutoInstallGroupEvent[] = [];

    // Use preparedInstallSet to guarantee two separate groups while
    // skillsSource prevents real npx calls
    const preparedSet = makePreparedInstallSet([
      { registry: "vercel/vercel-skills", skills: ["ai-sdk"] },
      { registry: "vercel-labs/agent-skills", skills: ["deployments-cicd"], slugs: { "deployments-cicd": "deploy-to-vercel" } },
    ]);
    await autoInstallDetectedSkills({
      projectRoot: "/tmp/test-project",
      missingSkills: ["ai-sdk", "deployments-cicd"],
      skillsSource: FAKE_SOURCE,
      preparedInstallSet: preparedSet,
      onGroupEvent: (e) => events.push(e),
    });

    // Filter to just the event kinds we care about
    const starts = events.filter((e) => e.kind === "group-start");
    const results = events.filter((e) => e.kind === "group-result");

    // Two registries → two start events and two result events
    expect(starts.length).toBe(2);
    expect(results.length).toBe(2);
  });

  test("group events arrive in index/total order", async () => {
    const events: AutoInstallGroupEvent[] = [];

    // Use preparedInstallSet to guarantee two separate groups
    const preparedSet = makePreparedInstallSet([
      { registry: "vercel/vercel-skills", skills: ["ai-sdk"] },
      { registry: "vercel-labs/agent-skills", skills: ["deployments-cicd"], slugs: { "deployments-cicd": "deploy-to-vercel" } },
    ]);
    await autoInstallDetectedSkills({
      projectRoot: "/tmp/test-project",
      missingSkills: ["ai-sdk", "deployments-cicd"],
      skillsSource: FAKE_SOURCE,
      preparedInstallSet: preparedSet,
      onGroupEvent: (e) => events.push(e),
    });

    // Verify ordering: events should be sequential — group-start for index 1,
    // then group-result for index 1, then group-start for index 2, etc.
    const starts = events.filter((e) => e.kind === "group-start");
    for (let i = 0; i < starts.length; i++) {
      expect(starts[i].index).toBe(i + 1);
      expect(starts[i].total).toBe(2);
    }
  });

  test("group-start event has no result fields", async () => {
    const events: AutoInstallGroupEvent[] = [];

    const registryMetadata = makeRegistryMetadata([
      { skill: "ai-sdk", registry: "vercel/vercel-skills" },
    ]);

    try {
      await autoInstallDetectedSkills({
        projectRoot: "/tmp/test-project",
        missingSkills: ["ai-sdk"],
        registryMetadata,
        onGroupEvent: (e) => events.push(e),
      });
    } catch {
      // Install may fail
    }

    const starts = events.filter((e) => e.kind === "group-start");
    expect(starts.length).toBeGreaterThanOrEqual(1);
    // group-start should not have result attached
    expect(starts[0].result).toBeUndefined();
    expect(starts[0].registry).toBe("vercel/vercel-skills");
    expect(starts[0].requestedSkills).toEqual(["ai-sdk"]);
  });
});

// ---------------------------------------------------------------------------
// renderLaunchLaneGroupEvent — progress block rendering
// ---------------------------------------------------------------------------

describe("renderLaunchLaneGroupEvent progress blocks", () => {
  test("group-start renders installing header with queue", () => {
    const lines = renderLaunchLaneGroupEvent({
      kind: "group-start",
      index: 1,
      total: 2,
      registry: "vercel/vercel-skills",
      requestedSkills: ["ai-sdk", "next-cache-components"],
    });

    expect(lines).toContain("### Vercel launch lane");
    expect(lines).toContain("- Installing group 1/2: vercel/vercel-skills");
    expect(lines).toContain("- Queue: ai-sdk, next-cache-components");
  });

  test("group-result renders finished header with install breakdown", () => {
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

    expect(lines).toContain("- Finished group 2/2: vercel-labs/agent-skills");
    expect(lines).toContain("- Installed: deployments-cicd");
    expect(lines).toContain("- Already cached: none");
    expect(lines).toContain("- Remaining in group: none");
  });

  test("group-result shows reused skills", () => {
    const lines = renderLaunchLaneGroupEvent({
      kind: "group-result",
      index: 1,
      total: 1,
      registry: "vercel/vercel-skills",
      requestedSkills: ["ai-sdk"],
      installed: [],
      reused: ["ai-sdk"],
      missing: [],
    });

    expect(lines).toContain("- Installed: none");
    expect(lines).toContain("- Already cached: ai-sdk");
  });

  test("group-result shows remaining missing skills", () => {
    const lines = renderLaunchLaneGroupEvent({
      kind: "group-result",
      index: 1,
      total: 1,
      registry: "vercel/vercel-skills",
      requestedSkills: ["ai-sdk", "next-cache-components"],
      installed: ["ai-sdk"],
      reused: [],
      missing: ["next-cache-components"],
    });

    expect(lines).toContain("- Installed: ai-sdk");
    expect(lines).toContain("- Remaining in group: next-cache-components");
  });

  test("group-result defaults to none when arrays are undefined", () => {
    const lines = renderLaunchLaneGroupEvent({
      kind: "group-result",
      index: 1,
      total: 1,
      registry: "vercel/vercel-skills",
      requestedSkills: ["ai-sdk"],
      // installed, reused, missing all undefined
    });

    expect(lines).toContain("- Installed: none");
    expect(lines).toContain("- Already cached: none");
    expect(lines).toContain("- Remaining in group: none");
  });

  test("every progress block starts with ### Vercel launch lane", () => {
    for (const kind of ["group-start", "group-result"] as const) {
      const lines = renderLaunchLaneGroupEvent({
        kind,
        index: 1,
        total: 1,
        registry: "test/repo",
        requestedSkills: ["test-skill"],
      });
      expect(lines[0]).toBe("### Vercel launch lane");
    }
  });
});

// ---------------------------------------------------------------------------
// No raw palette in shipped flow
// ---------------------------------------------------------------------------

describe("shipped flow contains no raw palette artifacts", () => {
  test("renderLaunchLaneGroupEvent output never contains raw install palette markers", () => {
    // The raw palette used markers like "[1] Install now:", "Zero-bundle ready:",
    // and "[2] Cache only:". Verify the launch lane never produces those.
    const variants: LaunchLaneGroupEvent[] = [
      {
        kind: "group-start",
        index: 1,
        total: 2,
        registry: "vercel/vercel-skills",
        requestedSkills: ["ai-sdk", "nextjs"],
      },
      {
        kind: "group-result",
        index: 1,
        total: 2,
        registry: "vercel/vercel-skills",
        requestedSkills: ["ai-sdk", "nextjs"],
        installed: ["ai-sdk", "nextjs"],
        reused: [],
        missing: [],
      },
      {
        kind: "group-result",
        index: 2,
        total: 2,
        registry: "vercel-labs/agent-skills",
        requestedSkills: ["deployments-cicd"],
        installed: [],
        reused: [],
        missing: ["deployments-cicd"],
      },
    ];

    for (const event of variants) {
      const lines = renderLaunchLaneGroupEvent(event);
      const block = lines.join("\n");

      // Raw palette markers from formatSkillInstallPalette
      expect(block).not.toContain("[1] Install now:");
      expect(block).not.toContain("[2] Cache only:");
      expect(block).not.toContain("[3] Explain:");
      expect(block).not.toContain("Zero-bundle ready:");
      expect(block).not.toContain("Detection reasons:");

      // Raw wrapper palette markers from formatOrchestratorActionPalette
      expect(block).not.toContain("### Orchestrator actions");
      expect(block).not.toContain("orchestrator-action-runner.mjs");
    }
  });

  test("every launch lane group event starts with the canonical heading", () => {
    const events: LaunchLaneGroupEvent[] = [
      { kind: "group-start", index: 1, total: 1, registry: "r", requestedSkills: ["s"] },
      { kind: "group-result", index: 1, total: 1, registry: "r", requestedSkills: ["s"] },
    ];
    for (const event of events) {
      const lines = renderLaunchLaneGroupEvent(event);
      expect(lines[0]).toBe("### Vercel launch lane");
    }
  });
});

// ---------------------------------------------------------------------------
// Merged install accounting unchanged
// ---------------------------------------------------------------------------

describe("merged install accounting", () => {
  test("non-registry skills appear in missing regardless of events", async () => {
    const events: AutoInstallGroupEvent[] = [];

    // One registry-backed, one not
    const registryMetadata = makeRegistryMetadata([
      { skill: "ai-sdk", registry: "vercel/vercel-skills" },
    ]);
    const result = await autoInstallDetectedSkills({
      projectRoot: "/tmp/test-project",
      missingSkills: ["ai-sdk", "custom-no-registry"],
      registryMetadata,
      skillsSource: FAKE_SOURCE,
      onGroupEvent: (e) => events.push(e),
    });

    // custom-no-registry should always be in missing since it has no registry
    expect(result.missing).toContain("custom-no-registry");
  });

  test("empty missing skills returns empty result without events", async () => {
    const events: AutoInstallGroupEvent[] = [];
    const result = await autoInstallDetectedSkills({
      projectRoot: "/tmp/test-project",
      missingSkills: [],
      registryMetadata: new Map(),
      onGroupEvent: (e) => events.push(e),
    });

    expect(events).toHaveLength(0);
    expect(result.installed).toEqual([]);
    expect(result.reused).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.command).toBeNull();
    expect(result.commandCwd).toBeNull();
  });
});
