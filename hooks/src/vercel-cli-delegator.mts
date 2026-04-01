/**
 * Vercel CLI delegator — thin subprocess wrapper for bounded Vercel CLI
 * execution within hooks.
 *
 * The plugin detects what's needed (profiler), delegates to the real
 * `vercel` CLI for actions, and reads the results. This module handles
 * the "delegate" step for Vercel subcommands.
 *
 * Only `env-pull` is auto-delegated in SessionStart for this iteration.
 * `link` and `deploy` remain suggestion-only (surfaced in install plan).
 */

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  buildVercelCliCommand,
  type VercelSubcommand,
} from "./vercel-cli-command.mjs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunVercelCliArgs {
  projectRoot: string;
  subcommand: VercelSubcommand;
  flags?: string[];
}

export interface VercelCliRunResult {
  ok: boolean;
  subcommand: VercelSubcommand;
  command: string;
  stdout: string;
  stderr: string;
  changed: boolean;
}

export interface VercelCliDelegatorOptions {
  timeoutMs?: number;
  execFileImpl?: (
    file: string,
    args: string[],
    options: {
      cwd?: string;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
      maxBuffer?: number;
    },
  ) => Promise<{ stdout: string; stderr: string }>;
}

export interface VercelCliDelegator {
  run(args: RunVercelCliArgs): Promise<VercelCliRunResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envLocalExists(projectRoot: string): boolean {
  return existsSync(join(projectRoot, ".env.local"));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createVercelCliDelegator(
  options: VercelCliDelegatorOptions = {},
): VercelCliDelegator {
  const execImpl = options.execFileImpl ?? execFileAsync;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async run(args: RunVercelCliArgs): Promise<VercelCliRunResult> {
      const command = buildVercelCliCommand(args.subcommand, {
        flags: args.flags ?? [],
      });

      const beforeEnvLocal =
        args.subcommand === "env-pull"
          ? envLocalExists(args.projectRoot)
          : null;

      try {
        const { stdout, stderr } = await execImpl(
          command.file,
          command.args,
          {
            cwd: args.projectRoot,
            timeout: timeoutMs,
            env: { ...process.env, CI: "1" },
            maxBuffer: 1024 * 1024,
          },
        );

        const afterEnvLocal =
          args.subcommand === "env-pull"
            ? envLocalExists(args.projectRoot)
            : null;

        return {
          ok: true,
          subcommand: args.subcommand,
          command: command.printable,
          stdout,
          stderr,
          changed:
            args.subcommand === "env-pull"
              ? beforeEnvLocal === false && afterEnvLocal === true
              : true,
        };
      } catch (error) {
        const stdout =
          typeof error === "object" &&
          error !== null &&
          "stdout" in error &&
          typeof (error as { stdout?: unknown }).stdout === "string"
            ? (error as { stdout: string }).stdout
            : "";

        const stderr =
          typeof error === "object" &&
          error !== null &&
          "stderr" in error &&
          typeof (error as { stderr?: unknown }).stderr === "string"
            ? (error as { stderr: string }).stderr
            : error instanceof Error
              ? error.message
              : String(error);

        return {
          ok: false,
          subcommand: args.subcommand,
          command: command.printable,
          stdout,
          stderr,
          changed: false,
        };
      }
    },
  };
}
