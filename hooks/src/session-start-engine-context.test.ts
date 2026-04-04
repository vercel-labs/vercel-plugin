/**
 * Regression tests for Fast Lane rendering and normalizeNextActions
 * in session-start-engine-context.
 */

import { describe, expect, test } from "bun:test";
import type { ProfileNextAction } from "./profile-next-actions.mjs";
import { __test__ } from "./session-start-engine-context.mjs";

const {
  normalizeNextActions,
  fastLaneBadge,
  fastLaneDetail,
  buildFastLaneDisplay,
  renderFastLaneBlock,
} = __test__;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTIONS_FIXTURE: ProfileNextAction[] = [
  {
    id: "vercel-link",
    title: "Link this repo to Vercel",
    reason: "Connect local work to the right project before you pull env or deploy anything.",
    command: "vercel link",
    priority: 95,
  },
  {
    id: "vercel-env-pull",
    title: "Pull environment variables",
    reason: "Get local runtime state aligned before you debug auth, data, or build issues.",
    command: "vercel env pull",
    priority: 90,
  },
  {
    id: "vercel-deploy",
    title: "Ship a first deploy",
    reason: "Use one clean deploy to validate the happy path end to end.",
    command: "vercel deploy",
    priority: 70,
  },
];

// ---------------------------------------------------------------------------
// normalizeNextActions
// ---------------------------------------------------------------------------

