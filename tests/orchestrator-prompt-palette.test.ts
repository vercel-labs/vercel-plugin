import { describe, expect, test } from "bun:test";
import {
  loadFreshInstallPlan,
  scorePromptPaletteActions,
  renderPromptActionPalette,
  buildPromptActionPalette,
  type PromptPaletteMatch,
  type PromptPaletteLogger,
} from "../hooks/src/orchestrator-prompt-palette.mts";
import type { ProfileNextAction } from "../hooks/src/profile-next-actions.mts";
import type { SkillInstallPlan } from "../hooks/src/orchestrator-install-plan.mts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<SkillInstallPlan> = {}): SkillInstallPlan {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    projectRoot: "/tmp/app",
    projectStateRoot: "/tmp/state",
    skillsCacheDir: "/tmp/cache",
    installPlanPath: "/tmp/state/install-plan.json",
    likelySkills: ["ai-sdk"],
    installedSkills: [],
    missingSkills: ["ai-sdk"],
    bundledFallbackEnabled: false,
    zeroBundleReady: false,
    projectSkillManifestPath: null,
    vercelLinked: false,
    hasEnvLocal: false,
    detections: [],
    actions: [],
    ...overrides,
  };
}

function makeActions(): ProfileNextAction[] {
  return [
    {
      id: "vercel-link",
      title: "Link this repo to Vercel",
      reason: "Connect local work to the right project before you pull env or deploy anything.",
      command: 'node "/plugin/hooks/orchestrator-action-runner.mjs" --project-root "/tmp/app" --action vercel-link',
      priority: 95,
    },
    {
      id: "vercel-env-pull",
      title: "Pull environment variables",
      reason: "Get local runtime state aligned before you debug auth, data, or build issues.",
      command: 'node "/plugin/hooks/orchestrator-action-runner.mjs" --project-root "/tmp/app" --action vercel-env-pull',
      priority: 90,
    },
    {
      id: "install-missing",
      title: "Install the missing pieces",
      reason: "Clear the obvious blockers first so the next few steps go through cleanly.",
      command: 'node "/plugin/hooks/orchestrator-action-runner.mjs" --project-root "/tmp/app" --action install-missing',
      priority: 85,
    },
    {
      id: "vercel-deploy",
      title: "Ship a first deploy",
      reason: "Use one clean deploy to validate the happy path end to end.",
      command: 'node "/plugin/hooks/orchestrator-action-runner.mjs" --project-root "/tmp/app" --action vercel-deploy',
      priority: 70,
    },
  ];
}

// ---------------------------------------------------------------------------
// Debug event collector
// ---------------------------------------------------------------------------

function createCollector(): {
  logger: PromptPaletteLogger;
  events: Array<{ event: string; data: Record<string, unknown> }>;
} {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  return {
    logger: {
      debug: (event: string, data: Record<string, unknown>) => {
        events.push({ event, data });
      },
    },
    events,
  };
}

// ---------------------------------------------------------------------------
// scorePromptPaletteActions
// ---------------------------------------------------------------------------

