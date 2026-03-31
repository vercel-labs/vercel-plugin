/**
 * Runtime-safe per-project skill manifest writer.
 *
 * Builds a version-2 manifest from `.skills/<slug>/SKILL.md` cache entries
 * using the same `buildSkillMap()` / `validateSkillMap()` pipeline that the
 * build-time manifest uses — without importing build-time scripts.
 *
 * The output is written to `.skills/manifest.json` and consumed by
 * downstream hooks (PreToolUse, UserPromptSubmit) when the session is in
 * cache-only mode.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildSkillMap,
  validateSkillMap,
  type SkillConfig,
} from "./skill-map-frontmatter.mjs";
import {
  globToRegex,
  importPatternToRegex,
  type ManifestSkill,
} from "./patterns.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectManifestSkill extends ManifestSkill {
  bodyPath: string;
}

export interface ProjectSkillManifest {
  version: 2;
  generatedAt: string;
  skills: Record<string, ProjectManifestSkill>;
}

export interface ProjectSkillManifestBuildResult {
  manifest: ProjectSkillManifest | null;
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBodyPath(skillsDir: string, slug: string): string {
  return resolve(skillsDir, slug, "SKILL.md").replaceAll("\\", "/");
}

function compileRegexSources(config: SkillConfig): {
  pathPatterns: string[];
  pathRegexSources: string[];
  bashPatterns: string[];
  bashRegexSources: string[];
  importPatterns: string[];
  importRegexSources: Array<{ source: string; flags: string }>;
} {
  const pathPatterns: string[] = [];
  const pathRegexSources: string[] = [];
  for (const pattern of config.pathPatterns ?? []) {
    try {
      pathPatterns.push(pattern);
      pathRegexSources.push(globToRegex(pattern).source);
    } catch {
      // Validation already surfaces bad patterns.
    }
  }

  const bashPatterns: string[] = [];
  const bashRegexSources: string[] = [];
  for (const pattern of config.bashPatterns ?? []) {
    try {
      new RegExp(pattern);
      bashPatterns.push(pattern);
      bashRegexSources.push(pattern);
    } catch {
      // Validation already surfaces bad patterns.
    }
  }

  const importPatterns: string[] = [];
  const importRegexSources: Array<{ source: string; flags: string }> = [];
  for (const pattern of config.importPatterns ?? []) {
    try {
      const regex = importPatternToRegex(pattern);
      importPatterns.push(pattern);
      importRegexSources.push({ source: regex.source, flags: regex.flags });
    } catch {
      // Validation already surfaces bad patterns.
    }
  }

  return {
    pathPatterns,
    pathRegexSources,
    bashPatterns,
    bashRegexSources,
    importPatterns,
    importRegexSources,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildProjectSkillManifest(
  skillsDir: string,
  now: () => Date = () => new Date(),
): ProjectSkillManifestBuildResult {
  const built = buildSkillMap(skillsDir);
  const validation = validateSkillMap(built);

  const warnings = [
    ...built.warnings,
    ...(validation.ok ? (validation.warnings ?? []) : []),
  ];

  if (!validation.ok) {
    return {
      manifest: null,
      warnings,
      errors: validation.errors,
    };
  }

  const skills: Record<string, ProjectManifestSkill> = {};

  for (const [slug, config] of Object.entries(
    validation.normalizedSkillMap.skills,
  )) {
    const compiled = compileRegexSources(config);

    skills[slug] = {
      priority: config.priority,
      summary: config.summary,
      docs: config.docs,
      pathPatterns: compiled.pathPatterns,
      bashPatterns: compiled.bashPatterns,
      importPatterns: compiled.importPatterns,
      bodyPath: toBodyPath(skillsDir, slug),
      pathRegexSources: compiled.pathRegexSources,
      bashRegexSources: compiled.bashRegexSources,
      importRegexSources: compiled.importRegexSources,
      ...(config.sitemap ? { sitemap: config.sitemap } : {}),
      ...(config.validate?.length ? { validate: config.validate } : {}),
      ...(config.chainTo?.length ? { chainTo: config.chainTo } : {}),
      ...(config.promptSignals ? { promptSignals: config.promptSignals } : {}),
      ...(config.retrieval ? { retrieval: config.retrieval } : {}),
    };
  }

  return {
    manifest: {
      version: 2,
      generatedAt: now().toISOString(),
      skills,
    },
    warnings,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeProjectSkillManifest(
  skillsDir: string,
  now: () => Date = () => new Date(),
): string | null {
  const result = buildProjectSkillManifest(skillsDir, now);
  if (!result.manifest) {
    return null;
  }
  mkdirSync(skillsDir, { recursive: true });
  const manifestPath = join(skillsDir, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(result.manifest, null, 2) + "\n",
    "utf-8",
  );
  return manifestPath;
}
