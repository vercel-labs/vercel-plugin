import { describe, test, expect } from "bun:test";
import {
  classifyTroubleshootingIntent,
  normalizePromptText,
} from "../hooks/src/prompt-patterns.mts";
import type { TroubleshootingIntentResult } from "../hooks/src/prompt-patterns.mts";

function classify(raw: string): TroubleshootingIntentResult {
  return classifyTroubleshootingIntent(normalizePromptText(raw));
}

// ---------------------------------------------------------------------------
// Flow-verification bucket: "X but Y" patterns
// ---------------------------------------------------------------------------

describe("flow-verification intent", () => {
  test("'loads but shows wrong data' → verification", () => {
    const r = classify("The page loads but shows the wrong data");
    expect(r.intent).toBe("flow-verification");
    expect(r.skills).toEqual(["verification"]);
  });

  test("'submits but nothing happens' → verification", () => {
    const r = classify("The form submits but nothing happens after");
    expect(r.intent).toBe("flow-verification");
    expect(r.skills).toEqual(["verification"]);
  });

  test("'redirects but loses session' → verification", () => {
    const r = classify("It redirects but the user loses their session");
    expect(r.intent).toBe("flow-verification");
    expect(r.skills).toEqual(["verification"]);
  });

  test("'works locally but fails on Vercel' → verification", () => {
    const r = classify("The API works locally but fails when deployed to Vercel");
    expect(r.intent).toBe("flow-verification");
    expect(r.skills).toEqual(["verification"]);
  });

  test("'deploys but 500 errors' → verification", () => {
    const r = classify("It deploys but I get 500 errors on the API route");
    expect(r.intent).toBe("flow-verification");
    expect(r.skills).toEqual(["verification"]);
  });
});

// ---------------------------------------------------------------------------
// Stuck-investigation bucket: stuck/hung/frozen/timeout
// ---------------------------------------------------------------------------

describe("stuck-investigation intent", () => {
  test("'it's stuck' → investigation-mode", () => {
    const r = classify("The dev server seems stuck and won't process requests");
    expect(r.intent).toBe("stuck-investigation");
    expect(r.skills).toEqual(["investigation-mode"]);
  });

  test("'request keeps timing out' → investigation-mode", () => {
    const r = classify("My API request keeps timing out after 10 seconds");
    expect(r.intent).toBe("stuck-investigation");
    expect(r.skills).toEqual(["investigation-mode"]);
  });

  test("'page seems frozen' → investigation-mode", () => {
    const r = classify("The whole page seems frozen, nothing responds to clicks");
    expect(r.intent).toBe("stuck-investigation");
    expect(r.skills).toEqual(["investigation-mode"]);
  });

  test("'still waiting for response' → investigation-mode", () => {
    const r = classify("I'm still waiting for the response, it's been minutes");
    expect(r.intent).toBe("stuck-investigation");
    expect(r.skills).toEqual(["investigation-mode"]);
  });
});

// ---------------------------------------------------------------------------
// Browser-only bucket: blank page / white screen / console errors
// ---------------------------------------------------------------------------

describe("browser-only intent", () => {
  test("'blank page after deploy' → browser + investigation", () => {
    const r = classify("I'm getting a blank page after deploying the latest changes");
    expect(r.intent).toBe("browser-only");
    expect(r.skills).toContain("agent-browser-verify");
    expect(r.skills).toContain("investigation-mode");
  });

  test("'white screen on localhost' → browser + investigation", () => {
    const r = classify("The app shows a white screen on localhost:3000");
    expect(r.intent).toBe("browser-only");
    expect(r.skills).toContain("agent-browser-verify");
    expect(r.skills).toContain("investigation-mode");
  });

  test("'console errors in the browser' → browser + investigation", () => {
    const r = classify("There are console errors in the browser when I load the page");
    expect(r.intent).toBe("browser-only");
    expect(r.skills).toContain("agent-browser-verify");
    expect(r.skills).toContain("investigation-mode");
  });

  test("'nothing renders on the page' → browser + investigation", () => {
    const r = classify("Nothing renders on the page, it's completely empty");
    expect(r.intent).toBe("browser-only");
    expect(r.skills).toContain("agent-browser-verify");
    expect(r.skills).toContain("investigation-mode");
  });
});

// ---------------------------------------------------------------------------
// Test framework suppression
// ---------------------------------------------------------------------------

describe("test framework suppression", () => {
  test("'vitest' suppresses all verification-family skills", () => {
    const r = classify("Run vitest to check if the auth flow works correctly");
    expect(r.intent).toBe(null);
    expect(r.skills).toEqual([]);
    expect(r.reason).toContain("test framework");
  });

  test("'jest' suppresses all verification-family skills", () => {
    const r = classify("Why is jest failing on the submission handler?");
    expect(r.intent).toBe(null);
    expect(r.skills).toEqual([]);
    expect(r.reason).toContain("test framework");
  });

  test("'playwright test' suppresses all verification-family skills", () => {
    const r = classify("The playwright test shows a blank page in the screenshot");
    expect(r.intent).toBe(null);
    expect(r.skills).toEqual([]);
    expect(r.reason).toContain("test framework");
  });

  test("'cypress test' suppresses even stuck patterns", () => {
    const r = classify("The cypress test is stuck on the login redirect");
    expect(r.intent).toBe(null);
    expect(r.skills).toEqual([]);
    expect(r.reason).toContain("test framework");
  });
});

// ---------------------------------------------------------------------------
// No intent (normal prompts)
// ---------------------------------------------------------------------------

describe("no troubleshooting intent", () => {
  test("normal coding prompt returns null intent", () => {
    const r = classify("Add a new API route for user profile updates");
    expect(r.intent).toBe(null);
    expect(r.skills).toEqual([]);
  });

  test("empty prompt returns null intent", () => {
    const r = classify("");
    expect(r.intent).toBe(null);
  });
});
