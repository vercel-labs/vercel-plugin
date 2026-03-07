import { describe, test, expect, beforeEach } from "bun:test";

/**
 * Validate-rules tests: exercise each skill's validation rules against
 * realistic file content using the exported unit functions from the
 * posttooluse-validate hook. These tests cover:
 *
 * - Per-skill rule accuracy (ai-sdk, ai-gateway, nextjs, vercel-functions, edge-runtime)
 * - Multi-skill overlap (file matching 2+ skills runs both rule sets)
 * - No false positives on clean files
 * - Warn-severity suppression at default log level
 * - Dedup skips re-validation for same file content hash
 * - Unknown/missing file path returns no output
 *
 * NOTE: The inline YAML parser does not process \\\\ escape sequences in
 * double-quoted strings. Patterns like "module\\\\.exports" are stored with
 * literal double-backslashes and only match content containing actual
 * backslash characters. Tests here reflect the actual runtime behavior.
 */

// Import unit functions from the compiled hook
let parseInput: typeof import("../hooks/src/posttooluse-validate.mts").parseInput;
let runValidation: typeof import("../hooks/src/posttooluse-validate.mts").runValidation;
let formatOutput: typeof import("../hooks/src/posttooluse-validate.mts").formatOutput;
let contentHash: typeof import("../hooks/src/posttooluse-validate.mts").contentHash;
let parseValidatedFiles: typeof import("../hooks/src/posttooluse-validate.mts").parseValidatedFiles;
let appendValidatedFile: typeof import("../hooks/src/posttooluse-validate.mts").appendValidatedFile;
let loadValidateRules: typeof import("../hooks/src/posttooluse-validate.mts").loadValidateRules;
let matchFileToSkills: typeof import("../hooks/src/posttooluse-validate.mts").matchFileToSkills;

beforeEach(async () => {
  const mod = await import("../hooks/posttooluse-validate.mjs");
  parseInput = mod.parseInput;
  runValidation = mod.runValidation;
  formatOutput = mod.formatOutput;
  contentHash = mod.contentHash;
  parseValidatedFiles = mod.parseValidatedFiles;
  appendValidatedFile = mod.appendValidatedFile;
  loadValidateRules = mod.loadValidateRules;
  matchFileToSkills = mod.matchFileToSkills;
});

