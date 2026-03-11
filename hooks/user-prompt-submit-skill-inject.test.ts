import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import {
  dedupClaimDirPath,
  dedupFilePath,
  readSessionFile,
  tryClaimSessionKey,
  writeSessionFile,
} from "./src/hook-env.mts";
import {
  formatOutput,
  parsePromptInput,
  resolvePromptSeenSkillState,
  syncPromptSeenSkillClaims,
} from "./src/user-prompt-submit-skill-inject.mts";

const SESSION_KIND = "seen-skills";
const originalSeenSkills = process.env.VERCEL_PLUGIN_SEEN_SKILLS;
const originalDedupMode = process.env.VERCEL_PLUGIN_HOOK_DEDUP;
const touchedSessionIds = new Set<string>();

function restoreEnv(name: "VERCEL_PLUGIN_SEEN_SKILLS" | "VERCEL_PLUGIN_HOOK_DEDUP", value: string | undefined): void {
  if (typeof value === "string") {
    process.env[name] = value;
    return;
  }
  delete process.env[name];
}

function cleanupSession(sessionId: string): void {
  rmSync(dedupFilePath(sessionId, SESSION_KIND), { force: true });
  rmSync(dedupClaimDirPath(sessionId, SESSION_KIND), { recursive: true, force: true });
}

function newSessionId(name: string): string {
  const sessionId = `user-prompt-submit-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  touchedSessionIds.add(sessionId);
  return sessionId;
}

afterEach(() => {
  restoreEnv("VERCEL_PLUGIN_SEEN_SKILLS", originalSeenSkills);
  restoreEnv("VERCEL_PLUGIN_HOOK_DEDUP", originalDedupMode);
  for (const sessionId of touchedSessionIds) {
    cleanupSession(sessionId);
  }
  touchedSessionIds.clear();
});

describe("user prompt seen-skills dedup state", () => {
  it("test_resolvePromptSeenSkillState_merges_env_file_and_claims_when_session_id_present", () => {
    const sessionId = newSessionId("merge");

    process.env.VERCEL_PLUGIN_HOOK_DEDUP = "";
    process.env.VERCEL_PLUGIN_SEEN_SKILLS = "skill-env,shared";
    writeSessionFile(sessionId, SESSION_KIND, "skill-file,shared");
    tryClaimSessionKey(sessionId, SESSION_KIND, "skill-claim");

    const state = resolvePromptSeenSkillState(sessionId);

    expect(state.dedupOff).toBe(false);
    expect(state.hasFileDedup).toBe(true);
    expect(state.hasEnvDedup).toBe(true);
    expect(state.seenClaims).toBe("skill-claim");
    expect(state.seenState).toBe("shared,skill-claim,skill-env,skill-file");
    expect(readSessionFile(sessionId, SESSION_KIND)).toBe(state.seenState);
    expect(process.env.VERCEL_PLUGIN_SEEN_SKILLS).toBe(state.seenState);
  });

  it("test_syncPromptSeenSkillClaims_updates_claims_and_session_file_when_skills_injected", () => {
    const sessionId = newSessionId("sync");

    process.env.VERCEL_PLUGIN_SEEN_SKILLS = "skill-env";
    const synced = syncPromptSeenSkillClaims(sessionId, ["skill-new", "skill-env"]);

    expect(synced).toBe("skill-env,skill-new");
    expect(readSessionFile(sessionId, SESSION_KIND)).toBe("skill-env,skill-new");
    expect(process.env.VERCEL_PLUGIN_SEEN_SKILLS).toBe("skill-env,skill-new");
  });
});

describe("user prompt cursor compatibility", () => {
  it("test_parsePromptInput_normalizes_cursor_fields_when_workspace_root_present", () => {
    const parsed = parsePromptInput(
      JSON.stringify({
        conversation_id: "cursor-conversation",
        workspace_roots: ["/tmp/cursor-workspace", "/tmp/ignored"],
        cursor_version: "1.0.0",
        prompt: "Use ai elements for streaming markdown in this chat UI",
      }),
    );

    expect(parsed).toEqual({
      prompt: "Use ai elements for streaming markdown in this chat UI",
      platform: "cursor",
      sessionId: "cursor-conversation",
      cwd: "/tmp/cursor-workspace",
    });
  });

  it("test_parsePromptInput_uses_cursor_message_and_project_dir_fallbacks", () => {
    const parsed = parsePromptInput(
      JSON.stringify({
        conversation_id: "cursor-conversation",
        cursor_version: "1.0.0",
        message: "Use ai elements for streaming markdown in this chat UI",
      }),
      undefined,
      {
        ...process.env,
        CURSOR_PROJECT_DIR: "/tmp/cursor-project",
        CLAUDE_PROJECT_ROOT: "/tmp/claude-project",
      },
    );

    expect(parsed).toEqual({
      prompt: "Use ai elements for streaming markdown in this chat UI",
      platform: "cursor",
      sessionId: "cursor-conversation",
      cwd: "/tmp/cursor-project",
    });
  });

  it("test_formatOutput_returns_cursor_flat_shape_with_continue_and_env", () => {
    const output = JSON.parse(formatOutput(
      ["You must run the Skill(ai-elements) tool."],
      ["ai-elements"],
      ["ai-elements"],
      [],
      [],
      [],
      { "ai-elements": "matched streaming markdown" },
      undefined,
      "cursor",
      { VERCEL_PLUGIN_SEEN_SKILLS: "ai-elements" },
    ));

    expect(output.continue).toBe(true);
    expect(output.additional_context).toContain("Skill(ai-elements)");
    expect(output.additional_context).toContain("skillInjection");
    expect(output.env).toEqual({ VERCEL_PLUGIN_SEEN_SKILLS: "ai-elements" });
    expect(output.hookSpecificOutput).toBeUndefined();
  });
});
