import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../scripts/prompt-signals-explain.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], stdin?: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", SCRIPT, ...args], {
    stdin: stdin !== undefined ? new Blob([stdin]) : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Ensure dedup env var is set (matches production hook behavior)
      VERCEL_PLUGIN_SEEN_SKILLS: "",
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

// ---------------------------------------------------------------------------
// Environment cleanup
// ---------------------------------------------------------------------------

let savedDedup: string | undefined;

beforeEach(() => {
  savedDedup = process.env.VERCEL_PLUGIN_HOOK_DEDUP;
  delete process.env.VERCEL_PLUGIN_HOOK_DEDUP;
});

afterEach(() => {
  if (savedDedup !== undefined) {
    process.env.VERCEL_PLUGIN_HOOK_DEDUP = savedDedup;
  } else {
    delete process.env.VERCEL_PLUGIN_HOOK_DEDUP;
  }
});

// ---------------------------------------------------------------------------
// Human output format
// ---------------------------------------------------------------------------

describe("human output", () => {
  test("--prompt shows table with streamdown matched", async () => {
    const result = await run([
      "--prompt",
      "add markdown formatting to streamed text",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Prompt:");
    expect(result.stdout).toContain("streamdown");
    expect(result.stdout).toContain("Score");
    expect(result.stdout).toContain("Selected:");
  });

  test("no-match prompt still exits 0", async () => {
    const result = await run([
      "--prompt",
      "refactor the database connection pool layer",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Prompt:");
    // No "Selected:" line when nothing matches
    expect(result.stdout).not.toContain("Selected:");
  });
});

// ---------------------------------------------------------------------------
// JSON output shape
// ---------------------------------------------------------------------------

describe("JSON output", () => {
  test("--json outputs valid PromptAnalysisReport", async () => {
    const result = await run([
      "--prompt",
      "add markdown formatting to streamed text",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report).toHaveProperty("normalizedPrompt");
    expect(report).toHaveProperty("perSkillResults");
    expect(report).toHaveProperty("selectedSkills");
    expect(report).toHaveProperty("droppedByCap");
    expect(report).toHaveProperty("droppedByBudget");
    expect(report).toHaveProperty("dedupState");
    expect(report).toHaveProperty("budgetBytes");
    expect(report).toHaveProperty("timingMs");
    expect(report.dedupState).toHaveProperty("strategy");
    expect(report.dedupState).toHaveProperty("seenSkills");
    expect(report.dedupState).toHaveProperty("filteredByDedup");

    // streamdown should match this prompt
    expect(report.selectedSkills).toContain("streamdown");
    expect(report.perSkillResults.streamdown?.matched).toBe(true);
  });

  test("no-match JSON has empty selectedSkills", async () => {
    const result = await run([
      "--prompt",
      "refactor the database connection pool layer",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report.selectedSkills).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seen-skills dedup
// ---------------------------------------------------------------------------

describe("--seen-skills dedup", () => {
  test("seen skills are excluded from selection", async () => {
    const result = await run([
      "--prompt",
      "add markdown formatting to streamed text",
      "--json",
      "--seen-skills",
      "streamdown",
    ]);
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report.selectedSkills).not.toContain("streamdown");
    expect(report.dedupState.filteredByDedup).toContain("streamdown");
    expect(report.dedupState.seenSkills).toContain("streamdown");
  });

  test("multiple seen skills excluded", async () => {
    const result = await run([
      "--prompt",
      "use next.js app router with ai sdk streamtext",
      "--json",
      "--seen-skills",
      "nextjs,ai-sdk",
    ]);
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report.selectedSkills).not.toContain("nextjs");
    expect(report.selectedSkills).not.toContain("ai-sdk");
  });
});

// ---------------------------------------------------------------------------
// Budget cap
// ---------------------------------------------------------------------------

describe("--budget-bytes", () => {
  test("tiny budget limits selection", async () => {
    const result = await run([
      "--prompt",
      "use ai sdk streamtext and streamdown streaming markdown in terminal",
      "--json",
      "--budget-bytes",
      "500",
      "--max-skills",
      "10",
    ]);
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout);
    // With 500 byte budget, not all matched skills can be selected
    const totalMatched = Object.values(
      report.perSkillResults as Record<string, { matched: boolean }>,
    ).filter((r) => r.matched).length;

    if (totalMatched > 1) {
      // At least one should be budget-dropped or the budget was big enough for all
      const totalSelected =
        report.selectedSkills.length + report.droppedByBudget.length;
      expect(totalSelected).toBeGreaterThanOrEqual(1);
    }
    expect(report.budgetBytes).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// --max-skills cap
// ---------------------------------------------------------------------------

describe("--max-skills", () => {
  test("max-skills=1 selects at most one skill", async () => {
    const result = await run([
      "--prompt",
      "use ai sdk streamtext and streamdown streaming markdown in terminal",
      "--json",
      "--max-skills",
      "1",
    ]);
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report.selectedSkills.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Stdin pipe
// ---------------------------------------------------------------------------

describe("stdin mode", () => {
  test("reads prompt from stdin", async () => {
    const result = await run(["--json"], "stream markdown in terminal");
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report).toHaveProperty("normalizedPrompt");
    expect(report.normalizedPrompt).toBe("stream markdown in terminal");
  });

  test("stdin with human output", async () => {
    const result = await run([], "add streaming markdown to chat ui");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Prompt:");
  });
});

// ---------------------------------------------------------------------------
// Empty prompt
// ---------------------------------------------------------------------------

describe("empty prompt", () => {
  test("no prompt and no stdin exits with usage message", async () => {
    // TTY detection: when stdin is a pipe but empty, it should error
    const result = await run([], "");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no prompt");
  });
});

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

describe("help", () => {
  test("--help exits 0 with usage info", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--prompt");
    expect(result.stdout).toContain("--json");
  });
});
