#!/usr/bin/env bun
/**
 * Sandbox eval runner with agent-browser verification.
 *
 * Phase 1: Claude Code builds 5 different Next.js apps in parallel sandboxes.
 * Phase 2: A follow-up Claude Code session uses agent-browser to walk through
 *          user stories, fixing issues until all stories pass.
 *
 * Usage:
 *   bun run .claude/skills/benchmark-sandbox/run-eval.ts [options]
 *   --concurrency N     Max parallel sandboxes (default 5, max 10)
 *   --timeout MS        Per-phase timeout in ms (default 1800000 = 30 min)
 *   --keep-alive        Keep sandboxes running after eval
 *   --keep-hours N      Hours to keep alive (default 8)
 *   --skip-verify       Skip the agent-browser verification phase
 */

import { Sandbox } from "@vercel/sandbox";
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SANDBOX_HOME = "/home/vercel-sandbox";
const SANDBOX_PLUGIN_DIR = `${SANDBOX_HOME}/vercel-plugin`;
const LOCAL_PLUGIN_DIR = join(homedir(), "dev", "vercel-plugin");
const UPLOAD_DIRS = ["hooks", "skills", "generated"];
const RESULTS_DIR = join(homedir(), "dev", "vercel-plugin-testing", "sandbox-results");

const args = process.argv.slice(2);
const getArg = (name: string, fallback: number) =>
  args.includes(`--${name}`) ? parseInt(args[args.indexOf(`--${name}`) + 1], 10) : fallback;
const CONCURRENCY = Math.min(Math.max(getArg("concurrency", 5), 1), 10);
const TIMEOUT_MS = getArg("timeout", 1_800_000);
const KEEP_ALIVE = args.includes("--keep-alive");
const KEEP_ALIVE_HOURS = getArg("keep-hours", 8);
const SKIP_VERIFY = args.includes("--skip-verify");

// ---------------------------------------------------------------------------
// 5 Creative Scenarios with User Stories
// ---------------------------------------------------------------------------

interface Scenario {
  slug: string;
  prompt: string;
  expectedSkills: string[];
  userStories: [string, string, string];
}

