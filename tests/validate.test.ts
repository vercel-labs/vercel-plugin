import { describe, test, expect } from "bun:test";
import { readdir, readFile, stat, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detectReDoS } from "../scripts/validate";

const ROOT = resolve(import.meta.dirname, "..");
const SYNTHETIC_TEST_SKILL_PREFIX = "zzz-test-";
const LOCAL_TEST_SKILL_PREFIXES = ["fake-", "micro", SYNTHETIC_TEST_SKILL_PREFIX];
const LOCAL_TEST_COMMAND_PREFIX = "test-";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isSyntheticTestSkillName(name: string): boolean {
  return name.startsWith(SYNTHETIC_TEST_SKILL_PREFIX);
}

function isLocalTestSkillName(name: string): boolean {
  return LOCAL_TEST_SKILL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isLocalTestArtifact(value: string | undefined): boolean {
  return typeof value === "string" && (
    LOCAL_TEST_SKILL_PREFIXES.some((prefix) => value.includes(prefix)) ||
    value.includes("/test-") ||
    value.includes("commands/test-")
  );
}

function issueMentionsSyntheticTestSkill(issue: {
  file?: string;
  message?: string;
  hint?: string;
}): boolean {
  return [issue.file, issue.message, issue.hint].some(
    (value) => isLocalTestArtifact(value),
  );
}

describe.serial("validate.ts", () => {
  test("repo has no non-synthetic validation errors", async () => {
    const { report } = await runValidateJson();
    const unexpectedErrors = report.issues.filter(
      (issue: any) => issue.severity === "error" && !issueMentionsSyntheticTestSkill(issue),
    );

    if (unexpectedErrors.length > 0) {
      console.error(JSON.stringify(unexpectedErrors, null, 2));
    }

    expect(unexpectedErrors).toEqual([]);
  }, 30_000);

  test("every graph skill ref resolves to an existing skill directory", async () => {
    const graphPath = join(ROOT, "vercel.md");
    const graph = await readFile(graphPath, "utf-8");
    const refs = [...new Set(
      [...graph.matchAll(/⤳\s*skill:\s*([a-z][a-z0-9-]*)/g)].map((m) => m[1]),
    )];

    expect(refs.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const name of refs) {
      if (!(await exists(join(ROOT, "skills", name, "SKILL.md")))) {
        missing.push(name);
      }
    }

    expect(missing).toEqual([]);
  });

  test("JSON report includes per-check timing metrics", async () => {
    const proc = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const report = JSON.parse(stdout);

    expect(report.metrics).toBeArray();
    expect(report.metrics.length).toBeGreaterThan(0);
    for (const m of report.metrics) {
      expect(typeof m.name).toBe("string");
      expect(typeof m.durationMs).toBe("number");
    }
  }, 30_000);

  test("JSON report includes checkResults array with correct shape", async () => {
    const proc = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const report = JSON.parse(stdout);

    expect(report.checkResults).toBeArray();
    expect(report.checkResults.length).toBeGreaterThan(0);
    for (const cr of report.checkResults) {
      expect(typeof cr.name).toBe("string");
      expect(typeof cr.label).toBe("string");
      expect(["pass", "fail", "warn"]).toContain(cr.status);
      expect(typeof cr.durationMs).toBe("number");
      expect(typeof cr.errorCount).toBe("number");
      expect(typeof cr.warningCount).toBe("number");
    }
    // checkResults count should match metrics count
    expect(report.checkResults.length).toBe(report.metrics.length);
  }, 30_000);

  test("every issue has a check field matching its source check", async () => {
    const proc = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const report = JSON.parse(stdout);

    const validCheckNames = new Set(report.checkResults.map((cr: any) => cr.name));
    for (const issue of report.issues) {
      expect(typeof issue.check).toBe("string");
      expect(issue.check.length).toBeGreaterThan(0);
      expect(validCheckNames.has(issue.check)).toBe(true);
    }
  }, 30_000);

  test("every issue has a non-empty hint field", async () => {
    const proc = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const report = JSON.parse(stdout);

    for (const issue of report.issues) {
      expect(issue.hint).toBeDefined();
      expect(typeof issue.hint).toBe("string");
      expect(issue.hint.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test("current state has 0 orphan skills", async () => {
    const graphPath = join(ROOT, "vercel.md");
    const graph = await readFile(graphPath, "utf-8");
    const referencedSkills = new Set(
      [...graph.matchAll(/⤳\s*skill:\s*([a-z][a-z0-9-]*)/g)].map((m) => m[1]),
    );

    const skillsDir = join(ROOT, "skills");
    const dirs = await readdir(skillsDir);
    const orphans: string[] = [];
    for (const dir of dirs.sort()) {
      if (isLocalTestSkillName(dir)) continue;
      if (!(await exists(join(skillsDir, dir, "SKILL.md")))) continue;
      if (!referencedSkills.has(dir)) orphans.push(dir);
    }

    expect(orphans).toEqual([]);
  });

  test("introducing an orphan skill causes validation failure", async () => {
    await withTempSkill(
      "fake-orphan-test-skill",
      [
        "---\nname: fake-orphan-test-skill\ndescription: test orphan\n---\nTest skill.\n",
      ].join(""),
      async () => {
        const proc = Bun.spawn(
          ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
          { stdout: "pipe", stderr: "pipe" },
        );
        const stdout = await new Response(proc.stdout).text();
        const code = await proc.exited;

        expect(code).not.toBe(0);

        const report = JSON.parse(stdout);
        expect(report.orphanSkills).toContain("fake-orphan-test-skill");
        const orphanIssue = report.issues.find((i: any) => i.code === "ORPHAN_SKILL" && i.message.includes("fake-orphan-test-skill"));
        expect(orphanIssue).toBeDefined();
        expect(orphanIssue.check).toBe("orphanSkills");
      },
    );
  }, 30_000);

  test("JSON report includes orphanSkills field", async () => {
    const proc = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const report = JSON.parse(stdout);

    expect(report.orphanSkills).toBeArray();
  }, 30_000);

  test("current commands pass command structure check", async () => {
    const commandsDir = join(ROOT, "commands");
    const cmdFiles = (await readdir(commandsDir))
      .filter((f: string) => f.endsWith(".md") && !f.startsWith("_") && !f.startsWith(LOCAL_TEST_COMMAND_PREFIX));

    expect(cmdFiles.length).toBeGreaterThan(0);

    for (const file of cmdFiles) {
      const content = await readFile(join(commandsDir, file), "utf-8");

      // Must have Preflight and Verification sections
      expect(content).toMatch(/^#{2,3}\s+.*Preflight/im);
      expect(content).toMatch(/^#{2,3}\s+.*Verification/im);

      // Must contain at least one backtick-fenced vercel CLI example
      const codeBlocks = [...content.matchAll(/```[a-z]*\n([\s\S]*?)```/g)];
      const hasVercelCli = codeBlocks.some((m) => /\bvercel\b/.test(m[1]));
      expect(hasVercelCli).toBe(true);
    }
  });

  test("command missing Verification section fails validation", async () => {
    await withTempCommand(
      "test-broken-cmd.md",
      [
        `---\ndescription: Test command missing Verification\n---\n\n# Test Command\n\n## Preflight\n\nCheck stuff.\n\n## Commands\n\n\`\`\`bash\nvercel ls\n\`\`\`\n\n## Summary\n\nDone.\n`,
      ].join(""),
      async () => {
        const proc = Bun.spawn(
          ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
          { stdout: "pipe", stderr: "pipe" },
        );
        const stdout = await new Response(proc.stdout).text();
        const code = await proc.exited;

        expect(code).not.toBe(0);

        const report = JSON.parse(stdout);
        const issue = report.issues.find(
          (i: any) =>
            i.code === "CMD_MISSING_CRITICAL_SECTIONS" &&
            i.message.includes("test-broken-cmd.md") &&
            i.message.includes("Verification"),
        );
        expect(issue).toBeDefined();
        expect(issue.file).toBe("commands/test-broken-cmd.md");
        expect(issue.hint).toBeDefined();
        expect(issue.hint.length).toBeGreaterThan(0);
        expect(issue.check).toBe("commandConventions");
      },
    );
  }, 30_000);

  test("SKILL.md with 'vercel logs drain ls' in code fence fails CLI_BANNED_PATTERN", async () => {
    await withTempSkill(
      "fake-banned-test-skill",
      [
        "---\nname: fake-banned-test-skill\ndescription: test banned\n---\n\n# Test\n\n```bash\nvercel logs drain ls\n```\n",
      ].join(""),
      async () => {
        const proc = Bun.spawn(
          ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
          { stdout: "pipe", stderr: "pipe" },
        );
        const stdout = await new Response(proc.stdout).text();
        const code = await proc.exited;

        expect(code).not.toBe(0);

        const report = JSON.parse(stdout);
        const issue = report.issues.find(
          (i: any) => i.code === "CLI_BANNED_PATTERN" && i.file?.includes("fake-banned-test-skill"),
        );
        expect(issue).toBeDefined();
        expect(issue.hint).toBeDefined();
        expect(issue.line).toBeGreaterThan(0);
      },
    );
  }, 30_000);

  test("command.md with 'vercel integration deploy' in code fence fails CLI_BANNED_PATTERN", async () => {
    await withTempCommand(
      "test-banned-cmd.md",
      [
        "---\ndescription: Test banned command\n---\n\n# Test\n\n## Preflight\n\nCheck.\n\n## Verification\n\nOK.\n\n## Commands\n\n```bash\nvercel integration deploy\n```\n",
      ].join(""),
      async () => {
        const proc = Bun.spawn(
          ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
          { stdout: "pipe", stderr: "pipe" },
        );
        const stdout = await new Response(proc.stdout).text();
        const code = await proc.exited;

        expect(code).not.toBe(0);

        const report = JSON.parse(stdout);
        const issue = report.issues.find(
          (i: any) => i.code === "CLI_BANNED_PATTERN" && i.file?.includes("test-banned-cmd.md"),
        );
        expect(issue).toBeDefined();
        expect(issue.hint).toBeDefined();
      },
    );
  }, 30_000);

  test("current repo has 0 CLI_BANNED_PATTERN issues", async () => {
    const proc = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const report = JSON.parse(stdout);

    const bannedIssues = report.issues.filter((i: any) => i.code === "CLI_BANNED_PATTERN");
    expect(bannedIssues).toEqual([]);
  }, 30_000);

  test("graph skill ref errors include line numbers", async () => {
    // Parse the graph directly and verify that lineOf produces numbers for skill refs
    const graphPath = join(ROOT, "vercel.md");
    const graph = await readFile(graphPath, "utf-8");
    const refs = [...graph.matchAll(/⤳\s*skill:\s*([a-z][a-z0-9-]*)/g)];

    expect(refs.length).toBeGreaterThan(0);

    for (const m of refs) {
      const idx = graph.indexOf(m[0]);
      const line = graph.slice(0, idx).split("\n").length;
      expect(line).toBeGreaterThan(0);
      expect(typeof line).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// Focused frontmatter validation tests
// ---------------------------------------------------------------------------

/** Helper: run validate in JSON mode, return parsed report + exit code */
async function runValidateJson(): Promise<{ code: number; report: any }> {
  const proc = Bun.spawn(
    ["bun", "run", join(ROOT, "scripts", "validate.ts"), "--format", "json", "--coverage", "skip"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, report: JSON.parse(stdout) };
}

/** Helper: create a temp skill dir with given SKILL.md content, run fn, then clean up */
async function withTempSkill(name: string, skillMd: string, fn: () => Promise<void>): Promise<void> {
  const dir = join(ROOT, "skills", name);
  const skillPath = join(dir, "SKILL.md");
  const hadOriginal = await exists(skillPath);
  const originalSkillMd = hadOriginal ? await readFile(skillPath, "utf-8") : null;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(skillPath, skillMd);
    await fn();
  } finally {
    if (hadOriginal && originalSkillMd !== null) {
      await writeFile(skillPath, originalSkillMd);
    } else {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

async function withTempCommand(name: string, commandMd: string, fn: () => Promise<void>): Promise<void> {
  const commandPath = join(ROOT, "commands", name);
  const hadOriginal = await exists(commandPath);
  const originalCommandMd = hadOriginal ? await readFile(commandPath, "utf-8") : null;
  try {
    await writeFile(commandPath, commandMd);
    await fn();
  } finally {
    if (hadOriginal && originalCommandMd !== null) {
      await writeFile(commandPath, originalCommandMd);
    } else {
      await rm(commandPath, { force: true });
    }
  }
}

describe.serial("validate.ts — focused frontmatter validation", () => {
  test("broken YAML frontmatter produces FM_INVALID_YAML", async () => {
    await withTempSkill("zzz-test-broken-yaml", [
      "---",
      "name: broken",
      "description: bad yaml",
      "\tmetadata: foo",
      "---",
      "# Broken",
    ].join("\n"), async () => {
      const { code, report } = await runValidateJson();
      expect(code).not.toBe(0);

      const issue = report.issues.find(
        (i: any) => i.code === "FM_INVALID_YAML" && i.message.includes("zzz-test-broken-yaml"),
      );
      expect(issue).toBeDefined();
      expect(issue.hint).toBeDefined();
    });
  }, 30_000);

  test("string pathPatterns produces FM_PATHPATTERNS_TYPE", async () => {
    await withTempSkill("zzz-test-string-filepattern", [
      "---",
      "name: string-fp",
      "description: pathPatterns is a bare string",
      "metadata:",
      "  pathPatterns: 'src/**/*.ts'",
      "---",
      "# String pathPatterns",
    ].join("\n"), async () => {
      const { code, report } = await runValidateJson();
      expect(code).not.toBe(0);

      const issue = report.issues.find(
        (i: any) => i.code === "FM_PATHPATTERNS_TYPE" && i.message.includes("zzz-test-string-filepattern"),
      );
      expect(issue).toBeDefined();
      expect(issue.hint).toMatch(/list/i);
    });
  }, 30_000);

  test("invalid bashPatterns regex produces PATTERN_BASH_COMPILE", async () => {
    await withTempSkill("zzz-test-bad-bash-regex", [
      "---",
      "name: bad-regex",
      "description: bashPatterns with invalid regex",
      "metadata:",
      "  bashPatterns:",
      "    - '[unclosed'",
      "  pathPatterns:",
      "    - '**/*.ts'",
      "---",
      "# Bad regex",
    ].join("\n"), async () => {
      const { code, report } = await runValidateJson();
      expect(code).not.toBe(0);

      const issue = report.issues.find(
        (i: any) => i.code === "PATTERN_BASH_COMPILE" && i.message.includes("zzz-test-bad-bash-regex"),
      );
      expect(issue).toBeDefined();
      expect(issue.hint).toMatch(/regex/i);
    });
  }, 30_000);

  test("SKILL.md with pathPatterns: [42] produces warning-level filtering (no crash)", async () => {
    await withTempSkill("zzz-test-nonstring-fp", [
      "---",
      "name: nonstring-fp",
      "description: pathPatterns has a number",
      "metadata:",
      "  pathPatterns:",
      "    - 42",
      "  bashPatterns:",
      "    - '\\\\bvercel\\\\b'",
      "---",
      "# Non-string pathPatterns",
    ].join("\n"), async () => {
      const { report } = await runValidateJson();
      // The number entry gets filtered out, leaving no triggers → SKILL_NO_TRIGGERS
      // but should NOT crash
      const crashIssues = report.issues.filter(
        (i: any) => i.message?.includes("zzz-test-nonstring-fp") && i.code === "FM_INVALID_YAML",
      );
      expect(crashIssues).toEqual([]);
    });
  }, 30_000);

  test("SKILL.md with pathPatterns: [''] produces warning-level filtering (no crash)", async () => {
    await withTempSkill("zzz-test-empty-fp", [
      "---",
      "name: empty-fp",
      "description: pathPatterns has an empty string",
      "metadata:",
      "  pathPatterns:",
      "    - ''",
      "  bashPatterns:",
      "    - '\\\\bvercel\\\\b'",
      "---",
      "# Empty pathPatterns",
    ].join("\n"), async () => {
      const { report } = await runValidateJson();
      const crashIssues = report.issues.filter(
        (i: any) => i.message?.includes("zzz-test-empty-fp") && i.code === "FM_INVALID_YAML",
      );
      expect(crashIssues).toEqual([]);
    });
  }, 30_000);

  test("metadata.name does not mask missing top-level name (FM_NO_NAME regression)", async () => {
    await withTempSkill("zzz-test-meta-name-mask", [
      "---",
      "description: has metadata.name but no top-level name",
      "metadata:",
      "  name: sneaky-name",
      "  pathPatterns:",
      "    - '**/*.ts'",
      "---",
      "# No top-level name",
    ].join("\n"), async () => {
      const { code, report } = await runValidateJson();
      expect(code).not.toBe(0);

      const issue = report.issues.find(
        (i: any) => i.code === "FM_NO_NAME" && i.message.includes("zzz-test-meta-name-mask"),
      );
      expect(issue).toBeDefined();
    });
  }, 30_000);

  test("string pathPatterns produces FM_PATHPATTERNS_TYPE via structured warningDetails", async () => {
    await withTempSkill("zzz-test-structured-fp", [
      "---",
      "name: structured-fp",
      "description: pathPatterns is a bare string (structured test)",
      "metadata:",
      "  pathPatterns: 'src/**/*.ts'",
      "---",
      "# Structured pathPatterns test",
    ].join("\n"), async () => {
      const { code, report } = await runValidateJson();
      expect(code).not.toBe(0);

      const issue = report.issues.find(
        (i: any) => i.code === "FM_PATHPATTERNS_TYPE" && i.message.includes("zzz-test-structured-fp"),
      );
      expect(issue).toBeDefined();
      // Verify the message includes ", got string" (from structured detail code path)
      expect(issue.message).toMatch(/got string/);
      expect(issue.hint).toBeDefined();
    });
  }, 30_000);

  test("clean SKILL.md with valid patterns produces no errors for that skill", async () => {
    await withTempSkill("zzz-test-clean-skill", [
      "---",
      "name: clean-skill",
      "description: A perfectly valid test skill",
      "metadata:",
      "  docs:",
      "    - 'https://example.com/clean-skill'",
      "  pathPatterns:",
      "    - '**/*.clean-skill-test'",
      "  bashPatterns:",
      "    - '\\bvercel-plugin-clean-skill\\b'",
      "  priority: 5",
      "---",
      "# Clean Skill",
      "",
      "This skill is well-formed.",
    ].join("\n"), async () => {
      const { report } = await runValidateJson();

      // The only issue for this skill should be ORPHAN_SKILL (no graph ref) — no frontmatter errors
      const fmIssues = report.issues.filter(
        (i: any) =>
          i.message?.includes("zzz-test-clean-skill") &&
          i.code !== "ORPHAN_SKILL" &&
          i.code !== "SKILL_NO_TRIGGERS" &&
          i.code !== "CATALOG_STALE",
      );
      expect(fmIssues).toEqual([]);
    });
  }, 30_000);

  test("bashPatterns with nested quantifiers produces PATTERN_BASH_REDOS", async () => {
    await withTempSkill("zzz-test-redos-pattern", [
      "---",
      "name: redos-pattern",
      "description: bashPatterns with catastrophic backtracking",
      "metadata:",
      "  pathPatterns:",
      "    - '**/*.ts'",
      "  bashPatterns:",
      "    - '(a+)+'",
      "---",
      "# ReDoS pattern",
    ].join("\n"), async () => {
      const { code, report } = await runValidateJson();
      expect(code).not.toBe(0);

      const issue = report.issues.find(
        (i: any) => i.code === "PATTERN_BASH_REDOS" && i.message.includes("zzz-test-redos-pattern"),
      );
      expect(issue).toBeDefined();
      expect(issue.message).toMatch(/nested quantifiers/);
      expect(issue.hint).toMatch(/rewrite/i);
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Catalog staleness tests
// ---------------------------------------------------------------------------

describe.serial("validate.ts — catalog staleness", () => {
  test("generate-catalog.ts runs successfully", async () => {
    const proc = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "generate-catalog.ts")],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(stderr);
    }
    expect(code).toBe(0);
    expect(await exists(join(ROOT, "generated", "skill-catalog.md"))).toBe(true);
  }, 30_000);

  test("generated catalog lists every non-synthetic skill from skills/ directory", async () => {
    // First regenerate to ensure freshness
    const gen = Bun.spawn(
      ["bun", "run", join(ROOT, "scripts", "generate-catalog.ts")],
      { stdout: "pipe", stderr: "pipe" },
    );
    await gen.exited;

    const catalog = await readFile(join(ROOT, "generated", "skill-catalog.md"), "utf-8");
    const skillsDir = join(ROOT, "skills");
    const dirs = await readdir(skillsDir);
    const skillDirs: string[] = [];
    for (const dir of dirs) {
      if (isLocalTestSkillName(dir)) continue;
      if (await exists(join(skillsDir, dir, "SKILL.md"))) {
        skillDirs.push(dir);
      }
    }

    // Every skill directory should appear in the catalog
    for (const dir of skillDirs) {
      expect(catalog).toContain(`\`${dir}\``);
    }
  }, 30_000);

  test("generated catalog contains overlap matrix sections", async () => {
    const catalog = await readFile(join(ROOT, "generated", "skill-catalog.md"), "utf-8");
    expect(catalog).toContain("## Path Overlap Matrix");
    expect(catalog).toContain("## Bash Overlap Matrix");
    expect(catalog).toContain("## Skills by Priority");
  });

  test("stale catalog (missing skill) triggers CATALOG_STALE in validation", async () => {
    // Create a temp skill that won't be in the existing catalog
    await withTempSkill("zzz-test-catalog-stale", [
      "---",
      "name: catalog-stale-test",
      "description: test catalog staleness detection",
      "metadata:",
      "  pathPatterns:",
      "    - '**/*.test-catalog-stale'",
      "---",
      "# Stale catalog test",
    ].join("\n"), async () => {
      // Do NOT regenerate the catalog — it should be stale now
      const { code, report } = await runValidateJson();
      expect(code).not.toBe(0);

      const issue = report.issues.find(
        (i: any) => i.code === "CATALOG_STALE" && i.message.includes("zzz-test-catalog-stale"),
      );
      expect(issue).toBeDefined();
      expect(issue.hint).toMatch(/generate-catalog/);
    });
  }, 30_000);

  test("catalog overlap matrix detects vercel.json contention", async () => {
    const catalog = await readFile(join(ROOT, "generated", "skill-catalog.md"), "utf-8");
    // vercel.json should have multiple competing skills
    const vercelJsonRow = catalog.match(/^\| `vercel\.json` \| (.+) \|$/m);
    expect(vercelJsonRow).not.toBeNull();
    // Should list at least 3 skills competing on vercel.json
    const skills = vercelJsonRow![1].split(",");
    expect(skills.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// detectReDoS unit tests
// ---------------------------------------------------------------------------

describe.serial("detectReDoS", () => {
  test("flags (a+)+ as nested quantifier", () => {
    expect(detectReDoS("(a+)+")).not.toBeNull();
  });

  test("flags (.*)*  as nested quantifier", () => {
    expect(detectReDoS("(.*)*")).not.toBeNull();
  });

  test("flags ([^/]+)+ as nested quantifier", () => {
    expect(detectReDoS("([^/]+)+")).not.toBeNull();
  });

  test("flags (\\w+)* as nested quantifier", () => {
    expect(detectReDoS("(\\w+)*")).not.toBeNull();
  });

  test("flags (a+){2,} as nested quantifier", () => {
    expect(detectReDoS("(a+){2,}")).not.toBeNull();
  });

  test("allows simple \\bvercel\\b", () => {
    expect(detectReDoS("\\bvercel\\b")).toBeNull();
  });

  test("allows non-nested [a-z]+", () => {
    expect(detectReDoS("[a-z]+")).toBeNull();
  });

  test("allows simple alternation without quantifier", () => {
    expect(detectReDoS("(foo|bar)")).toBeNull();
  });

  test("allows quantified group without inner quantifier", () => {
    expect(detectReDoS("(abc)+")).toBeNull();
  });

  test("flags quantified backreference \\1+", () => {
    expect(detectReDoS("(a)\\1+")).not.toBeNull();
  });
});