describe("normalizeNextActions", () => {
  test("returns empty array for non-array input", () => {
    expect(normalizeNextActions(undefined)).toEqual([]);
    expect(normalizeNextActions(null)).toEqual([]);
    expect(normalizeNextActions("string")).toEqual([]);
    expect(normalizeNextActions(42)).toEqual([]);
    expect(normalizeNextActions({})).toEqual([]);
  });

  test("returns empty array for empty array", () => {
    expect(normalizeNextActions([])).toEqual([]);
  });

  test("filters out entries with empty or missing title", () => {
    const result = normalizeNextActions([
      { id: "vercel-link", title: "", reason: "r", priority: 10 },
      { id: "vercel-deploy", title: "   ", reason: "r", priority: 5 },
      { id: "vercel-env-pull", title: "Valid", reason: "r", priority: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid");
  });

  test("filters out null, undefined, and primitive entries", () => {
    const result = normalizeNextActions([
      null,
      undefined,
      false,
      0,
      "string",
      { id: "vercel-link", title: "OK", reason: "", priority: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("OK");
  });

  test("sorts by priority descending", () => {
    const result = normalizeNextActions([
      { id: "vercel-deploy", title: "C", reason: "", priority: 10 },
      { id: "vercel-link", title: "A", reason: "", priority: 95 },
      { id: "vercel-env-pull", title: "B", reason: "", priority: 50 },
    ]);
    expect(result.map((a) => a.priority)).toEqual([95, 50, 10]);
  });

  test("stable secondary sort by title when priorities match", () => {
    const result = normalizeNextActions([
      { id: "vercel-deploy", title: "Zebra", reason: "", priority: 50 },
      { id: "vercel-link", title: "Alpha", reason: "", priority: 50 },
      { id: "vercel-env-pull", title: "Middle", reason: "", priority: 50 },
    ]);
    expect(result.map((a) => a.title)).toEqual(["Alpha", "Middle", "Zebra"]);
  });

  test("trims whitespace from title, reason, and command", () => {
    const result = normalizeNextActions([
      {
        id: "vercel-link",
        title: "  Padded Title  ",
        reason: "  Padded Reason  ",
        command: "  vercel link  ",
        priority: 10,
      },
    ]);
    expect(result[0].title).toBe("Padded Title");
    expect(result[0].reason).toBe("Padded Reason");
    expect(result[0].command).toBe("vercel link");
  });

  test("normalizes missing command to null", () => {
    const result = normalizeNextActions([
      { id: "vercel-link", title: "No Command", reason: "r", priority: 1 },
    ]);
    expect(result[0].command).toBeNull();
  });

  test("normalizes whitespace-only command to null", () => {
    const result = normalizeNextActions([
      { id: "vercel-link", title: "T", reason: "r", command: "   ", priority: 1 },
    ]);
    expect(result[0].command).toBeNull();
  });

  test("defaults priority to 0 when missing", () => {
    const result = normalizeNextActions([
      { id: "vercel-link", title: "T", reason: "r" },
    ]);
    expect(result[0].priority).toBe(0);
  });

  test("defaults id to 'unknown' when missing", () => {
    const result = normalizeNextActions([
      { title: "T", reason: "r", priority: 1 },
    ]);
    expect(result[0].id).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// fastLaneBadge
// ---------------------------------------------------------------------------

describe("fastLaneBadge", () => {
  test("first item always gets 'Start here'", () => {
    expect(fastLaneBadge({ ...ACTIONS_FIXTURE[0], priority: 0 }, 0)).toBe("Start here");
  });

  test("priority >= 90 at non-zero index gets 'Do next'", () => {
    expect(fastLaneBadge({ ...ACTIONS_FIXTURE[0], priority: 90 }, 1)).toBe("Do next");
    expect(fastLaneBadge({ ...ACTIONS_FIXTURE[0], priority: 95 }, 2)).toBe("Do next");
  });

  test("priority >= 80 but < 90 at non-zero index gets 'Worth doing'", () => {
    expect(fastLaneBadge({ ...ACTIONS_FIXTURE[0], priority: 80 }, 1)).toBe("Worth doing");
    expect(fastLaneBadge({ ...ACTIONS_FIXTURE[0], priority: 85 }, 1)).toBe("Worth doing");
  });

  test("priority < 80 at non-zero index gets 'Later'", () => {
    expect(fastLaneBadge({ ...ACTIONS_FIXTURE[0], priority: 70 }, 1)).toBe("Later");
    expect(fastLaneBadge({ ...ACTIONS_FIXTURE[0], priority: 0 }, 2)).toBe("Later");
  });
});

// ---------------------------------------------------------------------------
// fastLaneDetail
// ---------------------------------------------------------------------------

describe("fastLaneDetail", () => {
  test("returns reason when present", () => {
    expect(fastLaneDetail(ACTIONS_FIXTURE[0], 0)).toBe(ACTIONS_FIXTURE[0].reason);
    expect(fastLaneDetail(ACTIONS_FIXTURE[1], 1)).toBe(ACTIONS_FIXTURE[1].reason);
  });

  test("returns default primary copy for index 0 without reason", () => {
    const noReason = { ...ACTIONS_FIXTURE[0], reason: "" };
    expect(fastLaneDetail(noReason, 0)).toBe(
      "This is the highest-leverage move based on the current project state.",
    );
  });

  test("returns ready-to-run for non-primary with command but no reason", () => {
    const noReason = { ...ACTIONS_FIXTURE[1], reason: "" };
    expect(fastLaneDetail(noReason, 1)).toBe("Ready to run when you are.");
  });

  test("returns null for non-primary without reason or command", () => {
    const noReasonNoCommand = { ...ACTIONS_FIXTURE[1], reason: "", command: null };
    expect(fastLaneDetail(noReasonNoCommand, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFastLaneDisplay
// ---------------------------------------------------------------------------

describe("buildFastLaneDisplay", () => {
  test("caps at 3 display actions", () => {
    const fourActions: ProfileNextAction[] = [
      ...ACTIONS_FIXTURE,
      { id: "bootstrap-project", title: "Fourth", reason: "", command: null, priority: 50 },
    ];
    expect(buildFastLaneDisplay(fourActions)).toHaveLength(3);
  });

  test("maps all display fields correctly", () => {
    const display = buildFastLaneDisplay(ACTIONS_FIXTURE);
    expect(display[0].badge).toBe("Start here");
    expect(display[0].headline).toBe("Link this repo to Vercel");
    expect(display[0].command).toBe("vercel link");
    expect(display[1].badge).toBe("Do next");
    expect(display[2].badge).toBe("Later");
  });
});

// ---------------------------------------------------------------------------
// renderFastLaneBlock
// ---------------------------------------------------------------------------

describe("renderFastLaneBlock", () => {
  test("returns hidden for empty actions at tier 0", () => {
    const result = renderFastLaneBlock([], { tier: 0 });
    expect(result.renderState).toBe("hidden");
    expect(result.block).toBeNull();
    expect(result.primaryActionId).toBeNull();
  });

  test("returns hidden for empty actions at tier 1", () => {
    const result = renderFastLaneBlock([], { tier: 1 });
    expect(result.renderState).toBe("hidden");
    expect(result.block).toBeNull();
  });

  test("returns empty-state block for empty actions at tier 2+", () => {
    const result = renderFastLaneBlock([], { tier: 2 });
    expect(result.renderState).toBe("empty");
    expect(result.block).toContain("## Fast Lane");
    expect(result.block).toContain("Nothing is obviously blocking");
    expect(result.primaryActionId).toBeNull();
  });

  test("returns empty-state block for empty actions at tier 3", () => {
    const result = renderFastLaneBlock([], { tier: 3 });
    expect(result.renderState).toBe("empty");
    expect(result.block).toContain("## Fast Lane");
  });

  test("renders actions block with correct structure", () => {
    const result = renderFastLaneBlock(ACTIONS_FIXTURE, { tier: 2 });
    expect(result.renderState).toBe("actions");
    expect(result.primaryActionId).toBe("vercel-link");
    expect(result.block).toContain("## Fast Lane");
    expect(result.block).toContain("A few good next moves");
  });

  test("primaryActionId matches first action's id", () => {
    const result = renderFastLaneBlock(ACTIONS_FIXTURE, { tier: 1 });
    expect(result.primaryActionId).toBe("vercel-link");
  });

  test("renders Run: lines for actions with commands", () => {
    const result = renderFastLaneBlock(ACTIONS_FIXTURE, { tier: 2 });
    expect(result.block).toContain("Run: `vercel link`");
    expect(result.block).toContain("Run: `vercel env pull`");
    expect(result.block).toContain("Run: `vercel deploy`");
  });

  test("omits Run: line for actions without commands", () => {
    const noCommandActions: ProfileNextAction[] = [
      { id: "vercel-link", title: "Do something", reason: "Because.", command: null, priority: 90 },
    ];
    const result = renderFastLaneBlock(noCommandActions, { tier: 2 });
    expect(result.block).not.toContain("Run:");
  });

  test("renders correct badges in output", () => {
    const result = renderFastLaneBlock(ACTIONS_FIXTURE, { tier: 2 });
    expect(result.block).toContain("**Start here:");
    expect(result.block).toContain("**Do next:");
    expect(result.block).toContain("**Later:");
  });

  test("renders detail after headline with em dash", () => {
    const result = renderFastLaneBlock(ACTIONS_FIXTURE, { tier: 2 });
    expect(result.block).toContain(
      "**Start here: Link this repo to Vercel** — Connect local work",
    );
  });

  test("full golden output matches expected markdown", () => {
    const result = renderFastLaneBlock(ACTIONS_FIXTURE, { tier: 2 });
    const expected = [
      "## Fast Lane",
      "_A few good next moves, in the order most likely to keep momentum._",
      "",
      "- **Start here: Link this repo to Vercel** — Connect local work to the right project before you pull env or deploy anything.",
      "  Run: `vercel link`",
      "- **Do next: Pull environment variables** — Get local runtime state aligned before you debug auth, data, or build issues.",
      "  Run: `vercel env pull`",
      "- **Later: Ship a first deploy** — Use one clean deploy to validate the happy path end to end.",
      "  Run: `vercel deploy`",
    ].join("\n");
    expect(result.block).toBe(expected);
  });
});
