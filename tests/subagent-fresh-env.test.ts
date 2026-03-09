import { describe, test, expect, beforeEach } from "bun:test";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK_SCRIPT = join(ROOT, "hooks", "pretooluse-skill-inject.mjs");
const UNLIMITED_BUDGET = "999999";
let testSession: string;

const EXPECTED_SLACK_ROUTE_SKILLS = ["chat-sdk", "vercel-functions", "nextjs"] as const;

beforeEach(() => {
  testSession = `subagent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

async function runHookEnv(
  input: { tool_name: string; tool_input: Record<string, string> },
  env: Record<string, string | undefined>,
  opts?: { omitSessionId?: boolean; omitSeenSkillsEnv?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const payload = opts?.omitSessionId
    ? JSON.stringify(input)
    : JSON.stringify({ ...input, session_id: testSession });
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    VERCEL_PLUGIN_INJECTION_BUDGET: UNLIMITED_BUDGET,
    ...env,
  };
  if (opts?.omitSeenSkillsEnv) delete childEnv.VERCEL_PLUGIN_SEEN_SKILLS;
  const proc = Bun.spawn(["node", HOOK_SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv,
  });
  proc.stdin.write(payload);
  proc.stdin.end();
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

function parseInjectedSkills(stdout: string): string[] {
  const parsed = JSON.parse(stdout);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  const match = ctx.match(/<!-- skillInjection: (\{.*?\}) -->/);
  const si = match ? JSON.parse(match[1]) : {};
  const injectedSkills = si.injectedSkills;
  return Array.isArray(injectedSkills) ? injectedSkills : [];
}

function parseDebugLines(stderr: string): Array<Record<string, unknown>> {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("subagent fresh env dedup behavior", () => {
  const slackRoutePath = "/Users/me/slack-clone/app/api/slack/route.ts";

  test("fresh subagent without inherited seen-skills env re-injects the same skills as the lead agent", async () => {
    const { code: leadCode, stdout: leadStdout } = await runHookEnv(
      { tool_name: "Read", tool_input: { file_path: slackRoutePath } },
      { VERCEL_PLUGIN_SEEN_SKILLS: "", VERCEL_PLUGIN_HOOK_DEBUG: "1" },
    );

    expect(leadCode).toBe(0);
    const leadInjected = parseInjectedSkills(leadStdout);
    expect(leadInjected).toEqual(EXPECTED_SLACK_ROUTE_SKILLS);

    const leadSeen = leadInjected.join(",");

    const { code: leadSecondCode, stdout: leadSecondStdout } = await runHookEnv(
      { tool_name: "Read", tool_input: { file_path: slackRoutePath } },
      { VERCEL_PLUGIN_SEEN_SKILLS: leadSeen },
    );

    expect(leadSecondCode).toBe(0);
    expect(JSON.parse(leadSecondStdout)).toEqual({});

    const leadSession = testSession;
    const subagentSession = `subagent-child-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testSession = subagentSession;
    let subagentResult: { code: number; stdout: string; stderr: string };
    try {
      subagentResult = await runHookEnv(
        { tool_name: "Read", tool_input: { file_path: slackRoutePath } },
        { VERCEL_PLUGIN_HOOK_DEBUG: "1" },
        { omitSeenSkillsEnv: true },
      );
    } finally {
      testSession = leadSession;
    }
    const {
      code: subagentCode,
      stdout: subagentStdout,
      stderr: subagentStderr,
    } = subagentResult;

    expect(subagentCode).toBe(0);
    expect(parseInjectedSkills(subagentStdout)).toEqual(EXPECTED_SLACK_ROUTE_SKILLS);

    const subagentDebugLines = parseDebugLines(subagentStderr);
    const dedupStrategy = subagentDebugLines.find((line) => line.event === "dedup-strategy");
    expect(dedupStrategy).toBeDefined();
    expect(dedupStrategy?.strategy).toBe("file");
  });

  test("fresh subagent with its own empty seen-skills env uses file strategy but still injects", async () => {
    const { code, stdout, stderr } = await runHookEnv(
      { tool_name: "Read", tool_input: { file_path: slackRoutePath } },
      { VERCEL_PLUGIN_SEEN_SKILLS: "", VERCEL_PLUGIN_HOOK_DEBUG: "1" },
    );

    expect(code).toBe(0);
    expect(parseInjectedSkills(stdout)).toEqual(EXPECTED_SLACK_ROUTE_SKILLS);

    const debugLines = parseDebugLines(stderr);
    const dedupStrategy = debugLines.find((line) => line.event === "dedup-strategy");
    expect(dedupStrategy).toBeDefined();
    expect(dedupStrategy?.strategy).toBe("file");
  });

  test("subagent that explicitly inherits the lead seen-skills list is deduped", async () => {
    const { code, stdout } = await runHookEnv(
      { tool_name: "Read", tool_input: { file_path: slackRoutePath } },
      { VERCEL_PLUGIN_SEEN_SKILLS: "chat-sdk,vercel-functions,nextjs" },
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  test("subagent with agent_id uses isolated scope so parent dedup does not suppress it", async () => {
    // Lead agent injects skills first
    const { code: leadCode, stdout: leadStdout } = await runHookEnv(
      { tool_name: "Read", tool_input: { file_path: slackRoutePath } },
      { VERCEL_PLUGIN_SEEN_SKILLS: "" },
    );
    expect(leadCode).toBe(0);
    const leadInjected = parseInjectedSkills(leadStdout);
    expect(leadInjected).toEqual(EXPECTED_SLACK_ROUTE_SKILLS);

    // Subagent with distinct session and no inherited seen-skills
    // simulates scope isolation — skills re-inject
    const subSession = `subagent-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const origSession = testSession;
    testSession = subSession;
    try {
      const { code, stdout } = await runHookEnv(
        { tool_name: "Read", tool_input: { file_path: slackRoutePath } },
        { VERCEL_PLUGIN_HOOK_DEBUG: "1" },
        { omitSeenSkillsEnv: true },
      );
      expect(code).toBe(0);
      const subInjected = parseInjectedSkills(stdout);
      // Subagent gets the same skills despite parent having injected them
      expect(subInjected).toEqual(EXPECTED_SLACK_ROUTE_SKILLS);
    } finally {
      testSession = origSession;
    }
  });
});