function extractPostValidation(hookSpecificOutput: any): any {
  const ctx = hookSpecificOutput?.additionalContext || "";
  const match = ctx.match(/<!-- postValidation: ({.*?}) -->/);
  if (!match) return undefined;
  try { return JSON.parse(match[1]); } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Helper: build a rules map from real skill data
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
const ROOT = resolve(import.meta.dirname, "..");

function loadRealRules() {
  return loadValidateRules(ROOT);
}

// ---------------------------------------------------------------------------
// ai-sdk skill rules (patterns without double-escape issues)
// ---------------------------------------------------------------------------

describe("ai-sdk validation rules", () => {
  test("flags direct openai import", () => {
    const data = loadRealRules();
    expect(data).not.toBeNull();
    const violations = runValidation(
      `import OpenAI from 'openai';\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((v) => v.message.includes("@ai-sdk/openai"))).toBe(true);
  });

  test("flags direct anthropic import", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import Anthropic from 'anthropic';\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("@ai-sdk/anthropic"))).toBe(true);
  });

  test("flags ToolLoopAgent usage", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import { ToolLoopAgent } from 'ai';\nconst agent = new ToolLoopAgent({});\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    // ToolLoopAgent is a plain string pattern, no escape issues
    expect(violations.some((v) => v.message.includes("Agent"))).toBe(true);
    // Should fire on both lines (import and usage)
    expect(violations.filter((v) => v.message.includes("Agent")).length).toBeGreaterThanOrEqual(2);
  });

  test("flags toDataStreamResponse usage", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `return result.toDataStreamResponse();\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((v) => v.message.includes("toUIMessageStreamResponse"))).toBe(true);
  });

  test("does not flag toUIMessageStreamResponse", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `return result.toUIMessageStreamResponse();\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error" && v.message.includes("toDataStreamResponse"));
    expect(errors.length).toBe(0);
  });

  test("flags maxSteps config", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const result = streamText({ model, maxSteps: 5 });\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.some((v) => v.message.includes("stopWhen"))).toBe(true);
  });

  test("does not flag stopWhen: stepCountIs", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const result = streamText({ model, stopWhen: stepCountIs(5) });\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.message.includes("maxSteps"));
    expect(errors.length).toBe(0);
  });

  test("flags onResponse callback (warn)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `useChat({ onResponse: (res) => console.log(res) });\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.severity === "warn" && v.message.includes("onResponse"))).toBe(true);
  });

  test("flags useChat({ api: }) v5 pattern", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const chat = useChat({ api: '/api/chat' });\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.some((v) => v.message.includes("DefaultChatTransport"))).toBe(true);
  });

  test("does not flag useChat with transport", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const chat = useChat({ transport: new DefaultChatTransport({ api: '/api/chat' }) });\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.message.includes("useChat({ api })"));
    expect(errors.length).toBe(0);
  });

  test("flags body option in useChat (warn)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `useChat({ body: { userId: '123' } });\n`,
      ["ai-sdk"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.severity === "warn" && v.message.includes("body option"))).toBe(true);
  });

  test("passes clean ai-sdk usage", () => {
    const data = loadRealRules();
    const violations = runValidation(
      [
        `import { generateText } from 'ai';`,
        `import { openai } from '@ai-sdk/openai';`,
        `const result = await generateText({ model: openai('gpt-4o'), prompt: 'Hi' });`,
      ].join("\n"),
      ["ai-sdk"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("@ai-sdk/openai import does not trigger direct openai flag", () => {
    const data = loadRealRules();
    const content = `import { openai } from '@ai-sdk/openai';\n`;
    const violations = runValidation(content, ["ai-sdk"], data!.rulesMap);
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("@ai-sdk/anthropic import does not trigger direct anthropic flag", () => {
    const data = loadRealRules();
    const content = `import { anthropic } from '@ai-sdk/anthropic';\n`;
    const violations = runValidation(content, ["ai-sdk"], data!.rulesMap);
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ai-gateway skill rules
// ---------------------------------------------------------------------------

describe("ai-gateway validation rules", () => {
  test("flags hyphenated model slug (anthropic/claude-sonnet-4-6)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `gateway('anthropic/claude-sonnet-4-6')\n`,
      ["ai-gateway"],
      data!.rulesMap,
    );
    // This pattern is a plain string, no escaping needed
    expect(violations.some((v) => v.message.includes("dots not hyphens"))).toBe(true);
  });

  test("AI_GATEWAY_API_KEY is warn severity (fallback auth)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const key = process.env.AI_GATEWAY_API_KEY;\n`,
      ["ai-gateway"],
      data!.rulesMap,
    );
    const matching = violations.filter((v) => v.message.includes("AI_GATEWAY_API_KEY") || v.message.includes("OIDC") || v.message.includes("fallback"));
    expect(matching.length).toBeGreaterThanOrEqual(1);
    // Should be warn, not error — it's a supported fallback auth mechanism
    expect(matching.every((v) => v.severity === "warn")).toBe(true);
  });

  test("flags raw model string without provider/ prefix", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const model = gateway('gpt-4o');\n`,
      ["ai-gateway"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.some((v) => v.message.includes("provider/"))).toBe(true);
  });

  test("does not flag model string with provider/ prefix", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const model = gateway('openai/gpt-5.4');\n`,
      ["ai-gateway"],
      data!.rulesMap,
    );
    const prefixErrors = violations.filter((v) => v.severity === "error" && v.message.includes("provider/"));
    expect(prefixErrors.length).toBe(0);
  });

  test("flags outdated gpt-4o model (warn)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const model = gateway('openai/gpt-4o');\n`,
      ["ai-gateway"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.severity === "warn" && v.message.includes("gpt-4o"))).toBe(true);
  });

  test("does not warn about gpt-5.4", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const model = gateway('openai/gpt-5.4');\n`,
      ["ai-gateway"],
      data!.rulesMap,
    );
    const outdatedWarns = violations.filter((v) => v.message.includes("gpt-4o"));
    expect(outdatedWarns.length).toBe(0);
  });

  test("flags provider API key env vars", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `const key = process.env.OPENAI_API_KEY;\n`,
      ["ai-gateway"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("OIDC") || v.message.includes("vercel"))).toBe(true);
  });

  test("passes correct gateway usage", () => {
    const data = loadRealRules();
    const violations = runValidation(
      [
        `import { generateText, gateway } from 'ai';`,
        `const result = await generateText({ model: gateway('openai/gpt-5.4'), prompt: 'Hi' });`,
      ].join("\n"),
      ["ai-gateway"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("gateway model slugs do not trigger raw model string flags", () => {
    const data = loadRealRules();
    const content = `const m = gateway('openai/gpt-5.4');\n`;
    const violations = runValidation(content, ["ai-gateway"], data!.rulesMap);
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// nextjs skill rules
// ---------------------------------------------------------------------------

describe("nextjs validation rules", () => {
  test("flags getServerSideProps export (error severity)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `export async function getServerSideProps(ctx) { return { props: {} }; }\n`,
      ["nextjs"],
      data!.rulesMap,
    );
    // The error-severity pattern matches "export async function getServerSideProps"
    expect(violations.some((v) => v.severity === "error")).toBe(true);
  });

  test("flags getServerSideProps mention (warn severity)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `// TODO: migrate getServerSideProps to server component\n`,
      ["nextjs"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("Pages Router"))).toBe(true);
  });

  test("flags next/router import", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import { useRouter } from 'next/router';\n`,
      ["nextjs"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.some((v) => v.message.includes("next/navigation"))).toBe(true);
  });

  test("warns about React hooks (use client directive missing)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      [
        `import { useState, useEffect } from 'react';`,
        `export default function Page() { const [x, setX] = useState(0); }`,
      ].join("\n"),
      ["nextjs"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("use client"))).toBe(true);
    // These are warn severity
    expect(violations.some((v) => v.severity === "warn" && v.message.includes("use client"))).toBe(true);
  });

  test("passes clean App Router server component", () => {
    const data = loadRealRules();
    const violations = runValidation(
      [
        `import { db } from '@/lib/db';`,
        `export default async function Page() {`,
        `  const posts = await db.query('SELECT * FROM posts');`,
        `  return <div>{posts.map(p => <p key={p.id}>{p.title}</p>)}</div>;`,
        `}`,
      ].join("\n"),
      ["nextjs"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// edge-runtime skill rules
// ---------------------------------------------------------------------------

describe("edge-runtime validation rules", () => {
  test("flags fs import (via from pattern)", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import { readFileSync } from 'node:fs';\n`,
      ["edge-runtime"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("not available in Edge Runtime"))).toBe(true);
  });

  test("flags bare fs import", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import { readFile } from 'fs';\n`,
      ["edge-runtime"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("fs module"))).toBe(true);
  });

  test("flags child_process import", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import { exec } from 'child_process';\n`,
      ["edge-runtime"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("child_process"))).toBe(true);
  });

  test("flags node:child_process import", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import { spawn } from 'node:child_process';\n`,
      ["edge-runtime"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("child_process"))).toBe(true);
  });

  test("flags net/dns imports", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import { createServer } from 'node:net';\nimport { resolve } from 'node:dns';\n`,
      ["edge-runtime"],
      data!.rulesMap,
    );
    expect(violations.filter((v) => v.message.includes("not available in Edge Runtime")).length).toBeGreaterThanOrEqual(2);
  });

  test("passes clean edge-compatible code", () => {
    const data = loadRealRules();
    const violations = runValidation(
      [
        `export const runtime = 'edge';`,
        `export async function GET(req: Request) {`,
        `  const data = await fetch('https://api.example.com/data');`,
        `  return new Response(JSON.stringify(await data.json()));`,
        `}`,
      ].join("\n"),
      ["edge-runtime"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// vercel-functions skill rules
// ---------------------------------------------------------------------------

describe("vercel-functions validation rules", () => {
  test("flags default export in route handler", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `export default function handler(req, res) { res.json({ ok: true }); }\n`,
      ["vercel-functions"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("named exports"))).toBe(true);
  });

  test("flags NextApiRequest/NextApiResponse types", () => {
    const data = loadRealRules();
    const violations = runValidation(
      `import type { NextApiRequest, NextApiResponse } from 'next';\n`,
      ["vercel-functions"],
      data!.rulesMap,
    );
    expect(violations.some((v) => v.message.includes("Pages Router types"))).toBe(true);
  });

  test("passes clean App Router route handler", () => {
    const data = loadRealRules();
    const violations = runValidation(
      [
        `export async function GET(req: Request) {`,
        `  const url = new URL(req.url);`,
        `  const name = url.searchParams.get('name');`,
        `  return Response.json({ hello: name });`,
        `}`,
      ].join("\n"),
      ["vercel-functions"],
      data!.rulesMap,
    );
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-skill overlap
// ---------------------------------------------------------------------------

describe("multi-skill overlap", () => {
  test("file matching ai-sdk + ai-gateway runs both rule sets", () => {
    const data = loadRealRules();
    // Use patterns that actually work (no double-escape issues):
    // ai-sdk: import from 'openai' (direct import pattern)
    // ai-gateway: anthropic/claude-sonnet-4-6 (hyphenated slug)
    const content = [
      `import OpenAI from 'openai';`,
      `const result = await generateText({ model: gateway('anthropic/claude-sonnet-4-6') });`,
    ].join("\n");
    const violations = runValidation(content, ["ai-sdk", "ai-gateway"], data!.rulesMap);

    expect(violations.some((v) => v.skill === "ai-sdk")).toBe(true);
    expect(violations.some((v) => v.skill === "ai-gateway")).toBe(true);
    const skills = new Set(violations.map((v) => v.skill));
    expect(skills.size).toBeGreaterThanOrEqual(2);
  });

  test("file matching nextjs + vercel-functions applies both rule sets", () => {
    const data = loadRealRules();
    // nextjs: next/router (error), vercel-functions: NextApiRequest (error) + export default (error)
    const content = [
      `import { useRouter } from 'next/router';`,
      `import type { NextApiRequest, NextApiResponse } from 'next';`,
      `export default function handler(req: NextApiRequest, res: NextApiResponse) {`,
      `  const id = req.query.id;`,
      `  res.json({ id });`,
      `}`,
    ].join("\n");
    const violations = runValidation(content, ["nextjs", "vercel-functions"], data!.rulesMap);

    const skills = new Set(violations.map((v) => v.skill));
    expect(skills.has("nextjs")).toBe(true);
    expect(skills.has("vercel-functions")).toBe(true);
  });

  test("overlapping rules don't suppress each other", () => {
    const data = loadRealRules();
    // ai-sdk flags: import from 'openai'
    // ai-gateway flags: anthropic/claude-sonnet-4-6 (hyphenated slug)
    const content = [
      `import OpenAI from 'openai';`,
      `gateway('anthropic/claude-sonnet-4-6')`,
    ].join("\n");
    const violations = runValidation(content, ["ai-sdk", "ai-gateway"], data!.rulesMap);

    const aiSdkViolations = violations.filter((v) => v.skill === "ai-sdk");
    const aiGatewayViolations = violations.filter((v) => v.skill === "ai-gateway");
    expect(aiSdkViolations.length).toBeGreaterThan(0);
    expect(aiGatewayViolations.length).toBeGreaterThan(0);
  });

  test("violations report correct line numbers per skill", () => {
    const data = loadRealRules();
    const content = [
      `import OpenAI from 'openai';`,     // line 1 - ai-sdk error
      `const x = 1;`,                      // line 2 - clean
      `gateway('anthropic/claude-sonnet-4-6')`, // line 3 - ai-gateway error
    ].join("\n");
    const violations = runValidation(content, ["ai-sdk", "ai-gateway"], data!.rulesMap);

    const aiSdkV = violations.find((v) => v.skill === "ai-sdk" && v.message.includes("@ai-sdk/openai"));
    const aiGwV = violations.find((v) => v.skill === "ai-gateway" && v.message.includes("dots not hyphens"));
    expect(aiSdkV).toBeDefined();
    expect(aiSdkV!.line).toBe(1);
    expect(aiGwV).toBeDefined();
    expect(aiGwV!.line).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// No false positives
// ---------------------------------------------------------------------------

describe("no false positives", () => {
  test("plain JS with no SDK usage produces no violations", () => {
    const data = loadRealRules();
    const content = [
      `function add(a, b) { return a + b; }`,
      `const result = add(1, 2);`,
      `console.log(result);`,
    ].join("\n");
    const allSkills = [...data!.rulesMap.keys()];
    const violations = runValidation(content, allSkills, data!.rulesMap);
    expect(violations.length).toBe(0);
  });

  test("correct ai-sdk + gateway usage produces no errors", () => {
    const data = loadRealRules();
    const content = [
      `import { generateText, gateway } from 'ai';`,
      `import { openai } from '@ai-sdk/openai';`,
      `const result = await generateText({`,
      `  model: gateway('openai/gpt-5.4'),`,
      `  prompt: 'Hello!'`,
      `});`,
    ].join("\n");
    const violations = runValidation(content, ["ai-sdk", "ai-gateway"], data!.rulesMap);
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("correctly versioned anthropic slug does not flag", () => {
    const data = loadRealRules();
    const content = `gateway('anthropic/claude-sonnet-4.6')\n`;
    const violations = runValidation(content, ["ai-gateway"], data!.rulesMap);
    // The dot version should NOT be flagged (only hyphenated version is wrong)
    const slugError = violations.filter((v) => v.message.includes("dots not hyphens"));
    expect(slugError.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Warn-severity suppression at default log level
// ---------------------------------------------------------------------------

describe("warn-severity as suggestions", () => {
  test("formatOutput surfaces warn-only violations as suggestions", () => {
    const violations = [
      { skill: "nextjs", line: 1, message: "hook warning", severity: "warn" as const, matchedText: "useState" },
    ];
    const result = formatOutput(violations, ["nextjs"], "/test/file.tsx");
    const parsed = JSON.parse(result);
    expect(parsed.hookSpecificOutput).toBeDefined();
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("[SUGGESTION]");
    expect(ctx).toContain("hook warning");
    expect(ctx).toContain("Consider applying these suggestions");
    expect(ctx).not.toContain("[ERROR]");
    const meta = extractPostValidation(parsed.hookSpecificOutput);
    expect(meta.errorCount).toBe(0);
    expect(meta.warnCount).toBe(1);
  });

  test("formatOutput includes both errors and warns when mixed", () => {
    const violations = [
      { skill: "ai-sdk", line: 1, message: "Use @ai-sdk/openai", severity: "error" as const, matchedText: "openai" },
      { skill: "nextjs", line: 5, message: "hook warning", severity: "warn" as const, matchedText: "useState" },
    ];
    const result = formatOutput(violations, ["ai-sdk", "nextjs"], "/test/file.tsx");
    const parsed = JSON.parse(result);
    expect(parsed.hookSpecificOutput).toBeDefined();
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("[ERROR]");
    expect(ctx).toContain("[SUGGESTION]");
    expect(ctx).toContain("Please fix these issues");
    const meta = extractPostValidation(parsed.hookSpecificOutput);
    expect(meta.errorCount).toBe(1);
    expect(meta.warnCount).toBe(1);
  });

  test("multiple warn violations all surfaced as suggestions", () => {
    const violations = [
      { skill: "nextjs", line: 1, message: "warn 1", severity: "warn" as const, matchedText: "x" },
      { skill: "nextjs", line: 2, message: "warn 2", severity: "warn" as const, matchedText: "y" },
      { skill: "vercel-functions", line: 3, message: "warn 3", severity: "warn" as const, matchedText: "z" },
    ];
    const result = formatOutput(violations, ["nextjs", "vercel-functions"], "/test/file.ts");
    const parsed = JSON.parse(result);
    expect(parsed.hookSpecificOutput).toBeDefined();
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("3 suggestions");
    expect(ctx).toContain("Consider applying these suggestions");
    const meta = extractPostValidation(parsed.hookSpecificOutput);
    expect(meta.errorCount).toBe(0);
    expect(meta.warnCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// File hash dedup
// ---------------------------------------------------------------------------

describe("file hash dedup", () => {
  test("same content produces same hash", () => {
    const content = `import { openai } from '@ai-sdk/openai';\n`;
    expect(contentHash(content)).toBe(contentHash(content));
  });

  test("different content produces different hash", () => {
    expect(contentHash("version 1")).not.toBe(contentHash("version 2"));
  });

  test("hash is 12 characters", () => {
    expect(contentHash("test content").length).toBe(12);
  });

  test("parseValidatedFiles round-trips with appendValidatedFile", () => {
    let env = "";
    env = appendValidatedFile(env, "file1.ts:aaa111");
    env = appendValidatedFile(env, "file2.ts:bbb222");
    const set = parseValidatedFiles(env);
    expect(set.has("file1.ts:aaa111")).toBe(true);
    expect(set.has("file2.ts:bbb222")).toBe(true);
    expect(set.size).toBe(2);
  });

  test("dedup key is path:hash composite", () => {
    const hash = contentHash("content");
    const key = `/app/route.ts:${hash}`;
    const set = parseValidatedFiles(key);
    expect(set.has(key)).toBe(true);
    expect(set.has(`/app/route.ts:different`)).toBe(false);
  });

  test("parseValidatedFiles handles empty string", () => {
    expect(parseValidatedFiles("")).toEqual(new Set());
  });

  test("parseValidatedFiles handles undefined", () => {
    expect(parseValidatedFiles(undefined)).toEqual(new Set());
  });

  test("parseValidatedFiles handles whitespace entries", () => {
    const set = parseValidatedFiles("a:1, , b:2, ");
    expect(set.size).toBe(2);
    expect(set.has("a:1")).toBe(true);
    expect(set.has("b:2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown/missing file path handling
// ---------------------------------------------------------------------------

describe("unknown/missing file path handling", () => {
  test("parseInput returns null for missing file_path", () => {
    const result = parseInput(JSON.stringify({ tool_name: "Write", tool_input: {} }));
    expect(result).toBeNull();
  });

  test("parseInput returns null for empty file_path", () => {
    const result = parseInput(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "" } }));
    expect(result).toBeNull();
  });

  test("parseInput returns null for non-Write/Edit tools", () => {
    expect(parseInput(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/foo" } }))).toBeNull();
    expect(parseInput(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }))).toBeNull();
    expect(parseInput(JSON.stringify({ tool_name: "Glob", tool_input: { pattern: "*.ts" } }))).toBeNull();
  });

  test("parseInput handles empty string", () => {
    expect(parseInput("")).toBeNull();
  });

  test("parseInput handles invalid JSON", () => {
    expect(parseInput("not json")).toBeNull();
  });

  test("parseInput handles JSON primitives", () => {
    // JSON.parse("42") returns a number, accessing .tool_name returns undefined → ""
    expect(parseInput("42")).toBeNull();
    expect(parseInput('"string"')).toBeNull();
    // JSON.parse("null") returns null — hook code accesses .tool_name on null,
    // which throws. In the full hook this is caught by the top-level try/catch.
    expect(() => parseInput("null")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// matchFileToSkills with real skill data
// ---------------------------------------------------------------------------

describe("matchFileToSkills with real rules", () => {
  test("app/api/chat/route.ts matches ai-sdk via path", () => {
    const data = loadRealRules();
    const matched = matchFileToSkills(
      "app/api/chat/route.ts",
      `export async function POST() {}`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched).toContain("ai-sdk");
  });

  test("file importing 'ai' matches ai-sdk via import", () => {
    const data = loadRealRules();
    const matched = matchFileToSkills(
      "src/utils/chat.ts",
      `import { generateText } from 'ai';\n`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched).toContain("ai-sdk");
  });

  test("file importing @ai-sdk/gateway matches ai-gateway", () => {
    const data = loadRealRules();
    const matched = matchFileToSkills(
      "lib/chat.ts",
      `import { gateway } from '@ai-sdk/gateway';\n`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched).toContain("ai-gateway");
  });

  test("file importing gateway from 'ai' matches ai-gateway", () => {
    const data = loadRealRules();
    const matched = matchFileToSkills(
      "lib/chat.ts",
      `import { gateway } from 'ai';\n`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched).toContain("ai-gateway");
  });

  test("app/api/chat/route.ts also matches vercel-functions via path", () => {
    const data = loadRealRules();
    const matched = matchFileToSkills(
      "app/api/chat/route.ts",
      `export async function POST() {}`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched).toContain("vercel-functions");
  });

  test("random path with no SDK imports matches no rules", () => {
    const data = loadRealRules();
    const matched = matchFileToSkills(
      "utils/math.ts",
      `export function add(a: number, b: number) { return a + b; }`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched.length).toBe(0);
  });

  test("app/page.tsx matches nextjs via path", () => {
    const data = loadRealRules();
    const matched = matchFileToSkills(
      "app/page.tsx",
      `export default function Home() { return <div>Hello</div>; }`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched).toContain("nextjs");
  });

  test("file can match multiple skills simultaneously", () => {
    const data = loadRealRules();
    // app/api/chat/route.ts matches ai-sdk (path) AND vercel-functions (route.* path)
    // Plus importing 'ai' reinforces ai-sdk
    const matched = matchFileToSkills(
      "app/api/chat/route.ts",
      `import { generateText } from 'ai';\nexport async function POST() {}`,
      data!.compiledSkills,
      data!.rulesMap,
    );
    expect(matched.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// SyncHookJSONOutput schema compliance
// ---------------------------------------------------------------------------

describe("output schema compliance", () => {
  test("formatOutput with errors has exactly hookSpecificOutput at top level", () => {
    const violations = [
      { skill: "ai-sdk", line: 1, message: "test", severity: "error" as const, matchedText: "x" },
    ];
    const parsed = JSON.parse(formatOutput(violations, ["ai-sdk"], "/f.ts"));
    expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
    expect(Object.keys(parsed.hookSpecificOutput).sort()).toEqual(["additionalContext", "hookEventName"]);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  });

  test("additionalContext contains posttooluse-validate markers", () => {
    const violations = [
      { skill: "ai-sdk", line: 1, message: "Fix this", severity: "error" as const, matchedText: "bad" },
    ];
    const parsed = JSON.parse(formatOutput(violations, ["ai-sdk"], "/f.ts"));
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("<!-- posttooluse-validate:");
    expect(ctx).toContain("<!-- /posttooluse-validate -->");
    expect(ctx).toContain("<!-- postValidation:");
  });

  test("metadata JSON in postValidation comment is valid", () => {
    const violations = [
      { skill: "ai-sdk", line: 3, message: "Use provider", severity: "error" as const, matchedText: "openai" },
    ];
    const parsed = JSON.parse(formatOutput(violations, ["ai-sdk"], "/f.ts"));
    const meta = extractPostValidation(parsed.hookSpecificOutput);
    expect(meta).toBeDefined();
    expect(meta.version).toBe(1);
    expect(meta.hook).toBe("posttooluse-validate");
    expect(meta.filePath).toBe("/f.ts");
    expect(meta.errorCount).toBe(1);
    expect(meta.warnCount).toBe(0);
    expect(Array.isArray(meta.matchedSkills)).toBe(true);
  });

  test("no violations returns empty JSON", () => {
    const result = formatOutput([], ["ai-sdk"], "/f.ts");
    expect(result).toBe("{}");
  });

  test("additionalContext includes fix instructions", () => {
    const violations = [
      { skill: "ai-sdk", line: 1, message: "Fix this error", severity: "error" as const, matchedText: "bad" },
    ];
    const parsed = JSON.parse(formatOutput(violations, ["ai-sdk"], "/f.ts"));
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("VALIDATION");
    expect(ctx).toContain("Line 1");
    expect(ctx).toContain("Fix this error");
    expect(ctx).toContain("Please fix these issues");
  });
});

// ---------------------------------------------------------------------------
// runValidation edge cases
// ---------------------------------------------------------------------------

describe("runValidation edge cases", () => {
  test("skips invalid regex patterns gracefully", () => {
    const rules = new Map([
      ["test-skill", [
        { pattern: "[invalid(regex", message: "broken", severity: "error" as const },
        { pattern: "validPattern", message: "found it", severity: "error" as const },
      ]],
    ]);
    const violations = runValidation("validPattern here\n", ["test-skill"], rules);
    expect(violations.length).toBe(1);
    expect(violations[0].message).toBe("found it");
  });

  test("empty content produces no violations", () => {
    const data = loadRealRules();
    const violations = runValidation("", ["ai-sdk"], data!.rulesMap);
    expect(violations.length).toBe(0);
  });

  test("skill not in rulesMap is skipped", () => {
    const data = loadRealRules();
    const violations = runValidation("anything", ["nonexistent-skill"], data!.rulesMap);
    expect(violations.length).toBe(0);
  });

  test("matched text is truncated to 80 chars", () => {
    const longLine = "import " + "x".repeat(200) + " from 'openai';";
    const rules = new Map([
      ["test", [{ pattern: "import.*from ['\"]openai['\"]", message: "test", severity: "error" as const }]],
    ]);
    const violations = runValidation(longLine, ["test"], rules);
    expect(violations.length).toBe(1);
    expect(violations[0].matchedText.length).toBeLessThanOrEqual(80);
  });

  test("multiple matches on different lines all reported", () => {
    const content = [
      `import A from 'openai';`,
      `import B from 'openai';`,
      `import C from 'openai';`,
    ].join("\n");
    const rules = new Map([
      ["test", [{ pattern: "import.*from ['\"]openai['\"]", message: "bad import", severity: "error" as const }]],
    ]);
    const violations = runValidation(content, ["test"], rules);
    expect(violations.length).toBe(3);
    expect(violations[0].line).toBe(1);
    expect(violations[1].line).toBe(2);
    expect(violations[2].line).toBe(3);
  });
});
