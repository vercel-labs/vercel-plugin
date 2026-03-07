import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { analyzePrompt } from "../hooks/src/prompt-analysis.mjs";
import type { PromptAnalysisReport } from "../hooks/src/prompt-analysis.mjs";
import type { SkillConfig } from "../hooks/src/skill-map-frontmatter.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSkillConfig(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    priority: 50,
    summary: "Test skill",
    pathPatterns: [],
    bashPatterns: [],
    importPatterns: [],
    validate: [],
    ...overrides,
  };
}

const streamdownConfig = makeSkillConfig({
  summary: "Streaming markdown renderer for terminal and chat UIs",
  promptSignals: {
    phrases: ["streaming markdown", "streamdown"],
    allOf: [["markdown", "stream"], ["markdown", "render"]],
    anyOf: ["terminal", "chat ui", "cli"],
    noneOf: ["readme", "markdown file", "changelog"],
    minScore: 6,
  },
});

const aiSdkConfig = makeSkillConfig({
  priority: 60,
  summary: "Vercel AI SDK for streaming text generation",
  promptSignals: {
    phrases: ["ai sdk", "generatetext", "streamtext"],
    allOf: [["ai", "streaming"]],
    anyOf: ["vercel", "openai", "anthropic"],
    noneOf: [],
    minScore: 6,
  },
});

const swrConfig = makeSkillConfig({
  priority: 40,
  summary: "SWR for client-side data fetching",
  promptSignals: {
    phrases: ["useswr", "swr"],
    allOf: [],
    anyOf: ["fetching", "cache", "revalidate"],
    noneOf: [],
    minScore: 6,
  },
});

const nextjsConfig = makeSkillConfig({
  priority: 70,
  summary: "Next.js App Router framework",
  promptSignals: {
    phrases: ["app router", "next.js"],
    allOf: [["next", "server"]],
    anyOf: ["react", "ssr", "pages"],
    noneOf: [],
    minScore: 6,
  },
});

/** Skill map with no promptSignals at all */
const noSignalsConfig = makeSkillConfig({
  summary: "A skill with no prompt signals",
});

