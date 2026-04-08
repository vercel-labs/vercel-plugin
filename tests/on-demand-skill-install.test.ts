import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  triggerOnDemandInstall,
  tryClaimInstallAttempt,
  installAttemptDir,
  installAttemptDirName,
  type OnDemandInstallOptions,
} from "../hooks/src/on-demand-skill-install.mts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const TMP = join(tmpdir(), `vp-on-demand-test-${Date.now()}`);
const PLUGIN_ROOT = join(import.meta.dirname, "..");

let sessionCounter = 0;
function uniqueSessionId(): string {
  return `test-on-demand-${Date.now()}-${++sessionCounter}`;
}

type SpawnCall = {
  file: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
  stdio?: string;
};

function mockSpawn() {
  const calls: SpawnCall[] = [];
  const impl = ((file: string, args: string[], opts?: Record<string, unknown>) => {
    calls.push({
      file,
      args,
      cwd: opts?.cwd as string | undefined,
      detached: opts?.detached as boolean | undefined,
      stdio: opts?.stdio as string | undefined,
    });
    return { unref: () => {} };
  }) as unknown as typeof import("node:child_process").spawn;
  return { calls, impl };
}

function cleanupSession(sessionId: string) {
  const dir = installAttemptDir(sessionId);
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tryClaimInstallAttempt
// ---------------------------------------------------------------------------

describe("tryClaimInstallAttempt", () => {
  test("first claim returns true, second returns false", () => {
    const sid = uniqueSessionId();
    try {
      expect(tryClaimInstallAttempt(sid, "ai-sdk")).toBe(true);
      expect(tryClaimInstallAttempt(sid, "ai-sdk")).toBe(false);
    } finally {
      cleanupSession(sid);
    }
  });

  test("different skills can both be claimed", () => {
    const sid = uniqueSessionId();
    try {
      expect(tryClaimInstallAttempt(sid, "ai-sdk")).toBe(true);
      expect(tryClaimInstallAttempt(sid, "nextjs")).toBe(true);
    } finally {
      cleanupSession(sid);
    }
  });

  test("different sessions are independent", () => {
    const sid1 = uniqueSessionId();
    const sid2 = uniqueSessionId();
    try {
      expect(tryClaimInstallAttempt(sid1, "ai-sdk")).toBe(true);
      expect(tryClaimInstallAttempt(sid2, "ai-sdk")).toBe(true);
    } finally {
      cleanupSession(sid1);
      cleanupSession(sid2);
    }
  });

  test("creates directory structure", () => {
    const sid = uniqueSessionId();
    try {
      tryClaimInstallAttempt(sid, "test-skill");
      const dir = installAttemptDir(sid);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "test-skill"))).toBe(true);
    } finally {
      cleanupSession(sid);
    }
  });
});

// ---------------------------------------------------------------------------
// installAttemptDirName
// ---------------------------------------------------------------------------

