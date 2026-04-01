import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildManifest } from "../scripts/build-manifest.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");

function countSkillDirs(): number {
  return readdirSync(SKILLS_DIR).filter((entry) =>
    existsSync(join(SKILLS_DIR, entry, "SKILL.md")),
  ).length;
}

describe("build-manifest", () => {
  test("emits v3 rules manifest without bodyPath", () => {
    const { manifest, errors } = buildManifest(SKILLS_DIR);

    expect(errors).toEqual([]);
    expect(manifest.version).toBe(3);
    expect(Object.keys(manifest.skills).length).toBe(countSkillDirs());

    for (const config of Object.values(manifest.skills) as Record<
      string,
      unknown
    >[]) {
      expect("bodyPath" in config).toBe(false);
      expect(typeof config.summary).toBe("string");
    }
  });

  test("keeps compiled regex metadata in sync with trigger patterns", () => {
    const { manifest, errors } = buildManifest(SKILLS_DIR);

    expect(errors).toEqual([]);

    for (const skill of Object.values(manifest.skills)) {
      expect(skill.pathRegexSources.length).toBe(skill.pathPatterns.length);
      expect(skill.bashRegexSources.length).toBe(skill.bashPatterns.length);
      expect(skill.importRegexSources.length).toBe(skill.importPatterns.length);
    }
  });
});
