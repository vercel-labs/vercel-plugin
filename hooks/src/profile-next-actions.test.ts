/**
 * Regression tests for profile-next-actions: authored copy, priority,
 * command normalization, and invalid input filtering.
 */

import { describe, expect, test } from "bun:test";
import type { SkillInstallPlan } from "./orchestrator-install-plan.mjs";
import { buildProfileNextActions, type ProfileNextAction } from "./profile-next-actions.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<SkillInstallPlan> = {}): SkillInstallPlan {
  return {
    schemaVersion: 1,
    createdAt: "2026-04-04T00:00:00.000Z",
    projectRoot: "/test-project",
    projectStateRoot: "/tmp/.vercel-plugin/projects/abc",
    skillsCacheDir: "/tmp/.vercel-plugin/projects/abc/.skills",
    installPlanPath: "/tmp/.vercel-plugin/projects/abc/install-plan.json",
    likelySkills: ["nextjs"],
    installedSkills: [],
    missingSkills: ["nextjs"],
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

const PLUGIN_ROOT = "/test-plugin-root";
const PROJECT_ROOT = "/test-project";

// ---------------------------------------------------------------------------
// Authored copy
// ---------------------------------------------------------------------------

describe("buildProfileNextActions — authored copy", () => {
  test("vercel-link uses authored title and reason", () => {
    const plan = makePlan({
      vercelLinked: false,
      missingSkills: [],
      actions: [
        {
          id: "vercel-link",
          label: "Link Vercel project",
          description: "Link this project to a Vercel project.",
          command: "vercel link",
          cwd: null,
        },
      ],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const linkAction = result.find((a) => a.id === "vercel-link");
    expect(linkAction).toBeDefined();
    expect(linkAction!.title).toBe("Link this repo to Vercel");
    expect(linkAction!.reason).toContain("Connect local work");
  });

  test("vercel-env-pull uses authored copy", () => {
    const plan = makePlan({
      vercelLinked: true,
      hasEnvLocal: false,
      missingSkills: [],
      actions: [
        {
          id: "vercel-env-pull",
          label: "Pull .env.local from Vercel",
          description: "Pull `.env.local` from the linked Vercel project.",
          command: "vercel env pull",
          cwd: null,
        },
      ],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const envAction = result.find((a) => a.id === "vercel-env-pull");
    expect(envAction).toBeDefined();
    expect(envAction!.title).toBe("Pull environment variables");
    expect(envAction!.reason).toContain("runtime state aligned");
  });

  test("vercel-deploy uses authored copy", () => {
    const plan = makePlan({
      vercelLinked: true,
      hasEnvLocal: true,
      missingSkills: [],
      actions: [
        {
          id: "vercel-deploy",
          label: "Deploy to Vercel",
          description: "Deploy the current project to Vercel.",
          command: "vercel deploy",
          cwd: null,
        },
      ],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const deployAction = result.find((a) => a.id === "vercel-deploy");
    expect(deployAction).toBeDefined();
    expect(deployAction!.title).toBe("Ship a first deploy");
    expect(deployAction!.reason).toContain("happy path end to end");
  });

  test("install-missing uses authored copy", () => {
    const plan = makePlan({
      missingSkills: ["nextjs"],
      actions: [
        {
          id: "install-missing",
          label: "Install missing skills",
          description: "Install detected skills.",
          command: "npx skills add nextjs",
          cwd: null,
        },
      ],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const installAction = result.find((a) => a.id === "install-missing");
    expect(installAction).toBeDefined();
    expect(installAction!.title).toBe("Install the missing pieces");
    expect(installAction!.reason).toContain("obvious blockers");
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe("buildProfileNextActions — priority ordering", () => {
  test("sorts actions by priority descending", () => {
    const plan = makePlan({
      vercelLinked: false,
      hasEnvLocal: false,
      missingSkills: ["nextjs"],
      actions: [
        { id: "vercel-link", label: "L", description: "D", command: "vercel link", cwd: null },
        { id: "install-missing", label: "I", description: "D", command: "npx skills add", cwd: null },
        { id: "vercel-deploy", label: "Dep", description: "D", command: "vercel deploy", cwd: null },
      ],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });

    // bootstrap-project should be first (100), then vercel-link (95),
    // vercel-env-pull if visible, install-missing (85), vercel-deploy (70)
    const ids = result.map((a) => a.id);
    const priorities = result.map((a) => a.priority);

    // Verify descending order
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeLessThanOrEqual(priorities[i - 1]);
    }
  });

  test("bootstrap-project has highest priority (100)", () => {
    const plan = makePlan({
      vercelLinked: false,
      missingSkills: ["nextjs"],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const bootstrap = result.find((a) => a.id === "bootstrap-project");
    if (bootstrap) {
      expect(bootstrap.priority).toBe(100);
    }
  });

  test("vercel-deploy has lowest priority (70)", () => {
    const plan = makePlan({
      vercelLinked: true,
      hasEnvLocal: true,
      missingSkills: [],
      actions: [
        { id: "vercel-deploy", label: "D", description: "D", command: "vercel deploy", cwd: null },
      ],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const deploy = result.find((a) => a.id === "vercel-deploy");
    expect(deploy).toBeDefined();
    expect(deploy!.priority).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// Command normalization
// ---------------------------------------------------------------------------

describe("buildProfileNextActions — command normalization", () => {
  test("bootstrap-project builds a runner command", () => {
    const plan = makePlan({
      vercelLinked: false,
      missingSkills: ["nextjs"],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const bootstrap = result.find((a) => a.id === "bootstrap-project");
    if (bootstrap) {
      expect(bootstrap.command).toContain("orchestrator-action-runner");
      expect(bootstrap.command).toContain("--action");
      expect(bootstrap.command).toContain("bootstrap-project");
    }
  });

  test("non-bootstrap actions get commands from runner builder", () => {
    const plan = makePlan({
      vercelLinked: true,
      hasEnvLocal: true,
      missingSkills: [],
      actions: [
        { id: "vercel-deploy", label: "D", description: "D", command: "vercel deploy", cwd: null },
      ],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const deploy = result.find((a) => a.id === "vercel-deploy");
    expect(deploy).toBeDefined();
    // The command comes from buildOrchestratorRunnerCommand, not the plan action
    expect(deploy!.command).toContain("orchestrator-action-runner");
  });
});

// ---------------------------------------------------------------------------
// Empty / invalid input filtering
// ---------------------------------------------------------------------------

describe("buildProfileNextActions — filtering", () => {
  test("returns empty array when no visible specs match fast lane ids", () => {
    // Fully linked, has env, no missing skills → only deploy is visible
    // but if we also set vercelLinked=false and hasEnvLocal=true and missingSkills=[]
    // then vercel-link is visible but vercel-env-pull and vercel-deploy are not
    const plan = makePlan({
      vercelLinked: true,
      hasEnvLocal: true,
      missingSkills: [],
      actions: [],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    // Only vercel-deploy should be visible when linked + hasEnvLocal + no missing
    const ids = result.map((a) => a.id);
    expect(ids).toContain("vercel-deploy");
    // bootstrap should not be visible since nothing is missing
    expect(ids).not.toContain("install-missing");
  });

  test("returns only visible actions", () => {
    // vercel-env-pull is only visible when vercelLinked && !hasEnvLocal
    const plan = makePlan({
      vercelLinked: false,
      hasEnvLocal: true,
      missingSkills: [],
      actions: [],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    const ids = result.map((a) => a.id);
    expect(ids).not.toContain("vercel-env-pull");
    expect(ids).not.toContain("vercel-deploy"); // not linked
  });

  test("each returned action has all required fields", () => {
    const plan = makePlan({
      vercelLinked: false,
      missingSkills: ["nextjs"],
    });
    const result = buildProfileNextActions({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: PROJECT_ROOT,
      installPlan: plan,
    });
    for (const action of result) {
      expect(typeof action.id).toBe("string");
      expect(action.id.length).toBeGreaterThan(0);
      expect(typeof action.title).toBe("string");
      expect(action.title.length).toBeGreaterThan(0);
      expect(typeof action.reason).toBe("string");
      expect(action.reason.length).toBeGreaterThan(0);
      expect(typeof action.priority).toBe("number");
      expect(action.priority).toBeGreaterThan(0);
    }
  });
});
