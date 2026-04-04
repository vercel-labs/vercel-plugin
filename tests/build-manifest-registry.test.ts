import { describe, test, expect } from "bun:test";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..");
const manifestPath = join(ROOT, "generated", "skill-rules.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const skills: Record<string, any> = manifest.skills;

const REQUIRED_REGISTRY_SKILLS: Record<
  string,
  { registry: string; registrySlug?: string }
> = {
  "agent-browser": { registry: "vercel/vercel-skills" },
  "ai-elements": { registry: "vercel/vercel-skills" },
  "ai-sdk": { registry: "vercel/vercel-skills" },
  "next-cache-components": { registry: "vercel/vercel-skills" },
  "next-upgrade": { registry: "vercel/vercel-skills" },
  turborepo: { registry: "vercel/vercel-skills" },
  nextjs: {
    registry: "vercel/vercel-skills",
    registrySlug: "next-best-practices",
  },
  "react-best-practices": {
    registry: "vercel/vercel-skills",
    registrySlug: "vercel-react-best-practices",
  },
  "deployments-cicd": {
    registry: "vercel/vercel-skills",
    registrySlug: "vercel-deploy",
  },
  "vercel-cli": {
    registry: "vercel-labs/agent-skills",
    registrySlug: "vercel-cli-with-tokens",
  },
};

const KNOWN_NO_REGISTRY = [
  "auth",
  "env-vars",
  "vercel-storage",
  "observability",
  "ai-gateway",
  "vercel-functions",
  "routing-middleware",
  "chat-sdk",
  "vercel-sandbox",
  "workflow",
  "vercel-flags",
  "next-forge",
  "shadcn",
];

const ALLOWED_REGISTRIES = new Set([
  "vercel/vercel-skills",
  "vercel-labs/agent-skills",
]);

const LEGACY_REGISTRIES = [
  "vercel-labs/agent-browser",
  "vercel/ai-elements",
  "vercel/ai",
  "vercel/chat",
  "vercel-labs/next-skills",
  "vercel/turborepo",
  "vercel/workflow",
  "vercel/vercel",
  "vercel/flags",
  "vercel/next-forge",
  "vercel-labs/json-render",
];

describe("build-manifest registry metadata", () => {
  describe("required registry-backed skills have exact metadata", () => {
    for (const [slug, expected] of Object.entries(REQUIRED_REGISTRY_SKILLS)) {
      test(`${slug} -> ${expected.registry}${expected.registrySlug ? ` as ${expected.registrySlug}` : ""}`, () => {
        const skill = skills[slug];
        expect(skill).toBeDefined();
        expect(skill.registry).toBe(expected.registry);
        if (expected.registrySlug) {
          expect(skill.registrySlug).toBe(expected.registrySlug);
        } else {
          expect(skill.registrySlug).toBeUndefined();
        }
      });
    }
  });

  describe("known non-registry skills have no registry metadata", () => {
    for (const slug of KNOWN_NO_REGISTRY) {
      test(`${slug} has no registry metadata`, () => {
        const skill = skills[slug];
        expect(skill).toBeDefined();
        expect(skill.registry).toBeUndefined();
        expect(skill.registrySlug).toBeUndefined();
      });
    }
  });

  test("every registry field uses one of the two allowed repos", () => {
    const unexpected = Object.entries(skills)
      .filter(([, skill]) => skill.registry && !ALLOWED_REGISTRIES.has(skill.registry))
      .map(([slug, skill]) => `${slug}:${skill.registry}`)
      .sort();
    expect(unexpected).toEqual([]);
  });

  test("legacy registry repos are absent from the compiled manifest", () => {
    const legacyHits = Object.entries(skills)
      .filter(([, skill]) => LEGACY_REGISTRIES.includes(skill.registry))
      .map(([slug, skill]) => `${slug}:${skill.registry}`)
      .sort();
    expect(legacyHits).toEqual([]);
  });

  test("registrySlug is never set without registry", () => {
    for (const [slug, skill] of Object.entries(skills)) {
      if (skill.registrySlug) {
        expect(
          skill.registry,
          `${slug} has registrySlug without registry`,
        ).toBeDefined();
      }
    }
  });
});
