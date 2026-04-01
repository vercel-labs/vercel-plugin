import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createVercelCliDelegator,
  type VercelCliDelegator,
  type VercelCliRunResult,
  type RunVercelCliArgs,
} from "../hooks/src/vercel-cli-delegator.mts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `vercel-cli-delegator-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createVercelCliDelegator", () => {
  test("env-pull marks changed=true when .env.local appears during run", async () => {
    const projectRoot = makeTempDir();
    try {
      const delegator = createVercelCliDelegator({
        execFileImpl: async (_file, _args, options) => {
          writeFileSync(join(options.cwd!, ".env.local"), "TOKEN=1\n", "utf8");
          return { stdout: "Created .env.local", stderr: "" };
        },
      });

      const result = await delegator.run({
        projectRoot,
        subcommand: "env-pull",
      });

      expect(result.ok).toBe(true);
      expect(result.command).toBe("vercel env pull --yes");
      expect(result.changed).toBe(true);
      expect(result.stdout).toBe("Created .env.local");
      expect(existsSync(join(projectRoot, ".env.local"))).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("env-pull marks changed=false when .env.local already existed", async () => {
    const projectRoot = makeTempDir();
    try {
      writeFileSync(join(projectRoot, ".env.local"), "EXISTING=1\n", "utf8");

      const delegator = createVercelCliDelegator({
        execFileImpl: async () => ({ stdout: "", stderr: "" }),
      });

      const result = await delegator.run({
        projectRoot,
        subcommand: "env-pull",
      });

      expect(result.ok).toBe(true);
      expect(result.changed).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("returns ok=false on subprocess failure with captured stderr", async () => {
    const delegator = createVercelCliDelegator({
      execFileImpl: async () => {
        throw Object.assign(new Error("not authenticated"), {
          stdout: "partial output",
          stderr: "Error: not authenticated",
        });
      },
    });

    const result = await delegator.run({
      projectRoot: "/repo",
      subcommand: "env-pull",
    });

    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.stderr).toContain("not authenticated");
    expect(result.stdout).toBe("partial output");
    expect(result.command).toBe("vercel env pull --yes");
  });

  test("returns ok=false with error message when stderr is missing", async () => {
    const delegator = createVercelCliDelegator({
      execFileImpl: async () => {
        throw new Error("ETIMEDOUT");
      },
    });

    const result = await delegator.run({
      projectRoot: "/repo",
      subcommand: "env-pull",
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("ETIMEDOUT");
    expect(result.stdout).toBe("");
  });

  test("defaults to 10s timeout", async () => {
    let capturedTimeout: number | undefined;

    const delegator = createVercelCliDelegator({
      execFileImpl: async (_file, _args, options) => {
        capturedTimeout = options.timeout;
        return { stdout: "", stderr: "" };
      },
    });

    await delegator.run({ projectRoot: "/repo", subcommand: "env-pull" });
    expect(capturedTimeout).toBe(10_000);
  });

  test("sets CI=1 in subprocess environment", async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;

    const delegator = createVercelCliDelegator({
      execFileImpl: async (_file, _args, options) => {
        capturedEnv = options.env;
        return { stdout: "", stderr: "" };
      },
    });

    await delegator.run({ projectRoot: "/repo", subcommand: "env-pull" });
    expect(capturedEnv?.CI).toBe("1");
  });

  test("respects custom timeout", async () => {
    let capturedTimeout: number | undefined;

    const delegator = createVercelCliDelegator({
      timeoutMs: 5_000,
      execFileImpl: async (_file, _args, options) => {
        capturedTimeout = options.timeout;
        return { stdout: "", stderr: "" };
      },
    });

    await delegator.run({ projectRoot: "/repo", subcommand: "env-pull" });
    expect(capturedTimeout).toBe(5_000);
  });

  test("deploy subcommand returns changed=true on success", async () => {
    const delegator = createVercelCliDelegator({
      execFileImpl: async () => ({ stdout: "https://app.vercel.app", stderr: "" }),
    });

    const result = await delegator.run({
      projectRoot: "/repo",
      subcommand: "deploy",
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.command).toBe("vercel deploy");
  });

  test("passes extra flags through to command", async () => {
    let capturedArgs: string[] = [];

    const delegator = createVercelCliDelegator({
      execFileImpl: async (_file, args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "" };
      },
    });

    await delegator.run({
      projectRoot: "/repo",
      subcommand: "env-pull",
      flags: ["--environment", "production"],
    });

    expect(capturedArgs).toContain("--environment");
    expect(capturedArgs).toContain("production");
  });
});
