import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillMap, extractFrontmatter, parseSkillFrontmatter, scanSkillsDir } from "./skill-map-frontmatter.mjs";

describe("skill-map frontmatter regression coverage", () => {
  it("extractFrontmatter should strip BOM and split frontmatter/body", () => {
    const markdown = "\uFEFF---\nname: ai-sdk\ndescription: AI SDK skill\n---\n# Markdown body\n";

    const { yaml, body } = extractFrontmatter(markdown);

    expect(yaml).toBe("name: ai-sdk\ndescription: AI SDK skill");
    expect(body).toBe("# Markdown body\n");
  });

  it("parseSkillFrontmatter should parse nested metadata with block-list arrays", () => {
    const yaml = [
      "name: ai-sdk",
      "description: AI SDK skill",
      "metadata:",
      "  priority: 8",
      "  filePattern:",
      "    - app/api/chat/**",
      "    - src/lib/ai/**",
    ].join("\n");

    const parsed = parseSkillFrontmatter(yaml);

    expect(parsed.name).toBe("ai-sdk");
    expect(parsed.metadata.priority).toBe(8);
    expect(typeof parsed.metadata.priority).toBe("number");
    expect(parsed.metadata.filePattern).toEqual(["app/api/chat/**", "src/lib/ai/**"]);
    expect(parsed.metadata.filePattern?.every((item) => typeof item === "string")).toBe(true);
  });

  it("parseSkillFrontmatter should parse inline arrays and preserve regex-like strings", () => {
    const yaml = [
      "name: ai-sdk",
      "metadata:",
      "  bashPattern: ['^bun test$', '^pnpm lint$']",
    ].join("\n");

    const parsed = parseSkillFrontmatter(yaml);

    expect(parsed.metadata.bashPattern).toEqual(["^bun test$", "^pnpm lint$"]);
  });

  it("buildSkillMap should preserve scalar metadata.filePattern coercion", () => {
    const root = mkdtempSync(join(tmpdir(), "vercel-plugin-skillmap-"));

    try {
      const fooDir = join(root, "foo");
      mkdirSync(fooDir, { recursive: true });
      writeFileSync(
        join(fooDir, "SKILL.md"),
        [
          "---",
          "name: foo",
          "metadata:",
          "  filePattern: app/api/chat/**",
          "---",
          "# Foo",
        ].join("\n"),
      );

      const result = buildSkillMap(root);

      expect(result.skills.foo.pathPatterns).toEqual(["app/api/chat/**"]);
      expect(
        result.warnings.some((warning) => warning.includes("metadata.filePattern is a string, coercing to array")),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scanSkillsDir should report invalid YAML via diagnostics instead of throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "vercel-plugin-skillmap-"));

    try {
      const brokenDir = join(root, "broken");
      mkdirSync(brokenDir, { recursive: true });
      writeFileSync(
        join(brokenDir, "SKILL.md"),
        [
          "---",
          "name: broken",
          "metadata:",
          "\tpriority: 3",
          "---",
          "# Broken",
        ].join("\n"),
      );

      const result = scanSkillsDir(root);

      expect(result.diagnostics.length).toBe(1);
      expect(result.skills.length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
