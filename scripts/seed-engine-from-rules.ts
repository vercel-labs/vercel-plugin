#!/usr/bin/env bun
/**
 * One-shot: converts generated/skill-rules.json into engine/<skill>.md files.
 * Run once to seed the engine/ directory, then delete this script.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const RULES_PATH = join(ROOT, "generated", "skill-rules.json");
const ENGINE_DIR = join(ROOT, "engine");

const rules = JSON.parse(readFileSync(RULES_PATH, "utf-8"));

mkdirSync(ENGINE_DIR, { recursive: true });

for (const [slug, rule] of Object.entries(rules.skills) as [string, any][]) {
  if (slug === "zzz-test-empty-fp") continue; // skip test fixture

  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${slug}`);
  lines.push(`priority: ${rule.priority}`);

  // registry — where to fetch this skill from
  if (slug === "turborepo" || slug === "ai-sdk" || slug === "ai-elements" ||
      slug === "agent-browser" || slug === "next-cache-components" ||
      slug === "next-upgrade") {
    lines.push(`registry: vercel/vercel-skills`);
  }

  // docs
  if (rule.docs?.length) {
    if (rule.docs.length === 1) {
      lines.push(`docs: ${rule.docs[0]}`);
    } else {
      lines.push(`docs:`);
      for (const d of rule.docs) lines.push(`  - ${d}`);
    }
  }

  if (rule.sitemap) {
    lines.push(`sitemap: ${rule.sitemap}`);
  }

  // pathPatterns
  if (rule.pathPatterns?.length) {
    lines.push(`pathPatterns:`);
    for (const p of rule.pathPatterns) {
      lines.push(`  - "${p}"`);
    }
  }

  // bashPatterns
  if (rule.bashPatterns?.length) {
    lines.push(`bashPatterns:`);
    for (const p of rule.bashPatterns) {
      lines.push(`  - "${escapeYaml(p)}"`);
    }
  }

  // importPatterns
  if (rule.importPatterns?.length) {
    lines.push(`importPatterns:`);
    for (const p of rule.importPatterns) {
      lines.push(`  - "${p}"`);
    }
  }

  // promptSignals
  if (rule.promptSignals) {
    lines.push(`promptSignals:`);
    const ps = rule.promptSignals;
    if (ps.phrases?.length) {
      lines.push(`  phrases:`);
      for (const p of ps.phrases) lines.push(`    - "${escapeYaml(p)}"`);
    }
    if (ps.allOf?.length) {
      lines.push(`  allOf:`);
      for (const group of ps.allOf) {
        lines.push(`    - [${group.map((t: string) => `"${escapeYaml(t)}"`).join(", ")}]`);
      }
    }
    if (ps.anyOf?.length) {
      lines.push(`  anyOf:`);
      for (const p of ps.anyOf) lines.push(`    - "${escapeYaml(p)}"`);
    }
    if (ps.noneOf?.length) {
      lines.push(`  noneOf:`);
      for (const p of ps.noneOf) lines.push(`    - "${escapeYaml(p)}"`);
    }
    if (ps.minScore !== undefined) {
      lines.push(`  minScore: ${ps.minScore}`);
    }
  }

  // validate
  if (rule.validate?.length) {
    lines.push(`validate:`);
    for (const v of rule.validate) {
      lines.push(`  - pattern: "${escapeYaml(v.pattern)}"`);
      lines.push(`    message: "${escapeYaml(v.message)}"`);
      if (v.severity) lines.push(`    severity: ${v.severity}`);
      if (v.skipIfFileContains) lines.push(`    skipIfFileContains: "${escapeYaml(v.skipIfFileContains)}"`);
      if (v.upgradeToSkill) lines.push(`    upgradeToSkill: ${v.upgradeToSkill}`);
      if (v.upgradeWhy) lines.push(`    upgradeWhy: "${escapeYaml(v.upgradeWhy)}"`);
    }
  }

  // chainTo
  if (rule.chainTo?.length) {
    lines.push(`chainTo:`);
    for (const c of rule.chainTo) {
      if (c.synthesized) continue; // skip auto-synthesized ones
      lines.push(`  - pattern: "${escapeYaml(c.pattern)}"`);
      lines.push(`    targetSkill: ${c.targetSkill}`);
      lines.push(`    message: "${escapeYaml(c.message)}"`);
    }
  }

  // retrieval
  if (rule.retrieval) {
    const r = rule.retrieval;
    lines.push(`retrieval:`);
    if (r.aliases?.length) {
      lines.push(`  aliases: [${r.aliases.map((a: string) => `"${escapeYaml(a)}"`).join(", ")}]`);
    }
    if (r.intents?.length) {
      lines.push(`  intents: [${r.intents.map((i: string) => `"${escapeYaml(i)}"`).join(", ")}]`);
    }
    if (r.entities?.length) {
      lines.push(`  entities: [${r.entities.map((e: string) => `"${escapeYaml(e)}"`).join(", ")}]`);
    }
  }

  lines.push("---");
  lines.push("");

  // Body: summary or fallback description
  const summary = rule.summary?.trim();
  if (summary) {
    lines.push(summary);
  } else {
    lines.push(`Guidance for ${slug}. Install from registry for full content.`);
  }
  lines.push("");

  writeFileSync(join(ENGINE_DIR, `${slug}.md`), lines.join("\n"));
}

console.log(`Seeded ${Object.keys(rules.skills).length - 1} engine files to ${ENGINE_DIR}/`);

function escapeYaml(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