describe("installAttemptDirName", () => {
  test("safe session IDs are used directly", () => {
    const name = installAttemptDirName("abc-123_test");
    expect(name).toBe("vercel-plugin-abc-123_test-install-attempted.d");
  });

  test("unsafe session IDs are hashed", () => {
    const name = installAttemptDirName("has spaces/and/slashes");
    expect(name).toMatch(/^vercel-plugin-[a-f0-9]{64}-install-attempted\.d$/);
  });

  test("directory name ends with .d for session-end-cleanup compatibility", () => {
    const name = installAttemptDirName("test-session");
    expect(name.endsWith(".d")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// triggerOnDemandInstall
// ---------------------------------------------------------------------------

describe("triggerOnDemandInstall", () => {
  test("returns empty result for empty summaryOnlySkills", () => {
    const result = triggerOnDemandInstall({
      summaryOnlySkills: [],
      sessionId: "test",
      projectRoot: TMP,
      pluginRoot: PLUGIN_ROOT,
    });
    expect(result.triggered).toEqual([]);
    expect(result.alreadyAttempted).toEqual([]);
    expect(result.noRegistry).toEqual([]);
  });

  test("returns empty result for missing sessionId", () => {
    const result = triggerOnDemandInstall({
      summaryOnlySkills: ["ai-sdk"],
      sessionId: "",
      projectRoot: TMP,
      pluginRoot: PLUGIN_ROOT,
    });
    expect(result.triggered).toEqual([]);
  });

  test("skills without registry backing go to noRegistry", () => {
    const sid = uniqueSessionId();
    const { impl } = mockSpawn();
    try {
      const result = triggerOnDemandInstall({
        summaryOnlySkills: ["nonexistent-skill-xyz"],
        sessionId: sid,
        projectRoot: TMP,
        pluginRoot: PLUGIN_ROOT,
        spawnImpl: impl,
      });
      expect(result.noRegistry).toContain("nonexistent-skill-xyz");
      expect(result.triggered).toEqual([]);
    } finally {
      cleanupSession(sid);
    }
  });

  test("registry-backed skills trigger spawn with correct args", () => {
    const sid = uniqueSessionId();
    const { calls, impl } = mockSpawn();
    try {
      // Use a skill we know is in the manifest with registry backing
      // Most skills in the vercel-plugin manifest have registry: "vercel/vercel-skills"
      const result = triggerOnDemandInstall({
        summaryOnlySkills: ["ai-sdk"],
        sessionId: sid,
        projectRoot: TMP,
        pluginRoot: PLUGIN_ROOT,
        spawnImpl: impl,
      });

      if (result.triggered.length > 0) {
        expect(result.triggered).toContain("ai-sdk");
        expect(calls.length).toBeGreaterThan(0);

        const call = calls[0];
        expect(call.file).toMatch(/npx/);
        expect(call.args).toContain("skills");
        expect(call.args).toContain("add");
        expect(call.args).toContain("--skill");
        expect(call.args).toContain("-y");
        expect(call.args).toContain("--copy");
        expect(call.cwd).toBe(TMP);
        expect(call.detached).toBe(true);
        expect(call.stdio).toBe("ignore");
      } else {
        // If ai-sdk isn't in the manifest with registry, it goes to noRegistry
        expect(result.noRegistry).toContain("ai-sdk");
      }
    } finally {
      cleanupSession(sid);
    }
  });

  test("second call with same skills reports alreadyAttempted", () => {
    const sid = uniqueSessionId();
    const { impl } = mockSpawn();
    try {
      const result1 = triggerOnDemandInstall({
        summaryOnlySkills: ["ai-sdk"],
        sessionId: sid,
        projectRoot: TMP,
        pluginRoot: PLUGIN_ROOT,
        spawnImpl: impl,
      });

      const result2 = triggerOnDemandInstall({
        summaryOnlySkills: ["ai-sdk"],
        sessionId: sid,
        projectRoot: TMP,
        pluginRoot: PLUGIN_ROOT,
        spawnImpl: impl,
      });

      // On second call, everything should be already attempted or noRegistry
      if (result1.triggered.includes("ai-sdk")) {
        expect(result2.alreadyAttempted).toContain("ai-sdk");
        expect(result2.triggered).not.toContain("ai-sdk");
      }
    } finally {
      cleanupSession(sid);
    }
  });

  test("skills from same registry are grouped into one spawn", () => {
    const sid = uniqueSessionId();
    const { calls, impl } = mockSpawn();
    try {
      const result = triggerOnDemandInstall({
        summaryOnlySkills: ["ai-sdk", "nextjs"],
        sessionId: sid,
        projectRoot: TMP,
        pluginRoot: PLUGIN_ROOT,
        spawnImpl: impl,
      });

      // If both are registry-backed from the same registry, expect 1 spawn call
      const registryBacked = result.triggered;
      if (registryBacked.length >= 2) {
        // Same registry → one spawn with multiple --skill flags
        expect(calls.length).toBe(1);
        const skillFlags = calls[0].args.filter((_, i, arr) => i > 0 && arr[i - 1] === "--skill");
        expect(skillFlags.length).toBeGreaterThanOrEqual(2);
      }
    } finally {
      cleanupSession(sid);
    }
  });

  test("spawn errors are caught and do not throw", () => {
    const sid = uniqueSessionId();
    const throwingSpawn = (() => {
      throw new Error("spawn failed");
    }) as unknown as typeof import("node:child_process").spawn;

    try {
      // Should not throw
      const result = triggerOnDemandInstall({
        summaryOnlySkills: ["ai-sdk"],
        sessionId: sid,
        projectRoot: TMP,
        pluginRoot: PLUGIN_ROOT,
        spawnImpl: throwingSpawn,
      });
      // Spawn failed, so nothing triggered
      expect(result.triggered).toEqual([]);
    } finally {
      cleanupSession(sid);
    }
  });

  test("mixed registry and non-registry skills are partitioned correctly", () => {
    const sid = uniqueSessionId();
    const { calls, impl } = mockSpawn();
    try {
      const result = triggerOnDemandInstall({
        summaryOnlySkills: ["ai-sdk", "totally-fake-skill-zzz"],
        sessionId: sid,
        projectRoot: TMP,
        pluginRoot: PLUGIN_ROOT,
        spawnImpl: impl,
      });

      expect(result.noRegistry).toContain("totally-fake-skill-zzz");
      // ai-sdk is either triggered or noRegistry depending on manifest state
      if (result.triggered.includes("ai-sdk")) {
        expect(calls.length).toBeGreaterThan(0);
      }
    } finally {
      cleanupSession(sid);
    }
  });
});