const SCENARIOS: Scenario[] = [
  {
    slug: "ai-chatbot-rag",
    prompt: `Build a Next.js AI chatbot with RAG (retrieval-augmented generation) using the full Vercel stack. Requirements:
- Use AI SDK (\`ai\` package) with \`streamText\` for streaming chat responses
- Use Vercel Blob (\`@vercel/blob\`) to store uploaded knowledge documents
- Create an /api/chat route that uses AI SDK's \`streamText\` with system context from stored docs
- Use SWR for client-side message fetching with optimistic updates
- Use shadcn/ui Chat components (Input, Button, ScrollArea, Card)
- Add middleware.ts that checks for an auth cookie and redirects unauthenticated users to /login
- Create a mock /api/auth/login route that sets a cookie
- Use Geist font via next/font/google
After building all files, start the dev server on port 3000 with \`npx next dev --port 3000\`.`,
    expectedSkills: ["ai-sdk", "vercel-storage", "swr", "shadcn", "routing-middleware", "geist", "nextjs"],
    userStories: [
      "As a user, I can see a chat interface with a message input and send button",
      "As a user, I can type a message and see it appear in the chat history",
      "As a user, I can see the AI response stream in token-by-token in the chat",
    ],
  },
  {
    slug: "feature-flagged-dashboard",
    prompt: `Build a Next.js analytics dashboard that uses Vercel feature flags to control which widgets are visible. Requirements:
- Use Vercel Flags SDK (\`@vercel/flags/next\`) to define 3 feature flags: showRevenueChart, showUserTable, showActivityFeed
- Create a flags.ts file using \`flag()\` from @vercel/flags/next with default values
- Use edge runtime (\`export const runtime = 'edge'\`) for the main dashboard API route
- Create /api/analytics route returning mock analytics JSON data
- Use shadcn/ui for the dashboard layout (Card, Table, Tabs components)
- Add a cron job route at /api/cron/daily-report that would email a daily summary (mock implementation)
- Use Vercel KV / runtime cache (\`@vercel/kv\`) to cache analytics data with a 60s TTL (mock KV with in-memory Map if needed)
- Add observability with structured console.log JSON in API routes
After building all files, start the dev server on port 3000 with \`npx next dev --port 3000\`.`,
    expectedSkills: ["vercel-flags", "edge-runtime", "shadcn", "cron-jobs", "runtime-cache", "observability", "nextjs", "vercel-functions"],
    userStories: [
      "As a user, I can see a dashboard page with card-based widgets displaying analytics data",
      "As a user, I can see a table or list of data on the dashboard",
      "As a user, I can navigate between different tabs or sections of the dashboard",
    ],
  },
  {
    slug: "ai-image-gallery",
    prompt: `Build a Next.js AI-powered image gallery using Vercel platform features. Requirements:
- Use AI SDK (\`ai\` package) with \`generateText\` to create image descriptions/alt-text from prompts
- Use Vercel Blob (\`@vercel/blob\`) for image upload and storage — create an /api/upload route using \`put()\` from @vercel/blob
- Use Satori (\`satori\`) to generate OG image cards for each gallery item at /api/og route
- Create a dynamic [id] route for individual image pages with generated OG metadata
- Use shadcn/ui components (Dialog for lightbox, Card for thumbnails, Input for upload)
- Use SWR (\`swr\`) on the client for fetching and revalidating the gallery
- Use Vercel Functions with streaming for the AI description generation
After building all files, start the dev server on port 3000 with \`npx next dev --port 3000\`.`,
    expectedSkills: ["ai-sdk", "vercel-storage", "satori", "swr", "shadcn", "nextjs", "vercel-functions"],
    userStories: [
      "As a user, I can see a gallery page with image cards or thumbnails displayed",
      "As a user, I can see an upload area or button to add new images",
      "As a user, I can click on an image to see a larger view or detail page",
    ],
  },
  {
    slug: "realtime-collab-notes",
    prompt: `Build a Next.js collaborative notes app using Vercel platform features. Requirements:
- Use AI SDK (\`ai\` package) with \`streamText\` in an /api/ai/summarize route that summarizes note content
- Use Vercel KV (\`@vercel/kv\`) or runtime cache to store notes as JSON (mock with in-memory Map if KV unavailable)
- Create CRUD API routes: /api/notes (GET, POST), /api/notes/[id] (GET, PUT, DELETE)
- Use shadcn/ui components (Textarea, Card, Dialog, Button, Sidebar)
- Add routing middleware (middleware.ts) that adds request timing headers and logs request paths
- Use edge runtime for the middleware
- Create a /api/cron/cleanup route that would delete old notes (mock implementation)
- Use Vercel Functions for all API routes
- Use Geist font
After building all files, start the dev server on port 3000 with \`npx next dev --port 3000\`.`,
    expectedSkills: ["ai-sdk", "runtime-cache", "shadcn", "routing-middleware", "edge-runtime", "cron-jobs", "vercel-functions", "geist", "nextjs"],
    userStories: [
      "As a user, I can see a list of notes or a notes sidebar on the page",
      "As a user, I can create a new note by typing in a text area and clicking Save",
      "As a user, I can see an AI summarize button or feature for note content",
    ],
  },
  {
    slug: "deploy-monitor-ai",
    prompt: `Build a Next.js deployment monitoring tool with AI analysis using Vercel platform features. Requirements:
- Create /api/deployments route using Vercel REST API client patterns (mock the actual API calls with hardcoded deployment JSON data)
- Use AI SDK (\`ai\` package) with \`generateText\` in /api/ai/analyze route that analyzes deployment health from mock data
- Use Vercel Flags (\`@vercel/flags/next\`) to toggle between "simple view" and "detailed view" of deployments
- Use shadcn/ui for the dashboard (Table, Badge, Card, Tabs, Alert components)
- Add /api/cron/check-health route that would periodically check deployment status
- Use edge runtime for the deployment listing API route
- Add structured observability logging (JSON logs with timestamp, level, message) in all API routes
- Use Vercel Functions with proper error handling and status codes
- Add a vercel.json with cron configuration for the health check
After building all files, start the dev server on port 3000 with \`npx next dev --port 3000\`.`,
    expectedSkills: ["ai-sdk", "vercel-api", "vercel-flags", "shadcn", "cron-jobs", "edge-runtime", "observability", "vercel-functions", "nextjs"],
    userStories: [
      "As a user, I can see a table or list of deployments with status badges",
      "As a user, I can see deployment details like URL, status, and timestamps",
      "As a user, I can see an AI analysis section or button that provides deployment health insights",
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(0)}s`;
}

function resolveApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    return execSync('security find-generic-password -a "$USER" -s "ANTHROPIC_AUTH_TOKEN" -w', {
      encoding: "utf-8", timeout: 5000,
    }).trim();
  } catch {}
  console.error("Missing ANTHROPIC_API_KEY"); process.exit(1);
}

function resolveVercelToken(): string | undefined {
  try {
    return JSON.parse(require("fs").readFileSync(join(homedir(), ".local/share/com.vercel.cli/auth.json"), "utf-8")).token;
  } catch { return undefined; }
}

async function collectPluginFiles(): Promise<Array<{ path: string; content: Buffer }>> {
  const files: Array<{ path: string; content: Buffer }> = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(join(LOCAL_PLUGIN_DIR, dir), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = join(dir, entry.name);
      const fullPath = join(LOCAL_PLUGIN_DIR, relPath);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "src", ".claude", "tests", "scripts", ".playground"].includes(entry.name)) continue;
        await walk(relPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".mts") || entry.name.endsWith(".test.ts")) continue;
        const s = await stat(fullPath);
        if (s.size > 200_000) continue;
        files.push({ path: join(SANDBOX_PLUGIN_DIR, relPath), content: await readFile(fullPath) });
      }
    }
  }
  for (const dir of UPLOAD_DIRS) await walk(dir);
  for (const f of ["hooks/hooks.json", "package.json"]) {
    try { files.push({ path: join(SANDBOX_PLUGIN_DIR, f), content: await readFile(join(LOCAL_PLUGIN_DIR, f)) }); } catch {}
  }
  return files;
}

async function sh(sandbox: any, cmd: string): Promise<string> {
  try { const r = await sandbox.runCommand("sh", ["-c", cmd]); return (await r.stdout()).trim(); }
  catch { return "(cmd failed)"; }
}

function buildVerificationPrompt(userStories: string[]): string {
  const stories = userStories.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `The app is running at http://localhost:3000. Use agent-browser to verify these user stories:

${stories}

For EACH story, follow this exact workflow:
1. agent-browser open http://localhost:3000
2. agent-browser wait --load networkidle
3. agent-browser screenshot --annotate
4. agent-browser snapshot -i
5. Interact with the UI (click buttons, fill inputs, etc.) to test the story
6. agent-browser screenshot --annotate (capture the result)
7. Determine if the story PASSED or FAILED

If a story FAILS:
- Fix the code to make it pass
- Restart the dev server if needed: kill the old one and run \`npx next dev --port 3000\` again
- Re-verify the story

After testing all stories, output a summary in this exact format:
VERIFICATION_RESULTS:
STORY_1: PASS or FAIL
STORY_2: PASS or FAIL
STORY_3: PASS or FAIL`;
}

// ---------------------------------------------------------------------------
// Per-scenario runner
// ---------------------------------------------------------------------------

interface VerificationResult {
  ran: boolean;
  exitCode: number;
  stories: Array<{ index: number; status: "pass" | "fail" | "unknown" }>;
  output: string;
}

interface ScenarioResult {
  slug: string;
  sandboxId: string;
  success: boolean;
  durationMs: number;
  claimedSkills: string[];
  expectedSkills: string[];
  projectFiles: string[];
  appUrl?: string;
  error?: string;
  pollHistory: Array<{ elapsed: string; skills: string[]; files: number }>;
  verification?: VerificationResult;
}

async function runScenario(
  scenario: Scenario,
  apiKey: string,
  baseUrl: string,
  vercelToken: string | undefined,
  pluginFiles: Array<{ path: string; content: Buffer }>,
): Promise<ScenarioResult> {
  const t0 = performance.now();
  const projectDir = `${SANDBOX_HOME}/${scenario.slug}`;
  const pollHistory: ScenarioResult["pollHistory"] = [];
  let sandbox: InstanceType<typeof Sandbox> | undefined;

  try {
    // 1. Create sandbox with port 3000
    console.log(`  [${scenario.slug}] Creating sandbox...`);
    sandbox = await Sandbox.create({
      runtime: "node24",
      ports: [3000],
      env: {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: baseUrl,
        VERCEL_PLUGIN_LOG_LEVEL: "trace",
        ...(vercelToken ? { VERCEL_TOKEN: vercelToken } : {}),
      },
      timeout: TIMEOUT_MS + 300_000,
    } as any);
    let appUrl: string | undefined;
    try { appUrl = sandbox.domain(3000); } catch {}
    console.log(`  [${scenario.slug}] Sandbox ${sandbox.sandboxId}${appUrl ? ` | ${appUrl}` : ""} (${elapsed(t0)})`);

    // 2. Install Claude Code + Vercel CLI + agent-browser
    await sandbox.runCommand("sh", ["-c", "npm install -g @anthropic-ai/claude-code vercel agent-browser"]);
    const claudeBin = await sh(sandbox, "which claude");
    const abBin = await sh(sandbox, "which agent-browser");
    console.log(`  [${scenario.slug}] claude=${claudeBin} agent-browser=${abBin} (${elapsed(t0)})`);

    // 3. Vercel CLI auth
    if (vercelToken) {
      await sandbox.writeFiles([{
        path: `${SANDBOX_HOME}/.local/share/com.vercel.cli/auth.json`,
        content: Buffer.from(JSON.stringify({ token: vercelToken })),
      }]);
    }

    // 4. Project setup + plugin
    await sandbox.runCommand("sh", ["-c", `mkdir -p ${projectDir} && cd ${projectDir} && npm init -y`]);
    await sandbox.writeFiles(pluginFiles);
    await sh(sandbox, `cd ${projectDir} && npx -y add-plugin ${SANDBOX_PLUGIN_DIR} -s project -y --target claude-code 2>&1 | tail -1`);
    console.log(`  [${scenario.slug}] Plugin installed (${elapsed(t0)})`);

    // 5. Phase 1: Build the app
    await sandbox.writeFiles([{ path: "/tmp/prompt.txt", content: Buffer.from(scenario.prompt) }]);
    const settingsPath = `${projectDir}/.claude/settings.json`;
    const buildCmd = `cd ${projectDir} && ${claudeBin} --dangerously-skip-permissions --debug --settings ${settingsPath} "$(cat /tmp/prompt.txt)"`;

    console.log(`  [${scenario.slug}] Phase 1: BUILD started (${elapsed(t0)})`);
    const buildPromise = sandbox.runCommand("sh", ["-c", buildCmd], { signal: AbortSignal.timeout(TIMEOUT_MS) });

    // Poll during build
    const pollInterval = setInterval(async () => {
      try {
        const skills = (await sh(sandbox!, "ls /tmp/vercel-plugin-*-seen-skills.d/ 2>/dev/null")).split("\n").filter(Boolean);
        const fileCount = parseInt(await sh(sandbox!, `find ${projectDir} -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' -not -path '*/.claude/*' -newer /tmp/prompt.txt -type f 2>/dev/null | wc -l`), 10) || 0;
        const port3000 = await sh(sandbox!, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo 'down'");
        if (!appUrl && port3000 !== "000down" && port3000 !== "down") {
          try { appUrl = sandbox!.domain(3000); } catch {}
        }
        pollHistory.push({ elapsed: elapsed(t0), skills, files: fileCount });
        console.log(`  [${scenario.slug}] ${elapsed(t0)} | skills: ${skills.join(", ") || "(none)"} | files: ${fileCount} | :3000=${port3000}`);
      } catch {}
    }, 20_000);

    let buildExit = -1;
    try {
      const r = await buildPromise;
      clearInterval(pollInterval);
      buildExit = (r as any).exitCode ?? 0;
    } catch (e: any) {
      clearInterval(pollInterval);
      if (e.message?.includes("timed out") || e.message?.includes("abort")) {
        console.log(`  [${scenario.slug}] Build timed out (${elapsed(t0)})`);
        buildExit = 124;
      } else throw e;
    }

    // Extract artifacts after build
    const claimedSkills = (await sh(sandbox, "ls /tmp/vercel-plugin-*-seen-skills.d/ 2>/dev/null")).split("\n").filter(Boolean);
    const projectFilesList = (await sh(sandbox, `find ${projectDir} -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' -not -path '*/.claude/*' -type f 2>/dev/null | head -40`)).split("\n").filter(Boolean);
    console.log(`  [${scenario.slug}] Build done (exit=${buildExit}) | skills=${claimedSkills.length} | files=${projectFilesList.length} (${elapsed(t0)})`);

    // 6. Start dev server (if not already running from the build prompt)
    let port3000Up = false;
    const portCheck = await sh(sandbox, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null");
    if (portCheck === "200" || portCheck === "307") {
      port3000Up = true;
      console.log(`  [${scenario.slug}] Dev server already running (${elapsed(t0)})`);
    } else {
      const hasNext = await sh(sandbox, `test -f ${projectDir}/node_modules/.bin/next && echo YES || echo NO`);
      if (hasNext === "YES") {
        console.log(`  [${scenario.slug}] Starting dev server... (${elapsed(t0)})`);
        await sh(sandbox, `cd ${projectDir} && nohup npx next dev --port 3000 --turbopack > /tmp/next-dev.log 2>&1 & echo started`);
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const status = await sh(sandbox, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null");
          if (status === "200" || status === "307") {
            port3000Up = true;
            try { appUrl = sandbox.domain(3000); } catch {}
            console.log(`  [${scenario.slug}] Dev server UP: ${appUrl} (${elapsed(t0)})`);
            break;
          }
        }
      }
    }

    // 7. Extend timeout for verification + keep-alive
    try {
      await sandbox.extendTimeout(KEEP_ALIVE ? KEEP_ALIVE_HOURS * 3600_000 : 600_000);
      console.log(`  [${scenario.slug}] Timeout extended (${elapsed(t0)})`);
    } catch (e: any) {
      console.log(`  [${scenario.slug}] extendTimeout: ${e.message?.slice(0, 60)}`);
    }

    // 8. Phase 2: Verification with agent-browser
    let verification: VerificationResult | undefined;
    if (!SKIP_VERIFY && port3000Up && projectFilesList.length > 3) {
      console.log(`  [${scenario.slug}] Phase 2: VERIFY with agent-browser (${elapsed(t0)})`);
      const verifyPrompt = buildVerificationPrompt(scenario.userStories);
      await sandbox.writeFiles([{ path: "/tmp/verify.txt", content: Buffer.from(verifyPrompt) }]);

      const verifyCmd = `cd ${projectDir} && ${claudeBin} --dangerously-skip-permissions --debug --settings ${settingsPath} "$(cat /tmp/verify.txt)"`;
      let verifyExit = -1;
      let verifyOut = "";
      try {
        const vr = await sandbox.runCommand("sh", ["-c", verifyCmd], { signal: AbortSignal.timeout(300_000) });
        verifyExit = (vr as any).exitCode ?? 0;
        verifyOut = (await vr.stdout()).trim();
      } catch (e: any) {
        if (e.message?.includes("timed out")) {
          verifyExit = 124;
          console.log(`  [${scenario.slug}] Verify timed out (${elapsed(t0)})`);
        }
      }

      // Parse verification results from output
      const stories: VerificationResult["stories"] = scenario.userStories.map((_, i) => {
        const idx = i + 1;
        const passMatch = verifyOut.match(new RegExp(`STORY_${idx}:\\s*(PASS|FAIL)`, "i"));
        return {
          index: idx,
          status: passMatch ? (passMatch[1].toLowerCase() as "pass" | "fail") : "unknown",
        };
      });

      verification = { ran: true, exitCode: verifyExit, stories, output: verifyOut.slice(-500) };
      const passCount = stories.filter(s => s.status === "pass").length;
      console.log(`  [${scenario.slug}] Verify: ${passCount}/${stories.length} passed (exit=${verifyExit}) (${elapsed(t0)})`);
    } else if (SKIP_VERIFY) {
      console.log(`  [${scenario.slug}] Verification skipped (--skip-verify)`);
    } else {
      console.log(`  [${scenario.slug}] Verification skipped (no dev server or too few files)`);
    }

    console.log(`  [${scenario.slug}] DONE (${elapsed(t0)}) | skills=${claimedSkills.length} | files=${projectFilesList.length}${appUrl ? ` | ${appUrl}` : ""}`);

    return {
      slug: scenario.slug,
      sandboxId: sandbox.sandboxId,
      success: buildExit === 0 || buildExit === 124,
      durationMs: performance.now() - t0,
      claimedSkills,
      expectedSkills: scenario.expectedSkills,
      projectFiles: projectFilesList,
      appUrl,
      pollHistory,
      verification,
    };
  } catch (err: any) {
    console.error(`  [${scenario.slug}] ERROR: ${err.message?.slice(0, 200)}`);
    return {
      slug: scenario.slug,
      sandboxId: sandbox?.sandboxId ?? "unknown",
      success: false,
      durationMs: performance.now() - t0,
      claimedSkills: [],
      expectedSkills: scenario.expectedSkills,
      projectFiles: [],
      error: err.message?.slice(0, 400),
      pollHistory,
    };
  } finally {
    if (sandbox && !KEEP_ALIVE) {
      try { await sandbox.stop(); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = performance.now();
  const runId = `eval-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const resultsPath = join(RESULTS_DIR, runId);
  await mkdir(resultsPath, { recursive: true });

  console.log("=== Sandbox Eval Runner (with agent-browser verification) ===");
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s per phase`);
  console.log(`Verify: ${SKIP_VERIFY ? "SKIP" : "ON"}`);
  console.log(`Keep-alive: ${KEEP_ALIVE ? `${KEEP_ALIVE_HOURS}h` : "OFF"}`);
  console.log(`Results: ${resultsPath}\n`);

  const apiKey = resolveApiKey();
  const baseUrl = "https://ai-gateway.vercel.sh";
  const vercelToken = resolveVercelToken();

  console.log("Collecting plugin files...");
  const pluginFiles = await collectPluginFiles();
  console.log(`  ${pluginFiles.length} files (${(pluginFiles.reduce((a, f) => a + f.content.length, 0) / 1024).toFixed(0)}KB)\n`);

  const queue = [...SCENARIOS];
  const results: ScenarioResult[] = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const scenario = queue.shift()!;
      console.log(`\n--- ${scenario.slug} ---`);
      const result = await runScenario(scenario, apiKey, baseUrl, vercelToken, pluginFiles);
      results.push(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, SCENARIOS.length) }, () => worker()));

  // Save results
  await writeFile(join(resultsPath, "results.json"), JSON.stringify({ runId, results, totalMs: performance.now() - t0 }, null, 2));

  // Print summary
  console.log("\n\n=== SUMMARY ===");
  console.log(`${"Slug".padEnd(22)} ${"Build".padEnd(6)} ${"Skills".padEnd(6)} ${"Files".padEnd(6)} ${"Verify".padEnd(10)} Duration`);
  console.log("-".repeat(80));
  for (const r of results) {
    const build = r.success ? "OK" : "FAIL";
    const verify = r.verification
      ? `${r.verification.stories.filter(s => s.status === "pass").length}/${r.verification.stories.length}`
      : "skip";
    console.log(`${r.slug.padEnd(22)} ${build.padEnd(6)} ${String(r.claimedSkills.length).padEnd(6)} ${String(r.projectFiles.length).padEnd(6)} ${verify.padEnd(10)} ${(r.durationMs / 1000).toFixed(0)}s`);
  }

  // Verification details
  const verified = results.filter(r => r.verification?.ran);
  if (verified.length > 0) {
    console.log("\n=== VERIFICATION DETAILS ===");
    for (const r of verified) {
      console.log(`\n  ${r.slug}:`);
      for (const s of r.verification!.stories) {
        const icon = s.status === "pass" ? "✓" : s.status === "fail" ? "✗" : "?";
        console.log(`    ${icon} Story ${s.index}: ${s.status.toUpperCase()}`);
      }
    }
    const totalStories = verified.reduce((a, r) => a + r.verification!.stories.length, 0);
    const passedStories = verified.reduce((a, r) => a + r.verification!.stories.filter(s => s.status === "pass").length, 0);
    console.log(`\n  Total: ${passedStories}/${totalStories} stories passed`);
  }

  // App URLs
  const appsWithUrls = results.filter(r => r.appUrl);
  if (appsWithUrls.length > 0) {
    console.log("\n=== APP URLs ===");
    for (const r of appsWithUrls) console.log(`  ${r.slug}: ${r.appUrl}`);
  }

  // Skill coverage
  console.log("\n=== SKILL COVERAGE ===");
  for (const r of results) {
    const expected = new Set(r.expectedSkills);
    const actual = new Set(r.claimedSkills);
    const hit = [...expected].filter(s => actual.has(s));
    const miss = [...expected].filter(s => !actual.has(s));
    const extra = [...actual].filter(s => !expected.has(s));
    console.log(`  ${r.slug}: ${hit.length}/${expected.size} expected | +${extra.length} bonus | -${miss.length} missing`);
    if (miss.length) console.log(`    missing: ${miss.join(", ")}`);
  }

  if (!KEEP_ALIVE) {
    const allPassed = results.every(r => r.success);
    process.exit(allPassed ? 0 : 1);
  }

  // Keep-alive mode
  if (appsWithUrls.length > 0) {
    console.log(`\n=== SANDBOXES KEPT ALIVE (${KEEP_ALIVE_HOURS}h) ===`);
    for (const r of appsWithUrls) console.log(`  ${r.slug}: ${r.appUrl}`);
    await writeFile(join(resultsPath, "live-urls.json"), JSON.stringify(
      Object.fromEntries(appsWithUrls.map(r => [r.slug, { url: r.appUrl, sandboxId: r.sandboxId }])),
      null, 2,
    ));
    console.log(`\nPress Ctrl+C to stop all sandboxes.\n`);
    await new Promise(() => {});
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
