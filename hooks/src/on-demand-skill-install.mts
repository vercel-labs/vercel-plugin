/**
 * On-demand skill installation — triggers background `npx skills add` for
 * summary-only skills that have registry backing.
 *
 * Called by PreToolUse and UserPromptSubmit after injection. The first tool
 * use gets summary guidance; subsequent tool uses get the full skill body
 * once the background install completes.
 */

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRegistrySkillMetadata } from "./registry-skill-metadata.mjs";
import { deriveRegistryInstallSet } from "./orchestrator-install-plan.mjs";
import { buildSkillsAddCommand } from "./skills-cli-command.mjs";
import type { Logger } from "./logger.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scaffolding commands that create project structure and require empty dirs.
 *  On-demand install must not race with these — skip if the current tool
 *  target matches any of these patterns. */
const SCAFFOLDING_PATTERNS = [
  /\bcreate-next-app\b/,
  /\bcreate-vite\b/,
  /\bcreate-remix\b/,
  /\bcreate-react-app\b/,
  /\bnpm\s+init\b/,
  /\bnpx\s+create-/,
];

export interface OnDemandInstallOptions {
  summaryOnlySkills: string[];
  sessionId: string;
  projectRoot: string;
  pluginRoot: string;
  /** The tool target (bash command or file path) that triggered this hook invocation */
  toolTarget?: string;
  logger?: Logger;
  /** Override for testing — replaces child_process.spawn */
  spawnImpl?: typeof spawn;
}

export interface OnDemandInstallResult {
  /** Skills for which a background install was spawned */
  triggered: string[];
  /** Skills skipped because install was already attempted this session */
  alreadyAttempted: string[];
  /** Skills with no registry backing (cannot be installed) */
  noRegistry: string[];
}

// ---------------------------------------------------------------------------
// Install-attempt tracking (session-scoped, atomic)
// ---------------------------------------------------------------------------

const SAFE_RE = /^[a-zA-Z0-9_-]+$/;

export function installAttemptDirName(sessionId: string): string {
  const segment = SAFE_RE.test(sessionId)
    ? sessionId
    : createHash("sha256").update(sessionId).digest("hex");
  return `vercel-plugin-${segment}-install-attempted.d`;
}

export function installAttemptDir(sessionId: string): string {
  return join(tmpdir(), installAttemptDirName(sessionId));
}

/**
 * Atomically claim an install attempt for a skill in this session.
 * Returns true if this is the first attempt, false if already claimed.
 */
