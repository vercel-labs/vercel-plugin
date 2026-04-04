import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveProjectStatePaths } from "../hooks/src/project-state-paths.mts";
import {
  resolveSessionStartSkillEntries,
  buildSessionStartBlock,
  computeSessionTier,
} from "../hooks/src/session-start-engine-context.mts";
import {
  buildMinimalContext,
  buildStandardContext,
} from "../hooks/src/subagent-start-bootstrap.mts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe("bootstrap cache fidelity", () => {
  let tempRoot: string;
  let pluginRoot: string;
  let projectRoot: string;
  let homeRoot: string;
  let envSnapshot: NodeJS.ProcessEnv;
  let cwdSnapshot: string;

  beforeEach(() => {
    envSnapshot = { ...process.env };
    cwdSnapshot = process.cwd();

    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "vercel-plugin-bootstrap-")));
    pluginRoot = join(tempRoot, "plugin");
    projectRoot = join(tempRoot, "project");
    homeRoot = join(tempRoot, "home");

    mkdirSync(join(pluginRoot, "generated"), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(homeRoot, { recursive: true });

    process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
    process.env.VERCEL_PLUGIN_HOME_DIR = homeRoot;
    process.chdir(projectRoot);

    // Write a minimal rules manifest that knows about ai-sdk
    writeJson(join(pluginRoot, "generated", "skill-rules.json"), {
      version: 3,
      generatedAt: "2026-04-04T00:00:00.000Z",
      skills: {
        "ai-sdk": {
          priority: 8,
          summary: "Build AI features with the AI SDK.",
          sessionStartEligible: "body",
          hasRealBody: true,
          pathPatterns: [],
          pathRegexSources: [],
          bashPatterns: [],
          bashRegexSources: [],
          importPatterns: [],
          importRegexSources: [],
        },
      },
    });

    // Write the cached skill body into the hashed project cache
    const statePaths = resolveProjectStatePaths(projectRoot);
    mkdirSync(join(statePaths.skillsDir, "ai-sdk"), { recursive: true });
    // Body must be > 100 chars so the sessionStartEligible heuristic resolves to "body"
    // when the live scan path doesn't carry sessionStartEligible from frontmatter.
    const skillBody = [
      "# AI SDK",
      "",
      "Use streamText() for server responses.",
      "Use generateText() for one-shot completions.",
      "Use streamObject() for structured streaming.",
      "Use embed() for vector embeddings.",
      "",
    ].join("\n");
    writeFileSync(
      join(statePaths.skillsDir, "ai-sdk", "SKILL.md"),
      [
        "---",
        "name: ai-sdk",
        "summary: Build AI features with the AI SDK.",
        "---",
        skillBody,
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(() => {
    process.chdir(cwdSnapshot);
    restoreEnv(envSnapshot);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("session-start tier 3 resolves body from the layered cache", () => {
    const entries = resolveSessionStartSkillEntries(projectRoot, ["ai-sdk"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toContain("Use streamText()");
    expect(entries[0]?.source).toBe("project-cache");

    const block = buildSessionStartBlock(3, ["ai-sdk"], [], entries);
    expect(block).toContain("### Loaded now");
    expect(block).toContain("`ai-sdk` from project-cache");
    expect(block).toContain("Use streamText()");
  });

  test("weak project produces summary-only state", () => {
    // Tier 1: one weak detection, no strong signals
    const detections = [
      { skill: "ai-sdk", reasons: [{ kind: "dependency" as const, source: "some-pkg", detail: "weak" }] },
    ];
    const tier = computeSessionTier(detections, []);
    expect(tier).toBe(1);

    const entries = resolveSessionStartSkillEntries(projectRoot, ["ai-sdk"]);
    // Tier < 3 means buildSessionStartBlock will NOT select a body
    const block = buildSessionStartBlock(tier, ["ai-sdk"], [], entries);
    expect(block).toContain('state="summary-only"');
    expect(block).not.toContain("### Loaded now");
    expect(block).toContain("### Ready now");
  });

  test("greenfield with no likely skills emits only greenfield block", () => {
    // Tier 0 with greenfield = true: no skill entries, just greenfield context
    const detections: { skill: string; reasons: { kind: string; source: string; detail: string }[] }[] = [];
    const tier = computeSessionTier(detections, ["greenfield"]);
    expect(tier).toBe(0);

    // With tier 0 and no skills, buildSessionStartBlock is never called.
    // The greenfield block is emitted separately by main(). Verify the tier logic.
    // We can still verify that buildSessionStartBlock with tier 0 produces summary-only
    // (no body selected) if it were called:
    const block = buildSessionStartBlock(0, [], ["greenfield"], []);
    expect(block).toContain('state="summary-only"');
    expect(block).not.toContain("### Loaded now");
  });

  test("subagent bootstrap only reports skills that were actually included", () => {
    const minimal = buildMinimalContext("Explore", ["ai-sdk"]);
    expect(minimal.includedSkills).toEqual([]);

    const standard = buildStandardContext(
      "GeneralPurpose",
      ["ai-sdk"],
      8_000,
    );
    expect(standard.includedSkills).toEqual(["ai-sdk"]);
    expect(standard.context).toContain("Use streamText()");
  });
});
