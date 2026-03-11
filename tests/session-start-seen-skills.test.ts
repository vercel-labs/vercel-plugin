import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  dedupClaimDirPath,
  dedupFilePath,
  removeSessionClaimDir,
  tryClaimSessionKey,
} from "../hooks/src/hook-env.mts";

const ROOT = resolve(import.meta.dirname, "..");
const HOOKS_JSON = join(ROOT, "hooks", "hooks.json");
const SCRIPT = join(ROOT, "hooks", "session-start-seen-skills.mjs");

async function runSessionStart(
  env: Record<string, string | undefined>,
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const mergedEnv: Record<string, string> = { ...(process.env as Record<string, string>) };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete mergedEnv[key];
      continue;
    }
    mergedEnv[key] = value;
  }

  const proc = Bun.spawn(["node", SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: mergedEnv,
  });

  if (typeof stdin === "string") {
    proc.stdin.write(stdin);
  }
  proc.stdin.end();

  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { code, stdout, stderr };
}

async function resolveSeenSkillsValue(envFile: string): Promise<string | null> {
  const proc = Bun.spawn(
    ["bash", "-lc", 'source "$TARGET_ENV_FILE"; if [ -z "${VERCEL_PLUGIN_SEEN_SKILLS+x}" ]; then printf "UNSET"; else printf "%s" "$VERCEL_PLUGIN_SEEN_SKILLS"; fi'],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...(process.env as Record<string, string>),
        TARGET_ENV_FILE: envFile,
      },
    },
  );

  await proc.exited;
  const out = (await new Response(proc.stdout).text()).trim();
  return out === "UNSET" ? null : out;
}

describe("session-start-seen-skills hook", () => {
  test("test_script_exists", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  test("test_hooks_json_places_session_start_script_before_inject", () => {
    const hooks = JSON.parse(readFileSync(HOOKS_JSON, "utf-8"));
    const sessionStart = hooks.hooks.SessionStart[0];

    expect(sessionStart.matcher).toBe("startup|resume|clear|compact");
    expect(sessionStart.hooks[0].type).toBe("command");
    expect(sessionStart.hooks[0].command).toBe(
      'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start-seen-skills.mjs"',
    );
    expect(sessionStart.hooks[1].type).toBe("command");
    expect(sessionStart.hooks[1].command).toBe(
      'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start-profiler.mjs"',
    );
    expect(sessionStart.hooks[2].type).toBe("command");
    expect(sessionStart.hooks[2].command).toBe(
      'node "${CLAUDE_PLUGIN_ROOT}/hooks/inject-claude-md.mjs"',
    );
  });

  test("test_session_start_appends_seen_skills_export_when_env_file_seeded", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "session-start-seen-skills-"));
    const envFile = join(tempDir, "claude.env");

    try {
      writeFileSync(envFile, "export SEEDED=1\n", "utf-8");

      const result = await runSessionStart({ CLAUDE_ENV_FILE: envFile });
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("export SEEDED=1\n");
      // Env-var based dedup: exports an empty comma-delimited string
      expect(content).toMatch(/export VERCEL_PLUGIN_SEEN_SKILLS=""/);

      // Sourcing the env file should set VERCEL_PLUGIN_SEEN_SKILLS to empty string (not unset)
      const seenValue = await resolveSeenSkillsValue(envFile);
      expect(seenValue).toBe("");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("test_session_start_exits_cleanly_without_claude_env_file", async () => {
    const result = await runSessionStart({ CLAUDE_ENV_FILE: undefined });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("test_session_start_returns_cursor_env_json_when_cursor_payload_is_present", async () => {
    const result = await runSessionStart(
      { CLAUDE_ENV_FILE: undefined },
      JSON.stringify({ conversation_id: "cursor-conversation" }),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      env: {
        VERCEL_PLUGIN_SEEN_SKILLS: "",
      },
    });
  });
});

describe("hook-env session temp path guards", () => {
  test("test_dedup_claim_dir_path_keeps_safe_session_ids_stable", () => {
    expect(dedupClaimDirPath("sess_abc-123", "seen-skills")).toBe(
      join(resolve(tmpdir()), "vercel-plugin-sess_abc-123-seen-skills.d"),
    );
  });

  test("test_dedup_paths_hash_invalid_session_ids_before_joining_tmpdir", () => {
    const sessionId = "agent/../../home/user/.ssh";
    const expectedHash = createHash("sha256").update(sessionId).digest("hex");
    const tempRoot = resolve(tmpdir());

    expect(dedupClaimDirPath(sessionId, "seen-skills")).toBe(
      join(tempRoot, `vercel-plugin-${expectedHash}-seen-skills.d`),
    );
    expect(dedupFilePath(sessionId, "validated-files")).toBe(
      join(tempRoot, `vercel-plugin-${expectedHash}-validated-files.txt`),
    );
  });

  test("test_remove_session_claim_dir_only_removes_hashed_tmpdir_for_invalid_session_ids", () => {
    const sessionId = "nested/../../../../etc";
    const claimDir = dedupClaimDirPath(sessionId, "seen-skills");

    try {
      expect(tryClaimSessionKey(sessionId, "seen-skills", "nextjs")).toBe(true);
      expect(existsSync(claimDir)).toBe(true);

      removeSessionClaimDir(sessionId, "seen-skills");

      expect(existsSync(claimDir)).toBe(false);
      expect(claimDir.startsWith(`${resolve(tmpdir())}${sep}`)).toBe(true);
      expect(claimDir.includes("../../")).toBe(false);
    } finally {
      rmSync(claimDir, { recursive: true, force: true });
    }
  });
});
