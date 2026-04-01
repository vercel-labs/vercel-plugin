// hooks/src/vercel-cli-delegator.mts
import { existsSync } from "fs";
import { execFile } from "child_process";
import { join } from "path";
import { promisify } from "util";
import {
  buildVercelCliCommand
} from "./vercel-cli-command.mjs";
var execFileAsync = promisify(execFile);
function envLocalExists(projectRoot) {
  return existsSync(join(projectRoot, ".env.local"));
}
function createVercelCliDelegator(options = {}) {
  const execImpl = options.execFileImpl ?? execFileAsync;
  const timeoutMs = options.timeoutMs ?? 1e4;
  return {
    async run(args) {
      const command = buildVercelCliCommand(args.subcommand, {
        flags: args.flags ?? []
      });
      const beforeEnvLocal = args.subcommand === "env-pull" ? envLocalExists(args.projectRoot) : null;
      try {
        const { stdout, stderr } = await execImpl(
          command.file,
          command.args,
          {
            cwd: args.projectRoot,
            timeout: timeoutMs,
            env: { ...process.env, CI: "1" },
            maxBuffer: 1024 * 1024
          }
        );
        const afterEnvLocal = args.subcommand === "env-pull" ? envLocalExists(args.projectRoot) : null;
        return {
          ok: true,
          subcommand: args.subcommand,
          command: command.printable,
          stdout,
          stderr,
          changed: args.subcommand === "env-pull" ? beforeEnvLocal === false && afterEnvLocal === true : true
        };
      } catch (error) {
        const stdout = typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
        const stderr = typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" ? error.stderr : error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          subcommand: args.subcommand,
          command: command.printable,
          stdout,
          stderr,
          changed: false
        };
      }
    }
  };
}
export {
  createVercelCliDelegator
};
