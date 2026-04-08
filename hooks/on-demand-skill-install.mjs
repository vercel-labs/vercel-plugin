var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// hooks/src/on-demand-skill-install.mts
import { spawn } from "child_process";
import { closeSync, mkdirSync, openSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { loadRegistrySkillMetadata } from "./registry-skill-metadata.mjs";
import { deriveRegistryInstallSet } from "./orchestrator-install-plan.mjs";
import { buildSkillsAddCommand } from "./skills-cli-command.mjs";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { realpathSync } from "fs";
var SCAFFOLDING_PATTERNS = [
  /\bcreate-next-app\b/,
  /\bcreate-vite\b/,
  /\bcreate-remix\b/,
  /\bcreate-react-app\b/,
  /\bnpm\s+init\b/,
  /\bnpx\s+create-/
];
var SAFE_RE = /^[a-zA-Z0-9_-]+$/;
function installAttemptDirName(sessionId) {
  const segment = SAFE_RE.test(sessionId) ? sessionId : createHash("sha256").update(sessionId).digest("hex");
  return `vercel-plugin-${segment}-install-attempted.d`;
}
function installAttemptDir(sessionId) {
  return join(tmpdir(), installAttemptDirName(sessionId));
}
function tryClaimInstallAttempt(sessionId, skill) {
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
function clearInstallAttemptClaim(sessionId, skill) {
  try {
    unlinkSync(join(installAttemptDir(sessionId), encodeURIComponent(skill)));
  } catch {
  }
}
var EMPTY_RESULT = {
  triggered: [],
  alreadyAttempted: [],
  noRegistry: []
};
function triggerOnDemandInstall(options) {
  const {
    summaryOnlySkills,
    sessionId,
    projectRoot,
    pluginRoot,
    toolTarget,
    logger: log,
    spawnImpl = spawn
  } = options;
  if (summaryOnlySkills.length === 0 || !sessionId) {
    return EMPTY_RESULT;
  }
  if (toolTarget && SCAFFOLDING_PATTERNS.some((re) => re.test(toolTarget))) {
    log?.debug?.("on-demand-install-skipped-scaffolding", { toolTarget });
    return EMPTY_RESULT;
  }
  const registryMetadata = loadRegistrySkillMetadata(pluginRoot);
  const triggered = [];
  const alreadyAttempted = [];
  const noRegistry = [];
  const newlyClaimed = [];
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
  const installSet = deriveRegistryInstallSet({
    missingSkills: newlyClaimed,
    registryMetadata
  });
  for (const group of installSet.groups) {
    const installNames = group.installTargets.map((t) => t.installName);
    const command = buildSkillsAddCommand(group.registry, installNames);
    if (!command) continue;
    log?.debug?.("on-demand-install-spawn", {
      registry: group.registry,
      skills: group.requestedSkills,
      command: command.printable,
      cwd: projectRoot
    });
    try {
      const child = spawnImpl(command.file, command.args, {
        cwd: projectRoot,
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      triggered.push(...group.requestedSkills);
    } catch (err) {
      for (const skill of group.requestedSkills) {
        clearInstallAttemptClaim(sessionId, skill);
      }
      log?.debug?.("on-demand-install-spawn-error", {
        registry: group.registry,
        skills: group.requestedSkills,
        error: String(err)
      });
    }
  }
  for (const skill of installSet.nonRegistryMissingSkills) {
    if (!noRegistry.includes(skill)) {
      noRegistry.push(skill);
    }
  }
  return { triggered, alreadyAttempted, noRegistry };
}
function isMainModule() {
  try {
    const scriptPath = realpathSync(resolve(process.argv[1] || ""));
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return scriptPath === modulePath;
  } catch {
    return false;
  }
}
function run() {
  let raw;
  try {
    raw = __require("fs").readFileSync(0, "utf-8");
  } catch {
    return "{}";
  }
  const parsed = JSON.parse(raw);
  const sessionId = parsed.session_id ?? parsed.conversation_id;
  const cwd = parsed.cwd ?? process.cwd();
  const toolName = parsed.tool_name || "";
  const toolInput = parsed.tool_input || {};
  const toolTarget = toolName === "Bash" ? toolInput.command || "" : toolInput.file_path || "";
  if (!sessionId || !cwd) {
    return "{}";
  }
  const result = {};
  return JSON.stringify(result);
}
if (isMainModule()) {
  try {
    const output = run();
    process.stdout.write(output);
  } catch (err) {
    const entry = [
      `[${(/* @__PURE__ */ new Date()).toISOString()}] CRASH in on-demand-skill-install.mts`,
      `  error: ${err?.message || String(err)}`,
      `  stack: ${err?.stack || "(no stack)"}`,
      ""
    ].join("\n");
    process.stderr.write(entry);
    process.stdout.write("{}");
  }
}
export {
  clearInstallAttemptClaim,
  installAttemptDir,
  installAttemptDirName,
  triggerOnDemandInstall,
  tryClaimInstallAttempt
};