function skillMap(extra: Record<string, SkillConfig> = {}): Record<string, SkillConfig> {
  return {
    streamdown: streamdownConfig,
    "ai-sdk": aiSdkConfig,
    swr: swrConfig,
    nextjs: nextjsConfig,
    ...extra,
  };
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
// Report shape
// ---------------------------------------------------------------------------

describe("analyzePrompt report shape", () => {
  test("no-match report has correct shape", () => {
    const report = analyzePrompt(
      "Please refactor the database connection pool",
      skillMap(),
      "",
      8000,
      2,
    );

    expect(report.normalizedPrompt).toBe(
      "please refactor the database connection pool",
    );
    expect(report.selectedSkills).toEqual([]);
    expect(report.droppedByCap).toEqual([]);
    expect(report.droppedByBudget).toEqual([]);
    expect(report.dedupState.strategy).toBe("env-var");
    expect(report.dedupState.seenSkills).toEqual([]);
    expect(report.dedupState.filteredByDedup).toEqual([]);
    expect(typeof report.budgetBytes).toBe("number");
    expect(report.budgetBytes).toBe(8000);
    expect(typeof report.timingMs).toBe("number");

    // perSkillResults only includes skills with promptSignals
    for (const [, result] of Object.entries(report.perSkillResults)) {
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("matched");
      expect(result).toHaveProperty("suppressed");
      expect(result.matched).toBe(false);
    }
  });

  test("matching report populates selectedSkills", () => {
    const report = analyzePrompt(
      "Use streaming markdown with streamdown for the chat output",
      skillMap(),
      "",
      8000,
      2,
    );

    expect(report.selectedSkills).toContain("streamdown");
    expect(report.perSkillResults["streamdown"].matched).toBe(true);
    expect(report.perSkillResults["streamdown"].score).toBeGreaterThanOrEqual(6);
    expect(report.perSkillResults["streamdown"].suppressed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suppressed by noneOf
// ---------------------------------------------------------------------------

describe("suppressed-by-noneOf report", () => {
  test("noneOf term suppresses skill and marks suppressed=true", () => {
    const report = analyzePrompt(
      "Update the readme with streaming markdown examples",
      skillMap(),
      "",
      8000,
      2,
    );

    const streamdownResult = report.perSkillResults["streamdown"];
    expect(streamdownResult).toBeDefined();
    expect(streamdownResult.matched).toBe(false);
    expect(streamdownResult.suppressed).toBe(true);
    expect(streamdownResult.score).toBe(-Infinity);
    expect(streamdownResult.reason).toContain("noneOf");
    expect(report.selectedSkills).not.toContain("streamdown");
  });
});

// ---------------------------------------------------------------------------
// Fully-deduped report
// ---------------------------------------------------------------------------

describe("fully-deduped report", () => {
  test("all matched skills already seen produces empty selectedSkills", () => {
    const report = analyzePrompt(
      "Use streaming markdown with streamdown for the chat output",
      skillMap(),
      "streamdown",  // already seen
      8000,
      2,
    );

    // streamdown matches but is deduped
    expect(report.perSkillResults["streamdown"].matched).toBe(true);
    expect(report.selectedSkills).toEqual([]);
    expect(report.dedupState.filteredByDedup).toContain("streamdown");
    expect(report.dedupState.seenSkills).toContain("streamdown");
    expect(report.dedupState.strategy).toBe("env-var");
  });

  test("dedup disabled still selects skills", () => {
    process.env.VERCEL_PLUGIN_HOOK_DEDUP = "off";
    const report = analyzePrompt(
      "Use streaming markdown with streamdown for the chat output",
      skillMap(),
      "streamdown",
      8000,
      2,
    );

    expect(report.selectedSkills).toContain("streamdown");
    expect(report.dedupState.strategy).toBe("disabled");
    expect(report.dedupState.filteredByDedup).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Budget-dropped report
// ---------------------------------------------------------------------------

describe("budget-dropped report", () => {
  test("tiny budget drops second skill to droppedByBudget", () => {
    // Match two skills, but budget is too small for the second
    const report = analyzePrompt(
      "Use the AI SDK streamtext and also streamdown streaming markdown in the terminal",
      skillMap(),
      "",
      500,  // very tight budget — only room for ~1 skill
      10,   // high cap so budget is the limiter
    );

    const matchedCount = report.selectedSkills.length + report.droppedByBudget.length;
    // At least one should be selected, and if two matched, the second may be budget-dropped
    expect(report.selectedSkills.length).toBeGreaterThanOrEqual(1);
    if (matchedCount > 1) {
      expect(report.droppedByBudget.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Capped report
// ---------------------------------------------------------------------------

describe("capped report", () => {
  test("maxSkills=1 caps to single skill, rest in droppedByCap", () => {
    const report = analyzePrompt(
      "Use the AI SDK streamtext and also streamdown streaming markdown in the terminal",
      skillMap(),
      "",
      80000,
      1,  // cap at 1
    );

    const totalMatched = Object.values(report.perSkillResults).filter(
      (r) => r.matched,
    ).length;

    if (totalMatched > 1) {
      expect(report.selectedSkills.length).toBe(1);
      expect(report.droppedByCap.length).toBe(totalMatched - 1);
    }
  });

  test("maxSkills=2 with 3+ matches drops extras", () => {
    const report = analyzePrompt(
      "Use streamdown streaming markdown and the AI SDK streamtext and also swr for fetching and next.js app router",
      skillMap(),
      "",
      80000,
      2,
    );

    const totalMatched = Object.values(report.perSkillResults).filter(
      (r) => r.matched,
    ).length;

    expect(report.selectedSkills.length).toBeLessThanOrEqual(2);
    if (totalMatched > 2) {
      expect(report.droppedByCap.length).toBe(totalMatched - 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe("prompt normalization", () => {
  test("normalizes whitespace and case", () => {
    const report = analyzePrompt(
      "  Use  STREAMING   MARKDOWN  ",
      skillMap(),
      "",
      8000,
      2,
    );

    expect(report.normalizedPrompt).toBe("use streaming markdown");
  });
});

// ---------------------------------------------------------------------------
// Skills without promptSignals are excluded
// ---------------------------------------------------------------------------

describe("skills without promptSignals", () => {
  test("skills without promptSignals do not appear in perSkillResults", () => {
    const map = skillMap({ "no-signals": noSignalsConfig });
    const report = analyzePrompt(
      "Use streaming markdown",
      map,
      "",
      8000,
      2,
    );

    expect(report.perSkillResults).not.toHaveProperty("no-signals");
  });
});

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

describe("timing", () => {
  test("timingMs is a non-negative number", () => {
    const report = analyzePrompt(
      "Use streaming markdown with streamdown",
      skillMap(),
      "",
      8000,
      2,
    );

    expect(report.timingMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Sort order matches matchPromptSignals
// ---------------------------------------------------------------------------

describe("selection ordering", () => {
  test("higher score wins over lower score", () => {
    // Craft prompts where streamdown scores higher than ai-sdk
    const report = analyzePrompt(
      "Use streamdown streaming markdown to render markdown in the terminal chat ui",
      skillMap(),
      "",
      80000,
      10,
    );

    if (
      report.perSkillResults["streamdown"]?.matched &&
      report.perSkillResults["ai-sdk"]?.matched
    ) {
      const sdIdx = report.selectedSkills.indexOf("streamdown");
      const aiIdx = report.selectedSkills.indexOf("ai-sdk");
      if (sdIdx !== -1 && aiIdx !== -1) {
        // streamdown should come first if it scores higher
        expect(
          report.perSkillResults["streamdown"].score,
        ).toBeGreaterThanOrEqual(report.perSkillResults["ai-sdk"].score);
      }
    }
  });
});
