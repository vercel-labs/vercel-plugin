/**
 * Test helper: creates a temporary ~/.vercel-plugin/ mock directory
 * populated with minimal SKILL.md stubs derived from skill-rules.json.
 *
 * Usage in tests:
 *   const cache = createMockSkillCache();
 *   // pass cache.homeDir as VERCEL_PLUGIN_HOME_DIR env var
 *   // call cache.cleanup() in afterAll
 */

import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..", "..");
const RULES_PATH = join(ROOT, "generated", "skill-rules.json");

interface SkillRule {
  priority: number;
  summary: string;
  docs?: string[];
  pathPatterns?: string[];
  bashPatterns?: string[];
  importPatterns?: string[];
  pathRegexSources?: string[];
  bashRegexSources?: string[];
  importRegexSources?: string[];
  promptSignals?: {
    phrases?: string[];
    allOf?: string[][];
    anyOf?: string[];
    noneOf?: string[];
    minScore?: number;
  };
  validate?: Array<{
    pattern: string;
    message: string;
    severity?: string;
    skipIfFileContains?: string;
  }>;
  chainTo?: Array<{
    pattern: string;
    targetSkill: string;
    message: string;
  }>;
}

interface RulesManifest {
  version: number;
  skills: Record<string, SkillRule>;
}

export interface MockSkillCache {
  homeDir: string;
  globalSkillsDir: string;
  cleanup: () => void;
  env: Record<string, string>;
}

/**
 * Creates a temp dir mimicking ~/.vercel-plugin/skills/ with stub SKILL.md
 * files for every skill in skill-rules.json.
 */
export function createMockSkillCache(): MockSkillCache {
  const homeDir = join(
    tmpdir(),
    `mock-vp-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const globalSkillsDir = join(homeDir, ".vercel-plugin", "skills");

  const rules: RulesManifest = JSON.parse(
    readFileSync(RULES_PATH, "utf-8"),
  );

  for (const [slug, rule] of Object.entries(rules.skills)) {
    const skillDir = join(globalSkillsDir, slug);
    mkdirSync(skillDir, { recursive: true });

    // Build a minimal SKILL.md with valid frontmatter + stub body
    const frontmatter = buildFrontmatter(slug, rule);
    const body = rule.summary || `Guidance for ${slug}.`;
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\n${frontmatter}---\n\n# ${slug}\n\n${body}\n`,
    );
  }

  return {
    homeDir,
    globalSkillsDir,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true }),
    env: {
      VERCEL_PLUGIN_HOME_DIR: homeDir,
    },
  };
}

function buildFrontmatter(slug: string, rule: SkillRule): string {
  const lines: string[] = [];
  lines.push(`name: ${slug}`);
  lines.push(`description: "Stub skill for ${slug}"`);
  lines.push(`summary: "${(rule.summary || `${slug} guidance`).replace(/"/g, '\\"')}"`);

  lines.push(`metadata:`);
  lines.push(`  priority: ${rule.priority}`);

  if (rule.docs?.length) {
    lines.push(`  docs: ${JSON.stringify(rule.docs)}`);
  }

  if (rule.pathPatterns?.length) {
    lines.push(`  pathPatterns:`);
    for (const p of rule.pathPatterns) {
      lines.push(`    - "${p}"`);
    }
  }

  if (rule.bashPatterns?.length) {
    lines.push(`  bashPatterns:`);
    for (const p of rule.bashPatterns) {
      lines.push(`    - "${p.replace(/\\/g, "\\\\")}"`);
    }
  }

  if (rule.importPatterns?.length) {
    lines.push(`  importPatterns:`);
    for (const p of rule.importPatterns) {
      lines.push(`    - "${p}"`);
    }
  }

  if (rule.promptSignals) {
    lines.push(`  promptSignals:`);
    if (rule.promptSignals.phrases?.length) {
      lines.push(`    phrases:`);
      for (const p of rule.promptSignals.phrases) {
        lines.push(`      - "${p.replace(/"/g, '\\"')}"`);
      }
    }
    if (rule.promptSignals.minScore !== undefined) {
      lines.push(`    minScore: ${rule.promptSignals.minScore}`);
    }
  }

  if (rule.validate?.length) {
    lines.push(`  validate:`);
    for (const v of rule.validate) {
      lines.push(`    - pattern: "${v.pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
      lines.push(`      message: "${v.message.replace(/"/g, '\\"')}"`);
      if (v.severity) lines.push(`      severity: "${v.severity}"`);
      if (v.skipIfFileContains) lines.push(`      skipIfFileContains: "${v.skipIfFileContains.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    }
  }

  if (rule.chainTo?.length) {
    lines.push(`  chainTo:`);
    for (const c of rule.chainTo) {
      lines.push(`    - pattern: "${c.pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
      lines.push(`      targetSkill: "${c.targetSkill}"`);
      lines.push(`      message: "${c.message.replace(/"/g, '\\"')}"`);
    }
  }

  return lines.join("\n") + "\n";
}
