import { describe, test, expect, beforeEach } from "bun:test";
import {
  classifyBoundary,
  inferRoute,
  parseInput,
  isVerificationReport,
  run,
  type BoundaryType,
  type VerificationReport,
  type VerificationBoundaryEvent,
} from "../hooks/src/posttooluse-verification-observe.mts";

// ---------------------------------------------------------------------------
// 1. Boundary classification: browser commands → uiRender
// ---------------------------------------------------------------------------

describe("classifyBoundary", () => {
  test("browser/screenshot commands map to uiRender", () => {
    const cases = [
      "npx playwright test",
      "open https://localhost:3000",
      "puppeteer screenshot page.png",
    ];
    for (const cmd of cases) {
      const { boundary } = classifyBoundary(cmd);
      expect(boundary).toBe("uiRender" as BoundaryType);
    }
  });

  // 2. curl/fetch → clientRequest
  test("curl/wget/fetch commands map to clientRequest", () => {
    const cases = [
      "curl http://localhost:3000/api/users",
      "wget https://example.com/data.json",
      'fetch("http://localhost:3000/api")',
    ];
    for (const cmd of cases) {
      const { boundary } = classifyBoundary(cmd);
      expect(boundary).toBe("clientRequest" as BoundaryType);
    }
  });

  // 3. log tailing → serverHandler
  test("log tailing commands map to serverHandler", () => {
    const cases = [
      "tail -f /var/log/app.log",
      "vercel logs my-project",
      "vercel inspect deployment-id",
    ];
    for (const cmd of cases) {
      const { boundary } = classifyBoundary(cmd);
      expect(boundary).toBe("serverHandler" as BoundaryType);
    }
  });

  // 4. env reads → environment
  test("env read commands map to environment", () => {
    const cases = [
      "printenv DATABASE_URL",
      "vercel env pull",
      "cat .env.local",
      'echo $NODE_ENV',
    ];
    for (const cmd of cases) {
      const { boundary } = classifyBoundary(cmd);
      expect(boundary).toBe("environment" as BoundaryType);
    }
  });

  // 5. Unrelated commands → unknown
  test("unrelated commands map to unknown", () => {
    const cases = ["git status", "bun test", "ls -la", "npm install"];
    for (const cmd of cases) {
      const { boundary } = classifyBoundary(cmd);
      expect(boundary).toBe("unknown" as BoundaryType);
    }
  });

  // 6. matchedPattern label is non-empty for known boundaries
  test("matchedPattern is descriptive for known boundaries", () => {
    const { matchedPattern } = classifyBoundary("curl http://localhost:3000");
    expect(matchedPattern).not.toBe("none");
    expect(matchedPattern.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Story inference
// ---------------------------------------------------------------------------

describe("inferRoute", () => {
  // 7. Infers route from recent edits
  test("infers /settings from app/settings/page.tsx edit", () => {
    const route = inferRoute("curl http://localhost:3000", "app/settings/page.tsx");
    expect(route).toBe("/settings");
  });

  test("infers /api/users from app/api/users/route.ts edit", () => {
    const route = inferRoute("curl http://localhost:3000", "app/api/users/route.ts");
    expect(route).toBe("/api/users");
  });

  test("converts dynamic segments to :param notation", () => {
    const route = inferRoute("curl localhost:3000", "app/users/[id]/page.tsx");
    expect(route).toBe("/users/:id");
  });

  // 8. Falls back to URL in command
  test("extracts route from command URL when no recent edits", () => {
    const route = inferRoute("curl http://localhost:3000/api/auth/login");
    expect(route).toBe("/api/auth/login");
  });

  test("returns null when no route can be inferred", () => {
    const route = inferRoute("git status");
    expect(route).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

describe("parseInput", () => {
  test("parses valid Bash tool input", () => {
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "curl http://localhost:3000" },
      session_id: "test-session",
      cwd: "/home/user/project",
    });
    const result = parseInput(input);
    expect(result).not.toBeNull();
    expect(result!.command).toBe("curl http://localhost:3000");
    expect(result!.sessionId).toBe("test-session");
  });

  test("returns null for non-Bash tools", () => {
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test.ts" },
    });
    expect(parseInput(input)).toBeNull();
  });

  test("returns null for empty command", () => {
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "" },
    });
    expect(parseInput(input)).toBeNull();
  });

  test("returns null for empty stdin", () => {
    expect(parseInput("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Type guard: verification.report/v1
// ---------------------------------------------------------------------------

describe("isVerificationReport", () => {
  test("accepts valid report", () => {
    const report: VerificationReport = {
      type: "verification.report/v1",
      verificationId: "abc-123",
      boundaries: [
        {
          event: "verification.boundary_observed",
          boundary: "clientRequest",
          verificationId: "abc-123",
          command: "curl localhost:3000",
          matchedPattern: "http-client",
          inferredRoute: "/api/users",
          timestamp: new Date().toISOString(),
        },
      ],
      inferredRoute: "/api/users",
      storyContext: null,
      firstBrokenBoundary: null,
    };
    expect(isVerificationReport(report)).toBe(true);
  });

  test("rejects non-object", () => {
    expect(isVerificationReport(null)).toBe(false);
    expect(isVerificationReport("string")).toBe(false);
    expect(isVerificationReport(42)).toBe(false);
  });

  test("rejects wrong type field", () => {
    expect(
      isVerificationReport({
        type: "wrong",
        verificationId: "abc",
        boundaries: [],
      }),
    ).toBe(false);
  });

  test("rejects missing boundaries array", () => {
    expect(
      isVerificationReport({
        type: "verification.report/v1",
        verificationId: "abc",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run() integration
// ---------------------------------------------------------------------------

describe("run()", () => {
  test("returns {} for unknown boundary commands", () => {
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    expect(run(input)).toBe("{}");
  });

  test("returns {} for known boundary commands (observer-only, no additionalContext)", () => {
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "curl http://localhost:3000/api/users" },
    });
    // Observer emits log events but returns {} (no additionalContext injection)
    expect(run(input)).toBe("{}");
  });

  test("returns {} for non-Bash input", () => {
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "/tmp/foo.ts" },
    });
    expect(run(input)).toBe("{}");
  });
});
