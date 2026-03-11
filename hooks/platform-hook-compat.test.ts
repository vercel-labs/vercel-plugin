import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatOutput as formatPreToolOutput,
  parseInput as parsePreToolInput,
} from "./src/pretooluse-skill-inject.mts";
import {
  formatOutput as formatPostToolOutput,
  parseInput as parsePostToolInput,
} from "./src/posttooluse-validate.mts";
import type { ValidationViolation } from "./src/posttooluse-validate.mts";

const tempDirs = new Set<string>();

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("platform hook compatibility", () => {
  it("test_parseInput_normalizes_cursor_session_and_workspace_root_for_pretooluse", () => {
    const parsed = parsePreToolInput(
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "app/page.tsx" },
        conversation_id: "cursor-conversation",
        workspace_roots: ["/tmp/cursor-workspace"],
      }),
      undefined,
      {
        ...process.env,
        CURSOR_PROJECT_DIR: "/tmp/cursor-project",
        CLAUDE_PROJECT_ROOT: "/tmp/claude-project",
      },
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.platform).toBe("cursor");
    expect(parsed?.sessionId).toBe("cursor-conversation");
    expect(parsed?.cwd).toBe("/tmp/cursor-workspace");
  });

  it("test_formatOutput_returns_cursor_env_only_payload_when_pretooluse_has_no_context", () => {
    const output = formatPreToolOutput({
      parts: [],
      matched: new Set(),
      injectedSkills: [],
      droppedByCap: [],
      toolName: "Write",
      toolTarget: "app/page.tsx",
      platform: "cursor",
      env: {
        VERCEL_PLUGIN_TSX_EDIT_COUNT: "2",
      },
    });

    expect(JSON.parse(output)).toEqual({
      env: {
        VERCEL_PLUGIN_TSX_EDIT_COUNT: "2",
      },
    });
  });

  it("test_formatOutput_returns_cursor_flat_payload_with_env_for_pretooluse", () => {
    const output = formatPreToolOutput({
      parts: ["You must run the Skill(ai-sdk) tool."],
      matched: new Set(["ai-sdk"]),
      injectedSkills: ["ai-sdk"],
      droppedByCap: [],
      toolName: "Write",
      toolTarget: "app/page.tsx",
      platform: "cursor",
      env: {
        VERCEL_PLUGIN_SEEN_SKILLS: "ai-sdk",
        VERCEL_PLUGIN_TSX_EDIT_COUNT: "1",
      },
    });

    const parsed = JSON.parse(output);
    expect(parsed.additional_context).toContain("Skill(ai-sdk)");
    expect(parsed.env).toEqual({
      VERCEL_PLUGIN_SEEN_SKILLS: "ai-sdk",
      VERCEL_PLUGIN_TSX_EDIT_COUNT: "1",
    });
    expect(parsed.hookSpecificOutput).toBeUndefined();
  });

  it("test_parseInput_normalizes_cursor_project_dir_for_posttooluse", () => {
    const parsed = parsePostToolInput(
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: "app/page.tsx" },
        conversation_id: "cursor-conversation",
      }),
      undefined,
      {
        ...process.env,
        CURSOR_PROJECT_DIR: "/tmp/cursor-project",
        CLAUDE_PROJECT_ROOT: "/tmp/claude-project",
      },
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.platform).toBe("cursor");
    expect(parsed?.sessionId).toBe("cursor-conversation");
    expect(parsed?.cwd).toBe("/tmp/cursor-project");
  });

  it("test_formatOutput_returns_cursor_flat_payload_for_posttooluse", () => {
    const violations: ValidationViolation[] = [
      {
        skill: "ai-sdk",
        line: 8,
        message: "Use streamText for streaming responses.",
        severity: "recommended",
        matchedText: "generateText",
      },
    ];

    const output = formatPostToolOutput(
      violations,
      ["ai-sdk"],
      "app/page.tsx",
      undefined,
      "cursor",
    );

    const parsed = JSON.parse(output);
    expect(parsed.additional_context).toContain("VALIDATION");
    expect(parsed.additional_context).toContain("app/page.tsx");
    expect(parsed.hookSpecificOutput).toBeUndefined();
  });

  it("test_posttooluse_shadcn_font_fix_uses_cursor_workspace_root_and_returns_flat_output", () => {
    const projectRoot = createTempDir("vercel-plugin-shadcn-");
    mkdirSync(join(projectRoot, "app"), { recursive: true });
    writeFileSync(
      join(projectRoot, "app/globals.css"),
      [
        "@theme inline {",
        "  --font-sans: var(--font-sans);",
        "  --font-mono: var(--font-geist-mono);",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(process.execPath, ["hooks/posttooluse-shadcn-font-fix.mjs"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: {
        ...process.env,
        CURSOR_PROJECT_DIR: "/tmp/incorrect-cursor-project",
      },
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "npx shadcn@latest init" },
        conversation_id: "cursor-conversation",
        workspace_roots: [projectRoot],
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.additional_context).toContain("Auto-fix applied");
    expect(parsed.additionalContext).toBeUndefined();

    const content = readFileSync(join(projectRoot, "app/globals.css"), "utf-8");
    expect(content).toContain('"Geist", "Geist Fallback"');
    expect(content).toContain('"Geist Mono", "Geist Mono Fallback"');
  });
});
