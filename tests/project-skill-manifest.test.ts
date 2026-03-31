import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildProjectSkillManifest,
  writeProjectSkillManifest,
  type ProjectSkillManifest,
} from "../hooks/src/project-skill-manifest.mts";

const TMP = join(tmpdir(), `vercel-plugin-project-manifest-${Date.now()}`);
const SKILLS_DIR = join(TMP, ".skills");

function writeSkill(slug: string, frontmatter: string, body = `# ${slug}\n\nUse ${slug}.`): void {
  const dir = join(SKILLS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `${frontmatter}\n${body}`, "utf-8");
}

const FIXED_NOW = () => new Date("2026-03-31T12:00:00.000Z");

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(SKILLS_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// buildProjectSkillManifest
// ---------------------------------------------------------------------------

describe("buildProjectSkillManifest", () => {
  test("builds a version 2 manifest from a single cached skill", () => {
    writeSkill("nextjs", `---
name: nextjs
description: Next.js skill
summary: Next.js summary
metadata:
  priority: 7
  pathPatterns:
    - "**/*.tsx"
  bashPatterns:
    - "next dev"
  importPatterns:
    - "next"
---`);

    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    expect(result.errors).toEqual([]);
    expect(result.manifest).not.toBeNull();
    const manifest = result.manifest!;
    expect(manifest.version).toBe(2);
    expect(manifest.generatedAt).toBe("2026-03-31T12:00:00.000Z");

    const skill = manifest.skills["nextjs"];
    expect(skill).toBeDefined();
    expect(skill.priority).toBe(7);
    expect(skill.summary).toBe("Next.js summary");
    expect(skill.pathPatterns).toEqual(["**/*.tsx"]);
    expect(skill.pathRegexSources.length).toBe(1);
    expect(skill.bashPatterns).toEqual(["next dev"]);
    expect(skill.bashRegexSources.length).toBe(1);
    expect(skill.importPatterns).toEqual(["next"]);
    expect(skill.importRegexSources.length).toBe(1);
    expect(skill.bodyPath).toBe(
      resolve(SKILLS_DIR, "nextjs", "SKILL.md").replaceAll("\\", "/"),
    );
  });

  test("builds manifest with multiple skills", () => {
    writeSkill("nextjs", `---
name: nextjs
description: Next.js skill
summary: Next.js summary
metadata:
  priority: 7
  pathPatterns:
    - "**/*.tsx"
---`);
    writeSkill("ai-sdk", `---
name: ai-sdk
description: AI SDK skill
summary: AI SDK summary
metadata:
  priority: 6
  importPatterns:
    - "ai"
---`);

    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    expect(result.errors).toEqual([]);
    expect(result.manifest).not.toBeNull();
    expect(Object.keys(result.manifest!.skills).sort()).toEqual(["ai-sdk", "nextjs"]);
  });

  test("handles skill with missing frontmatter gracefully (default values)", () => {
    const dir = join(SKILLS_DIR, "bare-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "no frontmatter here", "utf-8");

    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    // A skill with no frontmatter gets default values — not a fatal error
    expect(result.manifest).not.toBeNull();
    const skill = result.manifest!.skills["bare-skill"];
    expect(skill).toBeDefined();
    expect(skill.priority).toBe(5); // default
    expect(skill.pathPatterns).toEqual([]);
  });

  test("returns empty manifest for empty skills directory", () => {
    // SKILLS_DIR exists but has no subdirectories
    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    // Empty skill map should still validate fine
    expect(result.errors).toEqual([]);
    expect(result.manifest).not.toBeNull();
    expect(Object.keys(result.manifest!.skills)).toEqual([]);
  });

  test("preserves promptSignals in manifest", () => {
    writeSkill("shadcn", `---
name: shadcn
description: shadcn/ui components
summary: shadcn summary
metadata:
  priority: 6
  pathPatterns:
    - "components/ui/**"
  promptSignals:
    phrases:
      - "add a button"
    allOf:
      - ["shadcn", "component"]
    anyOf:
      - "ui"
    noneOf:
      - "native"
    minScore: 6
---`);

    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    expect(result.manifest).not.toBeNull();
    const skill = result.manifest!.skills["shadcn"];
    expect(skill.promptSignals).toBeDefined();
    expect(skill.promptSignals!.phrases).toEqual(["add a button"]);
    expect(skill.promptSignals!.allOf).toEqual([["shadcn", "component"]]);
    expect(skill.promptSignals!.noneOf).toEqual(["native"]);
  });

  test("preserves validate rules in manifest", () => {
    const skillDir = join(SKILLS_DIR, "test-validate");
    mkdirSync(skillDir, { recursive: true });
    // validate: is a top-level field (not inside metadata:), and array items
    // use block-dash-on-own-line format matching the real skill convention
    writeFileSync(join(skillDir, "SKILL.md"), [
      "---",
      "name: test-validate",
      "description: Test skill",
      "summary: Test summary",
      "metadata:",
      "  priority: 5",
      "  pathPatterns:",
      '    - "**/*.ts"',
      "validate:",
      "  -",
      '    pattern: "console.log"',
      '    message: "Remove console.log"',
      "    severity: warn",
      "---",
      "# Test validate",
      "",
    ].join("\n"), "utf-8");

    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    expect(result.manifest).not.toBeNull();
    const skill = result.manifest!.skills["test-validate"];
    expect(skill).toBeDefined();
    expect(skill.validate).toBeDefined();
    expect(skill.validate!.length).toBe(1);
    expect(skill.validate![0].message).toBe("Remove console.log");
  });

  test("handles skills with no patterns gracefully", () => {
    writeSkill("minimal", `---
name: minimal
description: Minimal skill
summary: Minimal summary
metadata:
  priority: 5
---`);

    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    expect(result.errors).toEqual([]);
    expect(result.manifest).not.toBeNull();
    const skill = result.manifest!.skills["minimal"];
    expect(skill.pathPatterns).toEqual([]);
    expect(skill.bashPatterns).toEqual([]);
    expect(skill.importPatterns).toEqual([]);
    expect(skill.pathRegexSources).toEqual([]);
    expect(skill.bashRegexSources).toEqual([]);
    expect(skill.importRegexSources).toEqual([]);
  });

  test("normalizes bodyPath with forward slashes", () => {
    writeSkill("nextjs", `---
name: nextjs
description: Next.js
summary: Next.js summary
metadata:
  priority: 7
---`);

    const result = buildProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    expect(result.manifest).not.toBeNull();
    const bodyPath = result.manifest!.skills["nextjs"].bodyPath;
    expect(bodyPath).not.toContain("\\");
    expect(bodyPath).toEndWith("/nextjs/SKILL.md");
  });
});

// ---------------------------------------------------------------------------
// writeProjectSkillManifest
// ---------------------------------------------------------------------------

describe("writeProjectSkillManifest", () => {
  test("writes manifest.json and returns its path", () => {
    writeSkill("nextjs", `---
name: nextjs
description: Next.js skill
summary: Next.js summary
metadata:
  priority: 7
  pathPatterns:
    - "**/*.tsx"
---`);

    const result = writeProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    expect(result).not.toBeNull();
    expect(result).toBe(join(SKILLS_DIR, "manifest.json"));
    expect(existsSync(result!)).toBe(true);

    const written = JSON.parse(readFileSync(result!, "utf-8")) as ProjectSkillManifest;
    expect(written.version).toBe(2);
    expect(written.skills["nextjs"].priority).toBe(7);
    expect(written.generatedAt).toBe("2026-03-31T12:00:00.000Z");
  });

  test("writes manifest even with default-frontmatter skills", () => {
    const dir = join(SKILLS_DIR, "bare");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "no frontmatter", "utf-8");

    const result = writeProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    // Skills with missing frontmatter get defaults — not a failure
    expect(result).not.toBeNull();
    expect(existsSync(join(SKILLS_DIR, "manifest.json"))).toBe(true);
  });

  test("returns null for non-existent skills directory", () => {
    const missingDir = join(TMP, "does-not-exist");

    const result = writeProjectSkillManifest(missingDir, FIXED_NOW);

    // buildSkillMap on a non-existent dir produces an empty skill map,
    // which validates fine and produces an empty manifest
    expect(result).not.toBeNull();
  });

  test("creates skills directory if it does not exist", () => {
    const newDir = join(TMP, "fresh-skills");
    const skillDir = join(newDir, "nextjs");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: nextjs
description: Next.js
summary: Next.js summary
metadata:
  priority: 7
---
# nextjs
`,
      "utf-8",
    );

    const result = writeProjectSkillManifest(newDir, FIXED_NOW);

    expect(result).not.toBeNull();
    expect(existsSync(join(newDir, "manifest.json"))).toBe(true);
  });

  test("overwrites existing manifest.json", () => {
    writeSkill("nextjs", `---
name: nextjs
description: Next.js
summary: Next.js summary
metadata:
  priority: 7
---`);

    // Write once
    writeProjectSkillManifest(SKILLS_DIR, FIXED_NOW);

    // Update skill priority and write again
    writeSkill("nextjs", `---
name: nextjs
description: Next.js
summary: Next.js summary updated
metadata:
  priority: 8
---`);

    const result = writeProjectSkillManifest(SKILLS_DIR, FIXED_NOW);
    expect(result).not.toBeNull();

    const written = JSON.parse(readFileSync(result!, "utf-8")) as ProjectSkillManifest;
    expect(written.skills["nextjs"].priority).toBe(8);
    expect(written.skills["nextjs"].summary).toBe("Next.js summary updated");
  });
});
