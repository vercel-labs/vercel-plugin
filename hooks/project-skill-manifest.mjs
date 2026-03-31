// hooks/src/project-skill-manifest.mts
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  buildSkillMap,
  validateSkillMap
} from "./skill-map-frontmatter.mjs";
import {
  globToRegex,
  importPatternToRegex
} from "./patterns.mjs";
function toBodyPath(skillsDir, slug) {
  return resolve(skillsDir, slug, "SKILL.md").replaceAll("\\", "/");
}
function compileRegexSources(config) {
  const pathPatterns = [];
  const pathRegexSources = [];
  for (const pattern of config.pathPatterns ?? []) {
    try {
      pathPatterns.push(pattern);
      pathRegexSources.push(globToRegex(pattern).source);
    } catch {
    }
  }
  const bashPatterns = [];
  const bashRegexSources = [];
  for (const pattern of config.bashPatterns ?? []) {
    try {
      new RegExp(pattern);
      bashPatterns.push(pattern);
      bashRegexSources.push(pattern);
    } catch {
    }
  }
  const importPatterns = [];
  const importRegexSources = [];
  for (const pattern of config.importPatterns ?? []) {
    try {
      const regex = importPatternToRegex(pattern);
      importPatterns.push(pattern);
      importRegexSources.push({ source: regex.source, flags: regex.flags });
    } catch {
    }
  }
  return {
    pathPatterns,
    pathRegexSources,
    bashPatterns,
    bashRegexSources,
    importPatterns,
    importRegexSources
  };
}
function buildProjectSkillManifest(skillsDir, now = () => /* @__PURE__ */ new Date()) {
  const built = buildSkillMap(skillsDir);
  const validation = validateSkillMap(built);
  const warnings = [
    ...built.warnings,
    ...validation.ok ? validation.warnings ?? [] : []
  ];
  if (!validation.ok) {
    return {
      manifest: null,
      warnings,
      errors: validation.errors
    };
  }
  const skills = {};
  for (const [slug, config] of Object.entries(
    validation.normalizedSkillMap.skills
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
      ...config.sitemap ? { sitemap: config.sitemap } : {},
      ...config.validate?.length ? { validate: config.validate } : {},
      ...config.chainTo?.length ? { chainTo: config.chainTo } : {},
      ...config.promptSignals ? { promptSignals: config.promptSignals } : {},
      ...config.retrieval ? { retrieval: config.retrieval } : {}
    };
  }
  return {
    manifest: {
      version: 2,
      generatedAt: now().toISOString(),
      skills
    },
    warnings,
    errors: []
  };
}
function writeProjectSkillManifest(skillsDir, now = () => /* @__PURE__ */ new Date()) {
  const result = buildProjectSkillManifest(skillsDir, now);
  if (!result.manifest) {
    return null;
  }
  mkdirSync(skillsDir, { recursive: true });
  const manifestPath = join(skillsDir, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(result.manifest, null, 2) + "\n",
    "utf-8"
  );
  return manifestPath;
}
export {
  buildProjectSkillManifest,
  writeProjectSkillManifest
};