export function tryClaimInstallAttempt(
  sessionId: string,
  skill: string,
): boolean {
  const dir = installAttemptDir(sessionId);
  mkdirSync(dir, { recursive: true });
  try {
    const fd = openSync(join(dir, encodeURIComponent(skill)), "wx");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear an install attempt claim so the skill can be retried.
 * Used when spawn() fails to allow future attempts.
 */
export function clearInstallAttemptClaim(
  sessionId: string,
  skill: string,
): void {
  try {
    unlinkSync(join(installAttemptDir(sessionId), encodeURIComponent(skill)));
  } catch {
    // Silently ignore — file may not exist
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const EMPTY_RESULT: OnDemandInstallResult = {
  triggered: [],
  alreadyAttempted: [],
  noRegistry: [],
};

export function triggerOnDemandInstall(
  options: OnDemandInstallOptions,
): OnDemandInstallResult {
  const {
    summaryOnlySkills,
    sessionId,
    projectRoot,
    pluginRoot,
    toolTarget,
    logger: log,
    spawnImpl = spawn,
  } = options;

  if (summaryOnlySkills.length === 0 || !sessionId) {
    return EMPTY_RESULT;
  }

  // Don't race with scaffolding commands that require empty directories.
  // The install writes skills-lock.json into projectRoot which causes
  // create-next-app and similar CLIs to fail.
  if (toolTarget && SCAFFOLDING_PATTERNS.some((re) => re.test(toolTarget))) {
    log?.debug?.("on-demand-install-skipped-scaffolding", { toolTarget });
    return EMPTY_RESULT;
  }

  // Load registry metadata to determine which skills can be installed
  const registryMetadata = loadRegistrySkillMetadata(pluginRoot);

  const triggered: string[] = [];
  const alreadyAttempted: string[] = [];
  const noRegistry: string[] = [];
  const newlyClaimed: string[] = [];

  for (const skill of summaryOnlySkills) {
    if (!registryMetadata.has(skill)) {
      noRegistry.push(skill);
      continue;
    }

    if (tryClaimInstallAttempt(sessionId, skill)) {
      newlyClaimed.push(skill);
    } else {
      alreadyAttempted.push(skill);
    }
  }

  if (newlyClaimed.length === 0) {
    return { triggered, alreadyAttempted, noRegistry };
  }

  // Group by registry and build install commands
  const installSet = deriveRegistryInstallSet({
    missingSkills: newlyClaimed,
    registryMetadata,
  });

  for (const group of installSet.groups) {
    const installNames = group.installTargets.map((t) => t.installName);
    const command = buildSkillsAddCommand(group.registry, installNames);
    if (!command) continue;

    log?.debug?.("on-demand-install-spawn", {
      registry: group.registry,
      skills: group.requestedSkills,
      command: command.printable,
      cwd: projectRoot,
    });

    try {
      const child = spawnImpl(command.file, command.args, {
        cwd: projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      triggered.push(...group.requestedSkills);
    } catch (err) {
      // Clear claims so these skills can be retried on the next invocation
      for (const skill of group.requestedSkills) {
        clearInstallAttemptClaim(sessionId, skill);
      }
      log?.debug?.("on-demand-install-spawn-error", {
        registry: group.registry,
        skills: group.requestedSkills,
        error: String(err),
      });
    }
  }

  // Skills that had registry backing but weren't in any group
  // (deriveRegistryInstallSet may filter them)
  for (const skill of installSet.nonRegistryMissingSkills) {
    if (!noRegistry.includes(skill)) {
      noRegistry.push(skill);
    }
  }

  return { triggered, alreadyAttempted, noRegistry };
}

// ---------------------------------------------------------------------------
// Hook entry point (runs when invoked as a standalone process)
// ---------------------------------------------------------------------------

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";

/** Detect whether this module is the main entry point (ESM equivalent of require.main === module). */
function isMainModule(): boolean {
  try {
    const scriptPath = realpathSync(resolve(process.argv[1] || ""));
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return scriptPath === modulePath;
  } catch {
    return false;
  }
}

/**
 * Parse stdin and trigger on-demand skill installation for summary-only skills.
 * This is called by the PreToolUse and UserPromptSubmit hooks as a separate process
 * after the main skill injection hook.
 *
 * Since this hook receives the same stdin as skill-inject but not its output,
 * it independently determines which skills would be summary-only by re-performing
 * the match/rank/budget logic.
 */
function run(): string {
  let raw: string;
  try {
    raw = require("fs").readFileSync(0, "utf-8");
  } catch {
    return "{}";
  }

  // Parse stdin (tool_name, tool_input, session_id, cwd, etc.)
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const sessionId = (parsed.session_id ?? parsed.conversation_id) as string | undefined;
  const cwd = (parsed.cwd ?? process.cwd()) as string;
  const toolName = (parsed.tool_name as string) || "";
  const toolInput = (parsed.tool_input as Record<string, unknown>) || {};
  const toolTarget = toolName === "Bash"
    ? ((toolInput.command as string) || "")
    : ((toolInput.file_path as string) || "");

  // Return empty JSON immediately if no session context
  if (!sessionId || !cwd) {
    return "{}";
  }

  // Trigger install for manifest-only skills
  // Since we don't have access to the skill injection result from the previous hook,
  // we just return empty. The actual install is already triggered by pretooluse-skill-inject.
  // This hook serves as a no-op placeholder for the registered hook contract.
  const result: SyncHookJSONOutput = {};
  return JSON.stringify(result);
}

if (isMainModule()) {
  try {
    const output = run();
    process.stdout.write(output);
  } catch (err) {
    const entry = [
      `[${new Date().toISOString()}] CRASH in on-demand-skill-install.mts`,
      `  error: ${(err as Error)?.message || String(err)}`,
      `  stack: ${(err as Error)?.stack || "(no stack)"}`,
      "",
    ].join("\n");
    process.stderr.write(entry);
    process.stdout.write("{}");
  }
}