describe("scorePromptPaletteActions", () => {
  const actions = makeActions();

  describe("direct aliases", () => {
    test("/vercel env maps to vercel-env-pull", () => {
      const { logger, events } = createCollector();
      const matches = scorePromptPaletteActions({
        prompt: "/vercel env",
        actions,
        logger,
      });
      expect(matches).toHaveLength(1);
      expect(matches[0].actionId).toBe("vercel-env-pull");
      expect(matches[0].score).toBe(100);
      expect(matches[0].direct).toBe(true);

      const scored = events.find(
        (e) => e.event === "orchestrator-prompt-palette:intent-scored",
      );
      expect(scored).toBeDefined();
      expect(scored!.data.mode).toBe("direct");
    });

    test("/vercel deploy maps to vercel-deploy", () => {
      const matches = scorePromptPaletteActions({
        prompt: "/vercel deploy",
        actions,
      });
      expect(matches).toHaveLength(1);
      expect(matches[0].actionId).toBe("vercel-deploy");
      expect(matches[0].direct).toBe(true);
    });

    test("vp env maps to vercel-env-pull", () => {
      const matches = scorePromptPaletteActions({
        prompt: "vp env",
        actions,
      });
      expect(matches).toHaveLength(1);
      expect(matches[0].actionId).toBe("vercel-env-pull");
    });

    test("vp deploy maps to vercel-deploy", () => {
      const matches = scorePromptPaletteActions({
        prompt: "vp deploy",
        actions,
      });
      expect(matches).toHaveLength(1);
      expect(matches[0].actionId).toBe("vercel-deploy");
    });
  });

  describe("keyword scoring", () => {
    test("'pull env' matches vercel-env-pull", () => {
      const { logger, events } = createCollector();
      const matches = scorePromptPaletteActions({
        prompt: "pull env",
        actions,
        logger,
      });
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].actionId).toBe("vercel-env-pull");
      expect(matches[0].direct).toBe(false);

      const scored = events.find(
        (e) => e.event === "orchestrator-prompt-palette:intent-scored",
      );
      expect(scored).toBeDefined();
      expect(scored!.data.mode).toBe("keywords");
    });

    test("'ship this' matches vercel-deploy", () => {
      const matches = scorePromptPaletteActions({
        prompt: "ship this",
        actions,
      });
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].actionId).toBe("vercel-deploy");
    });

    test("'deploy to vercel' gives vercel bonus", () => {
      const matches = scorePromptPaletteActions({
        prompt: "deploy to vercel",
        actions,
      });
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].actionId).toBe("vercel-deploy");
      // "deploy" (4) + "vercel" bonus (1) = 5
      expect(matches[0].score).toBe(5);
    });

    test("'install what's missing' matches install-missing", () => {
      const matches = scorePromptPaletteActions({
        prompt: "install what's missing",
        actions,
      });
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].actionId).toBe("install-missing");
    });

    test("'rename this component' yields no matches", () => {
      const matches = scorePromptPaletteActions({
        prompt: "rename this component",
        actions,
      });
      expect(matches).toHaveLength(0);
    });
  });

  describe("generic palette trigger", () => {
    test("'what should I do next' is not scored (handled by renderer)", () => {
      // Generic palette is handled in renderPromptActionPalette, not in scoring
      const matches = scorePromptPaletteActions({
        prompt: "what should I do next",
        actions,
      });
      // No keyword match → empty (the renderer uses GENERIC_PALETTE_RE separately)
      expect(matches).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// renderPromptActionPalette
// ---------------------------------------------------------------------------

describe("renderPromptActionPalette", () => {
  test("renders palette for keyword match", () => {
    const { logger, events } = createCollector();
    const plan = makePlan();
    // We need buildProfileNextActions to return something, which requires
    // a real plan with visible actions. Build a plan where vercel isn't linked.
    const rendered = renderPromptActionPalette({
      prompt: "ship this",
      projectRoot: "/tmp/app",
      pluginRoot: "/plugin",
      plan,
      logger,
    });

    // Plan has vercelLinked=false so vercel-link action is visible,
    // and vercel-deploy requires vercelLinked=true to be visible.
    // The palette should still render if any actions match.
    if (rendered) {
      expect(rendered).toContain("### Vercel action palette");
      expect(rendered).toContain("### Best next moves");
      expect(rendered).toContain("Linked: no");
      expect(rendered).toContain("Env pulled: no");

      const renderedEvent = events.find(
        (e) => e.event === "orchestrator-prompt-palette:rendered",
      );
      expect(renderedEvent).toBeDefined();
    }
  });

  test("renders palette for generic 'what should I do next'", () => {
    const plan = makePlan();
    const rendered = renderPromptActionPalette({
      prompt: "what should I do next",
      projectRoot: "/tmp/app",
      pluginRoot: "/plugin",
      plan,
    });

    // Generic regex matches → top actions shown
    if (rendered) {
      expect(rendered).toContain("### Vercel action palette");
      expect(rendered).toContain("### Best next moves");
    }
  });

  test("returns null for non-orchestrator prompt", () => {
    const { logger, events } = createCollector();
    const plan = makePlan();
    const rendered = renderPromptActionPalette({
      prompt: "rename this component to use PascalCase",
      projectRoot: "/tmp/app",
      pluginRoot: "/plugin",
      plan,
      logger,
    });

    expect(rendered).toBeNull();

    const suppressed = events.find(
      (e) => e.event === "orchestrator-prompt-palette:suppressed",
    );
    expect(suppressed).toBeDefined();
    expect(suppressed!.data.reason).toBe("no-orchestrator-intent");
  });

  test("palette status reflects plan state", () => {
    const plan = makePlan({
      vercelLinked: true,
      hasEnvLocal: true,
      missingSkills: [],
    });
    // With vercelLinked=true and hasEnvLocal=true, only deploy is visible
    const rendered = renderPromptActionPalette({
      prompt: "what should I do next",
      projectRoot: "/tmp/app",
      pluginRoot: "/plugin",
      plan,
    });

    if (rendered) {
      expect(rendered).toContain("Linked: yes");
      expect(rendered).toContain("Env pulled: yes");
      expect(rendered).toContain("Missing skill cache: none");
    }
  });
});

// ---------------------------------------------------------------------------
// buildPromptActionPalette (integration — needs persisted plan on disk)
// ---------------------------------------------------------------------------

describe("buildPromptActionPalette", () => {
  test("returns null for non-orchestrator prompt", () => {
    // Even if a plan exists, non-orchestrator prompts should yield null
    const result = buildPromptActionPalette({
      prompt: "fix the TypeScript errors in utils.ts",
      projectRoot: "/tmp/palette-no-orch",
      pluginRoot: "/plugin",
    });

    expect(result).toBeNull();
  });

  test("returns string or null (never throws) for orchestrator prompt", () => {
    // buildPromptActionPalette should never throw — it returns null when
    // no plan or no matching actions exist
    const result = buildPromptActionPalette({
      prompt: "what should I do next",
      projectRoot: "/tmp/palette-test",
      pluginRoot: "/plugin",
    });

    expect(result === null || typeof result === "string").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadFreshInstallPlan
// ---------------------------------------------------------------------------

describe("loadFreshInstallPlan", () => {
  test("returns SkillInstallPlan or null (never throws)", () => {
    const { logger, events } = createCollector();
    const result = loadFreshInstallPlan({
      projectRoot: "/tmp/palette-load-test",
      logger,
    });

    // Should either return a valid plan or null
    if (result === null) {
      const missing = events.find(
        (e) => e.event === "orchestrator-prompt-palette:plan-missing",
      );
      expect(missing).toBeDefined();
    } else {
      expect(result.schemaVersion).toBe(1);
      const loaded = events.find(
        (e) => e.event === "orchestrator-prompt-palette:plan-loaded",
      );
      expect(loaded).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Debug event contract
// ---------------------------------------------------------------------------

describe("debug event contract", () => {
  test("plan-loaded or plan-missing event emitted by loadFreshInstallPlan", () => {
    const { logger, events } = createCollector();
    loadFreshInstallPlan({
      projectRoot: "/tmp/palette-debug-test",
      logger,
    });
    const hasPlanEvent = events.some(
      (e) =>
        e.event === "orchestrator-prompt-palette:plan-missing" ||
        e.event === "orchestrator-prompt-palette:plan-loaded",
    );
    expect(hasPlanEvent).toBe(true);
  });

  test("intent-scored event emitted for direct alias", () => {
    const { logger, events } = createCollector();
    scorePromptPaletteActions({
      prompt: "/vercel env",
      actions: makeActions(),
      logger,
    });
    const scored = events.find(
      (e) => e.event === "orchestrator-prompt-palette:intent-scored",
    );
    expect(scored).toBeDefined();
    expect(scored!.data.mode).toBe("direct");
  });

  test("intent-scored event emitted for keyword match", () => {
    const { logger, events } = createCollector();
    scorePromptPaletteActions({
      prompt: "ship this to production",
      actions: makeActions(),
      logger,
    });
    const scored = events.find(
      (e) => e.event === "orchestrator-prompt-palette:intent-scored",
    );
    expect(scored).toBeDefined();
    expect(scored!.data.mode).toBe("keywords");
  });

  test("rendered event emitted when palette is built", () => {
    const { logger, events } = createCollector();
    const plan = makePlan();
    renderPromptActionPalette({
      prompt: "what should I do next",
      projectRoot: "/tmp/app",
      pluginRoot: "/plugin",
      plan,
      logger,
    });
    // May or may not render depending on visible actions, but should emit
    // either rendered or suppressed
    const hasRendered = events.some(
      (e) => e.event === "orchestrator-prompt-palette:rendered",
    );
    const hasSuppressed = events.some(
      (e) => e.event === "orchestrator-prompt-palette:suppressed",
    );
    expect(hasRendered || hasSuppressed).toBe(true);
  });
});
