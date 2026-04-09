import { describe, expect, mock, test, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";

import type { SkillInstallPlan } from "../hooks/src/orchestrator-install-plan.mts";
import { resolveProjectStatePaths } from "../hooks/src/project-state-paths.mts";
import type {
  OrchestratorActionRunResult,
} from "../hooks/src/orchestrator-action-runner.mts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<SkillInstallPlan> = {}): SkillInstallPlan {
  return {
    schemaVersion: 1,
    createdAt: "2026-04-01T12:00:00.000Z",
    projectRoot: "/repo",
    projectStateRoot: resolveProjectStatePaths("/repo").stateRoot,
    skillsCacheDir: resolve("/repo", ".claude", "skills"),
    installPlanPath: resolveProjectStatePaths("/repo").installPlanPath,
    likelySkills: [],
    installedSkills: [],
    missingSkills: [],
    bundledFallbackEnabled: true,
    zeroBundleReady: false,
    projectSkillManifestPath: null,
    vercelLinked: false,
    hasEnvLocal: false,
    detections: [],
    actions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Module paths
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "..");
const PLAN_STATE_MODULE = resolve(
  ROOT,
  "hooks",
  "src",
  "orchestrator-install-plan-state.mjs",
);
const RUNNER_MODULE = resolve(
  ROOT,
  "hooks",
  "src",
  "orchestrator-action-runner.mts",
);

// ---------------------------------------------------------------------------
// Mixed-registry runner parity
// ---------------------------------------------------------------------------

describe("orchestrator runner registry parity", () => {
  function setupMockedRunner(plan: SkillInstallPlan) {
    let currentPlan = { ...plan };
    let pendingUpdate: Partial<SkillInstallPlan> | null = null;
    let refreshCount = 0;
    mock.module(PLAN_STATE_MODULE, () => ({
      requirePersistedSkillInstallPlan: () => currentPlan,
      refreshPersistedSkillInstallPlan: (args: {
        projectRoot: string;
        previousPlan: SkillInstallPlan;
      }) => {
        refreshCount++;
        // Apply pending update on the final refresh (after install completes).
        // install-missing: refresh #1=initial, #2=runStep, #3=runInstallMissing,
        // then install runs, then #4=final → apply deferred update at #4+.
        if (pendingUpdate && refreshCount > 3) {
          currentPlan = { ...currentPlan, ...pendingUpdate, projectRoot: args.projectRoot };
          pendingUpdate = null;
        } else {
          currentPlan = { ...currentPlan, projectRoot: args.projectRoot };
        }
        return currentPlan;
      },
      installPlanPath: (projectRoot: string) =>
        resolveProjectStatePaths(projectRoot).installPlanPath,
      readPersistedSkillInstallPlan: () => currentPlan,
      writePersistedSkillInstallPlan: () => {},
    }));
    return {
      /** Mutate the plan immediately */
      mutatePlan(update: Partial<SkillInstallPlan>) {
        currentPlan = { ...currentPlan, ...update };
      },
      /** Schedule a mutation to apply after install completes (on later refreshes) */
      mutatePlanAfterInstall(update: Partial<SkillInstallPlan>) {
        pendingUpdate = update;
      },
    };
  }

  test("install-missing runs one call per registry group with correct source and installTargets", async () => {
    const plan = makePlan({
      projectRoot: "/repo",
      missingSkills: ["nextjs", "vercel-cli"],
      actions: [
        {
          id: "install-missing",
          label: "Install detected skills",
          description: "Install 2 registry-backed missing skills.",
          command:
            "npx skills add vercel/vercel-skills --skill next-best-practices --agent claude-code -y --copy && npx skills add vercel-labs/agent-skills --skill vercel-cli-with-tokens --agent claude-code -y --copy",
          cwd: "/repo",
          commandGroups: [
            {
              registry: "vercel/vercel-skills",
              requestedSkills: ["nextjs"],
              installTargets: [
                { requestedName: "nextjs", installName: "next-best-practices" },
              ],
              command:
                "npx skills add vercel/vercel-skills --skill next-best-practices --agent claude-code -y --copy",
              cwd: "/repo",
            },
            {
              registry: "vercel-labs/agent-skills",
              requestedSkills: ["vercel-cli"],
              installTargets: [
                {
                  requestedName: "vercel-cli",
                  installName: "vercel-cli-with-tokens",
                },
              ],
              command:
                "npx skills add vercel-labs/agent-skills --skill vercel-cli-with-tokens --agent claude-code -y --copy",
              cwd: "/repo",
            },
          ],
          default: true,
        },
      ],
    });

    const ctx = setupMockedRunner(plan);

    const runner = await import(
      `${RUNNER_MODULE}?t=${Date.now()}-${Math.random()}`
    );

    const installCalls: Array<{
      source?: string;
      skillNames: string[];
      installTargets?: Array<{ requestedName: string; installName: string }>;
    }> = [];

    const registryClient = {
      installSkills: mock(async (args: any) => {
        installCalls.push({
          source: args.source,
          skillNames: args.skillNames,
          installTargets: args.installTargets,
        });
        return {
          installed: [...args.skillNames].sort(),
          reused: [],
          missing: [],
          command: `npx skills add ${args.source} --skill ${(args.installTargets ?? []).map((t: any) => t.installName).join(" --skill ")} --agent claude-code -y --copy`,
          commandCwd: "/repo",
        };
      }),
    };

    // Simulate that after install completes, refresh finds no missing skills
    ctx.mutatePlanAfterInstall({ missingSkills: [] });

    const result: OrchestratorActionRunResult =
      await runner.runOrchestratorAction({
        projectRoot: "/repo",
        actionId: "install-missing",
        registryClient,
        vercelDelegator: {
          run: mock(async () => {
            throw new Error("vercel cli should not run");
          }),
        },
      });

    // Two separate registry calls — one per group
    // Groups are sorted alphabetically by registry name
    expect(installCalls).toEqual([
      {
        source: "vercel-labs/agent-skills",
        skillNames: ["vercel-cli"],
        installTargets: [
          {
            requestedName: "vercel-cli",
            installName: "vercel-cli-with-tokens",
          },
        ],
      },
      {
        source: "vercel/vercel-skills",
        skillNames: ["nextjs"],
        installTargets: [
          { requestedName: "nextjs", installName: "next-best-practices" },
        ],
      },
    ]);

    // Two delegated commands
    expect(result.commands).toHaveLength(2);

    // Merged install result
    expect(result.installResult?.installed).toEqual(["nextjs", "vercel-cli"]);
    expect(result.installResult?.missing).toEqual([]);

    // Refreshed plan has registry-backed missing skills cleared
    expect(result.refreshedPlan.missingSkills).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("fallback reconstruction when persisted plan lacks commandGroups", async () => {
    // Older plan format without commandGroups
    const plan = makePlan({
      projectRoot: "/repo",
      missingSkills: ["nextjs"],
      actions: [
        {
          id: "install-missing",
          label: "Install detected skills",
          description: "Install 1 missing skill.",
          command:
            "npx skills add vercel/vercel-skills --skill nextjs --agent claude-code -y --copy",
          cwd: "/repo",
          // No commandGroups — older plan format
          default: true,
        },
      ],
    });

    const ctx = setupMockedRunner(plan);

    const runner = await import(
      `${RUNNER_MODULE}?t=${Date.now()}-${Math.random()}`
    );

    const registryClient = {
      installSkills: mock(async (args: any) => ({
        installed: [...args.skillNames].sort(),
        reused: [],
        missing: [],
        command: `npx skills add ${args.source ?? "vercel/vercel-skills"} --skill ${args.skillNames.join(" --skill ")} --agent claude-code -y --copy`,
        commandCwd: "/repo",
      })),
    };

    // Simulate refresh clearing missing skills after install completes
    ctx.mutatePlanAfterInstall({ missingSkills: [] });

    const result: OrchestratorActionRunResult =
      await runner.runOrchestratorAction({
        projectRoot: "/repo",
        actionId: "install-missing",
        registryClient,
        vercelDelegator: {
          run: mock(async () => {
            throw new Error("vercel cli should not run");
          }),
        },
      });

    // Should reconstruct groups from missingSkills and call installSkills
    expect(registryClient.installSkills).toHaveBeenCalled();
    expect(result.installResult?.installed).toContain("nextjs");
    expect(result.refreshedPlan.missingSkills).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runner ignores stale persisted commandGroups
// ---------------------------------------------------------------------------

describe("orchestrator runner ignores stale persisted commandGroups", () => {
  function setupMockedRunner(plan: SkillInstallPlan) {
    let currentPlan = { ...plan };
    let pendingUpdate: Partial<SkillInstallPlan> | null = null;
    let refreshCount = 0;
    mock.module(PLAN_STATE_MODULE, () => ({
      requirePersistedSkillInstallPlan: () => currentPlan,
      refreshPersistedSkillInstallPlan: (args: {
        projectRoot: string;
        previousPlan: SkillInstallPlan;
      }) => {
        refreshCount++;
        if (pendingUpdate && refreshCount > 3) {
          currentPlan = { ...currentPlan, ...pendingUpdate, projectRoot: args.projectRoot };
          pendingUpdate = null;
        } else {
          currentPlan = { ...currentPlan, projectRoot: args.projectRoot };
        }
        return currentPlan;
      },
      installPlanPath: (projectRoot: string) =>
        resolveProjectStatePaths(projectRoot).installPlanPath,
      readPersistedSkillInstallPlan: () => currentPlan,
      writePersistedSkillInstallPlan: () => {},
    }));
    return {
      mutatePlanAfterInstall(update: Partial<SkillInstallPlan>) {
        pendingUpdate = update;
      },
    };
  }

  test("stale commandGroups pointing to wrong registries are ignored — runner derives from missingSkills", async () => {
    // Persisted plan has stale commandGroups that point to "old-org/old-repo"
    // but the actual registry metadata resolves to "vercel/vercel-skills"
    const plan = makePlan({
      projectRoot: "/repo",
      missingSkills: ["nextjs"],
      actions: [
        {
          id: "install-missing",
          label: "Install",
          description: "Install 1 skill.",
          command: "npx skills add old-org/old-repo --skill nextjs --agent claude-code -y --copy",
          cwd: "/repo",
          commandGroups: [
            {
              registry: "old-org/old-repo",
              requestedSkills: ["nextjs"],
              installTargets: [{ requestedName: "nextjs", installName: "nextjs" }],
              command: "npx skills add old-org/old-repo --skill nextjs --agent claude-code -y --copy",
              cwd: "/repo",
            },
          ],
          default: true,
        },
      ],
    });

    const ctx = setupMockedRunner(plan);
    ctx.mutatePlanAfterInstall({ missingSkills: [] });

    const runner = await import(
      `${RUNNER_MODULE}?t=${Date.now()}-${Math.random()}`
    );

    const installCalls: Array<{ source?: string }> = [];
    const registryClient = {
      installSkills: mock(async (args: any) => {
        installCalls.push({ source: args.source });
        return {
          installed: [...args.skillNames].sort(),
          reused: [],
          missing: [],
          command: `npx skills add ${args.source} --skill ${args.skillNames.join(" --skill ")} --agent claude-code -y --copy`,
          commandCwd: "/repo",
        };
      }),
    };

    const result: OrchestratorActionRunResult =
      await runner.runOrchestratorAction({
        projectRoot: "/repo",
        actionId: "install-missing",
        registryClient,
        vercelDelegator: {
          run: mock(async () => { throw new Error("should not call"); }),
        },
      });

    // The runner should have derived groups from missingSkills + real registry
    // metadata, NOT from the stale commandGroups. The install call source
    // should come from the live registry metadata, not "old-org/old-repo".
    expect(installCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of installCalls) {
      expect(call.source).not.toBe("old-org/old-repo");
    }
    expect(result.installResult?.installed).toContain("nextjs");
    expect(result.ok).toBe(true);
  });

  test("runner produces identical results for plans with and without commandGroups", async () => {
    const basePlanFields = {
      projectRoot: "/repo",
      missingSkills: ["nextjs"],
    };

    const planWithGroups = makePlan({
      ...basePlanFields,
      actions: [
        {
          id: "install-missing" as const,
          label: "Install",
          description: "Install 1 skill.",
          command: "npx skills add vercel/vercel-skills --skill nextjs --agent claude-code -y --copy",
          cwd: "/repo",
          commandGroups: [
            {
              registry: "vercel/vercel-skills",
              requestedSkills: ["nextjs"],
              installTargets: [{ requestedName: "nextjs", installName: "next-best-practices" }],
              command: "npx skills add vercel/vercel-skills --skill next-best-practices --agent claude-code -y --copy",
              cwd: "/repo",
            },
          ],
          default: true,
        },
      ],
    });

    const planWithout = makePlan({
      ...basePlanFields,
      actions: [
        {
          id: "install-missing" as const,
          label: "Install",
          description: "Install 1 skill.",
          command: "npx skills add vercel/vercel-skills --skill nextjs --agent claude-code -y --copy",
          cwd: "/repo",
          // No commandGroups
          default: true,
        },
      ],
    });

    const results: OrchestratorActionRunResult[] = [];

    for (const plan of [planWithGroups, planWithout]) {
      let currentPlan = { ...plan };
      let refreshCount = 0;
      mock.module(PLAN_STATE_MODULE, () => ({
        requirePersistedSkillInstallPlan: () => currentPlan,
        refreshPersistedSkillInstallPlan: (args: {
          projectRoot: string;
          previousPlan: SkillInstallPlan;
        }) => {
          refreshCount++;
          if (refreshCount > 3) {
            currentPlan = { ...currentPlan, missingSkills: [], projectRoot: args.projectRoot };
          } else {
            currentPlan = { ...currentPlan, projectRoot: args.projectRoot };
          }
          return currentPlan;
        },
        installPlanPath: (projectRoot: string) =>
          resolveProjectStatePaths(projectRoot).installPlanPath,
        readPersistedSkillInstallPlan: () => currentPlan,
        writePersistedSkillInstallPlan: () => {},
      }));

      const runner = await import(
        `${RUNNER_MODULE}?t=${Date.now()}-${Math.random()}`
      );

      const result = await runner.runOrchestratorAction({
        projectRoot: "/repo",
        actionId: "install-missing",
        registryClient: {
          installSkills: mock(async (args: any) => ({
            installed: [...args.skillNames].sort(),
            reused: [],
            missing: [],
            command: `npx skills add ${args.source} --skill ${args.skillNames.join(" --skill ")} --agent claude-code -y --copy`,
            commandCwd: "/repo",
          })),
        },
        vercelDelegator: {
          run: mock(async () => { throw new Error("should not call"); }),
        },
      });

      results.push(result);
    }

    // Both plans should produce equivalent results
    expect(results[0].ok).toBe(results[1].ok);
    expect(results[0].installResult?.installed).toEqual(results[1].installResult?.installed);
    expect(results[0].commands.length).toBe(results[1].commands.length);
  });
});

// ---------------------------------------------------------------------------
// Shared logger event parity
// ---------------------------------------------------------------------------

describe("orchestrator runner shared logger events", () => {
  let stderrLines: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrLines = [];
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    // Enable debug logging so shared logger events are emitted
    process.env.VERCEL_PLUGIN_LOG_LEVEL = "debug";
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    delete process.env.VERCEL_PLUGIN_LOG_LEVEL;
  });

  function setupMockedRunner(plan: SkillInstallPlan) {
    let currentPlan = { ...plan };
    let pendingUpdate: Partial<SkillInstallPlan> | null = null;
    let refreshCount = 0;
    mock.module(PLAN_STATE_MODULE, () => ({
      requirePersistedSkillInstallPlan: () => currentPlan,
      refreshPersistedSkillInstallPlan: (args: {
        projectRoot: string;
        previousPlan: SkillInstallPlan;
      }) => {
        refreshCount++;
        if (pendingUpdate && refreshCount > 3) {
          currentPlan = { ...currentPlan, ...pendingUpdate, projectRoot: args.projectRoot };
          pendingUpdate = null;
        } else {
          currentPlan = { ...currentPlan, projectRoot: args.projectRoot };
        }
        return currentPlan;
      },
      installPlanPath: (projectRoot: string) =>
        resolveProjectStatePaths(projectRoot).installPlanPath,
      readPersistedSkillInstallPlan: () => currentPlan,
      writePersistedSkillInstallPlan: () => {},
    }));
    return {
      mutatePlanAfterInstall(update: Partial<SkillInstallPlan>) {
        pendingUpdate = update;
      },
    };
  }

  function parsedEvents(): Array<Record<string, unknown>> {
    return stderrLines
      .map((line) => {
        try {
          return JSON.parse(line.trim());
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  test("install-missing-skipped emits shared logger event with actionId", async () => {
    const plan = makePlan({ missingSkills: [] });
    setupMockedRunner(plan);

    const runner = await import(
      `${RUNNER_MODULE}?t=${Date.now()}-${Math.random()}`
    );

    await runner.runOrchestratorAction({
      projectRoot: "/repo",
      actionId: "install-missing",
      registryClient: { installSkills: mock(async () => { throw new Error("should not call"); }) },
      vercelDelegator: { run: mock(async () => { throw new Error("should not call"); }) },
    });

    const events = parsedEvents();
    const skipped = events.find((e) =>
      typeof e.event === "string" && e.event.includes("install-missing-skipped"),
    );
    expect(skipped).toBeDefined();
    expect(skipped!.actionId).toBe("install-missing");
    expect(skipped!.projectRoot).toBe("/repo");
    expect(skipped!.reason).toBe("no-missing-skills");
    // Shared logger adds invocationId
    expect(skipped!.invocationId).toBeDefined();
  });

  test("install-group-start and install-group-result emit with full metadata", async () => {
    const plan = makePlan({
      projectRoot: "/repo",
      missingSkills: ["nextjs"],
      actions: [
        {
          id: "install-missing",
          label: "Install",
          description: "Install 1 skill.",
          command: "npx skills add vercel/vercel-skills --skill next-best-practices --agent claude-code -y --copy",
          cwd: "/repo",
          commandGroups: [
            {
              registry: "vercel/vercel-skills",
              requestedSkills: ["nextjs"],
              installTargets: [{ requestedName: "nextjs", installName: "next-best-practices" }],
              command: "npx skills add vercel/vercel-skills --skill next-best-practices --agent claude-code -y --copy",
              cwd: "/repo",
            },
          ],
          default: true,
        },
      ],
    });

    const ctx = setupMockedRunner(plan);
    ctx.mutatePlanAfterInstall({ missingSkills: [] });

    const runner = await import(
      `${RUNNER_MODULE}?t=${Date.now()}-${Math.random()}`
    );

    await runner.runOrchestratorAction({
      projectRoot: "/repo",
      actionId: "install-missing",
      registryClient: {
        installSkills: mock(async () => ({
          installed: ["nextjs"],
          reused: [],
          missing: [],
          command: "npx skills add vercel/vercel-skills --skill next-best-practices --agent claude-code -y --copy",
          commandCwd: "/repo",
        })),
      },
      vercelDelegator: { run: mock(async () => { throw new Error("should not call"); }) },
    });

    const events = parsedEvents();

    // install-group-start
    const startEvent = events.find((e) =>
      typeof e.event === "string" && e.event.includes("install-group-start"),
    );
    expect(startEvent).toBeDefined();
    expect(startEvent!.actionId).toBe("install-missing");
    expect(startEvent!.projectRoot).toBe("/repo");
    expect(startEvent!.registry).toBe("vercel/vercel-skills");
    expect(startEvent!.requestedSkills).toEqual(["nextjs"]);
    expect(startEvent!.installTargets).toEqual([
      { requestedName: "nextjs", installName: "next-best-practices" },
    ]);
    expect(startEvent!.invocationId).toBeDefined();

    // install-group-result
    const resultEvent = events.find((e) =>
      typeof e.event === "string" && e.event.includes("install-group-result"),
    );
    expect(resultEvent).toBeDefined();
    expect(resultEvent!.actionId).toBe("install-missing");
    expect(resultEvent!.installed).toEqual(["nextjs"]);
    expect(resultEvent!.reused).toEqual([]);
    expect(resultEvent!.missing).toEqual([]);
    expect(resultEvent!.command).toContain("vercel/vercel-skills");
    expect(resultEvent!.commandCwd).toBe("/repo");
    expect(resultEvent!.invocationId).toBeDefined();
  });

  test("install-missing-no-registry-groups emits when no groups resolve", async () => {
    const plan = makePlan({
      projectRoot: "/repo",
      missingSkills: ["unknown-skill"],
      actions: [
        {
          id: "install-missing",
          label: "Install",
          description: "Install 1 skill.",
          command: "",
          cwd: "/repo",
          commandGroups: [],
          default: true,
        },
      ],
    });

    setupMockedRunner(plan);

    const runner = await import(
      `${RUNNER_MODULE}?t=${Date.now()}-${Math.random()}`
    );

    await runner.runOrchestratorAction({
      projectRoot: "/repo",
      actionId: "install-missing",
      registryClient: { installSkills: mock(async () => { throw new Error("should not call"); }) },
      vercelDelegator: { run: mock(async () => { throw new Error("should not call"); }) },
    });

    const events = parsedEvents();
    const noGroups = events.find((e) =>
      typeof e.event === "string" && e.event.includes("install-missing-no-registry-groups"),
    );
    expect(noGroups).toBeDefined();
    expect(noGroups!.actionId).toBe("install-missing");
    expect(noGroups!.projectRoot).toBe("/repo");
    expect(noGroups!.missing).toEqual(["unknown-skill"]);
    expect(noGroups!.invocationId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-path parity: banner vs action-runner derivation
// ---------------------------------------------------------------------------

describe("cross-path parity: banner and action-runner produce identical registry derivation", () => {
  /**
   * Both `buildProjectSkillInstallCommand` (banner path) and
   * `resolveInstallCommandGroups` (action-runner path) call
   * `prepareRegistryInstallContext()` under the hood. This test
   * verifies that for the same mixed missing-skill set (registry-backed
   * + non-registry), both paths derive the same grouped summaries and
   * non-registry leftovers.
   */

  // Use the real plugin root so loadRegistrySkillMetadata() finds the manifest
  const PLUGIN_ROOT = resolve(import.meta.dirname, "..");

  test("mixed missing-skill set produces identical summaries and non-registry leftovers", () => {
    const { prepareRegistryInstallContext } = require(
      "../hooks/src/orchestrator-install-plan.mts",
    ) as typeof import("../hooks/src/orchestrator-install-plan.mts");
    const { loadRegistrySkillMetadata } = require(
      "../hooks/src/registry-skill-metadata.mts",
    ) as typeof import("../hooks/src/registry-skill-metadata.mts");

    const missingSkills = ["ai-sdk", "unknown-nonexistent-skill", "vercel-cli"];
    const registryMetadata = loadRegistrySkillMetadata(PLUGIN_ROOT);

    // Banner path: same args as buildProjectSkillInstallCommand uses
    const bannerContext = prepareRegistryInstallContext({
      projectRoot: "/repo",
      missingSkills,
      registryMetadata,
      skillsAgent: "claude-code",
    });

    // Action-runner path: same args as resolveInstallCommandGroups uses
    const runnerContext = prepareRegistryInstallContext({
      projectRoot: "/repo",
      missingSkills,
      // No explicit registryMetadata — uses default loadRegistrySkillMetadata()
    });

    // Summaries must match (registry grouping)
    expect(bannerContext.summaries).toEqual(runnerContext.summaries);

    // Non-registry leftovers must match
    expect(bannerContext.nonRegistryMissingSkills).toEqual(
      runnerContext.nonRegistryMissingSkills,
    );

    // Verify the non-registry skill is correctly identified
    expect(bannerContext.nonRegistryMissingSkills).toContain(
      "unknown-nonexistent-skill",
    );

    // Verify registry-backed skills are in summaries
    const allSummarySkills = bannerContext.summaries.flatMap(
      (s) => s.requestedSkills,
    );
    expect(allSummarySkills).toContain("ai-sdk");
    expect(allSummarySkills).toContain("vercel-cli");
    expect(allSummarySkills).not.toContain("unknown-nonexistent-skill");

    // Install groups must match (command-bearing groups)
    expect(bannerContext.installGroups.length).toBe(
      runnerContext.installGroups.length,
    );
    for (let i = 0; i < bannerContext.installGroups.length; i++) {
      expect(bannerContext.installGroups[i].registry).toBe(
        runnerContext.installGroups[i].registry,
      );
      expect(bannerContext.installGroups[i].requestedSkills).toEqual(
        runnerContext.installGroups[i].requestedSkills,
      );
      expect(bannerContext.installGroups[i].installTargets).toEqual(
        runnerContext.installGroups[i].installTargets,
      );
    }
  });

  test("all-registry missing skills produce no non-registry leftovers on both paths", () => {
    const { prepareRegistryInstallContext } = require(
      "../hooks/src/orchestrator-install-plan.mts",
    ) as typeof import("../hooks/src/orchestrator-install-plan.mts");
    const { loadRegistrySkillMetadata } = require(
      "../hooks/src/registry-skill-metadata.mts",
    ) as typeof import("../hooks/src/registry-skill-metadata.mts");

    const missingSkills = ["ai-sdk", "nextjs"];
    const registryMetadata = loadRegistrySkillMetadata(PLUGIN_ROOT);

    const bannerContext = prepareRegistryInstallContext({
      projectRoot: "/repo",
      missingSkills,
      registryMetadata,
      skillsAgent: "claude-code",
    });

    const runnerContext = prepareRegistryInstallContext({
      projectRoot: "/repo",
      missingSkills,
    });

    expect(bannerContext.nonRegistryMissingSkills).toEqual([]);
    expect(runnerContext.nonRegistryMissingSkills).toEqual([]);
    expect(bannerContext.summaries).toEqual(runnerContext.summaries);
  });

  test("all-non-registry missing skills produce empty groups on both paths", () => {
    const { prepareRegistryInstallContext } = require(
      "../hooks/src/orchestrator-install-plan.mts",
    ) as typeof import("../hooks/src/orchestrator-install-plan.mts");
    const { loadRegistrySkillMetadata } = require(
      "../hooks/src/registry-skill-metadata.mts",
    ) as typeof import("../hooks/src/registry-skill-metadata.mts");

    const missingSkills = ["unknown-a", "unknown-b"];
    const registryMetadata = loadRegistrySkillMetadata(PLUGIN_ROOT);

    const bannerContext = prepareRegistryInstallContext({
      projectRoot: "/repo",
      missingSkills,
      registryMetadata,
      skillsAgent: "claude-code",
    });

    const runnerContext = prepareRegistryInstallContext({
      projectRoot: "/repo",
      missingSkills,
    });

    expect(bannerContext.summaries).toEqual([]);
    expect(runnerContext.summaries).toEqual([]);
    expect(bannerContext.installGroups).toEqual([]);
    expect(runnerContext.installGroups).toEqual([]);
    expect(bannerContext.nonRegistryMissingSkills).toEqual(["unknown-a", "unknown-b"]);
    expect(runnerContext.nonRegistryMissingSkills).toEqual(["unknown-a", "unknown-b"]);
    expect(bannerContext.installCommand).toBeNull();
    expect(runnerContext.installCommand).toBeNull();
  });
});
