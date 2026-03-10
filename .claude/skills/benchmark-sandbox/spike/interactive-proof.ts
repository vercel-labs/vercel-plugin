#!/usr/bin/env bun
/**
 * Spike: Prove interactive Claude Code session with hooks firing
 *
 * Acceptance criteria:
 *  1. Claude Code session starts inside sandbox and processes a prompt
 *  2. PreToolUse hook fires (verified by debug log or claim dir presence)
 *  3. UserPromptSubmit hook fires (verified by debug log)
 *  4. Session completes without hanging or falling back to non-interactive mode
 *  5. Debug logs and claim dir contents are extractable via readFile()
 *
 * Strategy:
 *  - Create sandbox with node24 + API credentials
 *  - Install Claude Code globally
 *  - Install vercel-plugin via npx add-plugin
 *  - Attempt interactive session with PTY wrapper (`script` command)
 *  - Fall back to direct runCommand if PTY wrapper unavailable
 *  - Extract debug logs + claim dir contents for verification
 */

import { Sandbox } from "@vercel/sandbox";

// ── helpers ──────────────────────────────────────────────────────────

function resolveApiKey(): string {
  const key =
    process.env.ANTHROPIC_API_KEY ??
    process.env.AI_GATEWAY_API_KEY ??
    process.env.VERCEL_API_KEY;
  if (!key) {
    console.error(
      "Missing API key. Set one of: ANTHROPIC_API_KEY, AI_GATEWAY_API_KEY, VERCEL_API_KEY"
    );
    process.exit(1);
  }
  return key;
}

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

type CmdResult = Awaited<
  ReturnType<InstanceType<typeof Sandbox>["runCommand"]>
>;

async function run(
  sandbox: InstanceType<typeof Sandbox>,
  cmd: string,
  args: string[],
  opts?: { timeout?: number; env?: Record<string, string> }
): Promise<{ out: string; err: string; exit: number }> {
  const result: CmdResult = await sandbox.runCommand(cmd, args, opts);
  return {
    out: (await result.stdout()).trim(),
    err: (await result.stderr()).trim(),
    exit: (result as any).exitCode ?? 0,
  };
}

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
  time: string;
}

// ── test prompt ──────────────────────────────────────────────────────

// Deliberately product-focused (not tech-focused) to exercise skill matching.
// Should trigger: nextjs, ai-sdk at minimum.
const TEST_PROMPT = `Create a Next.js app with a single page that uses the AI SDK to stream a response from a language model. The page should have an input field and a submit button. Keep it minimal.`;

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  const t0 = performance.now();
  const apiKey = resolveApiKey();
  const baseUrl = process.env.ANTHROPIC_BASE_URL;

  const results: StepResult[] = [];
  let sandbox: InstanceType<typeof Sandbox> | undefined;

  try {
    // ── Step 1: Create sandbox ───────────────────────────────────────
    console.log("[1/7] Creating sandbox (node24)...");
    const t1 = performance.now();
    const sandboxEnv: Record<string, string> = {
      ANTHROPIC_API_KEY: apiKey,
      // Enable trace-level hook logging so we can verify hook firing
      VERCEL_PLUGIN_LOG_LEVEL: "trace",
    };
    if (baseUrl) sandboxEnv.ANTHROPIC_BASE_URL = baseUrl;

    sandbox = await Sandbox.create({ runtime: "node24", env: sandboxEnv });
    results.push({
      step: "create-sandbox",
      ok: true,
      detail: `id=${sandbox.sandboxId}`,
      time: elapsed(t1),
    });
    console.log(`  OK: ${sandbox.sandboxId} (${elapsed(t1)})`);

    // ── Step 2: Install Claude Code ──────────────────────────────────
    console.log("[2/7] Installing Claude Code...");
    const t2 = performance.now();
    const install = await run(sandbox, "npm", [
      "install",
      "-g",
      "@anthropic-ai/claude-code",
    ]);
    results.push({
      step: "install-claude-code",
      ok: install.exit === 0,
      detail:
        install.exit === 0
          ? "exit=0"
          : `exit=${install.exit} err=${install.err.slice(0, 200)}`,
      time: elapsed(t2),
    });
    if (install.exit !== 0) throw new Error(`Claude Code install failed: ${install.err.slice(0, 300)}`);
    console.log(`  OK (${elapsed(t2)})`);

    // ── Step 3: Scaffold project + install plugin ────────────────────
    console.log("[3/7] Scaffolding project and installing plugin...");
    const t3 = performance.now();
    const projectDir = "/home/user/test-project";

    // Create a minimal project so hooks have a project context
    await run(sandbox, "mkdir", ["-p", projectDir]);
    await run(sandbox, "sh", [
      "-c",
      `cd ${projectDir} && npm init -y && npm install next react react-dom`,
    ]);

    // Install vercel-plugin into the project
    const pluginInstall = await run(sandbox, "sh", [
      "-c",
      `cd ${projectDir} && npx -y add-plugin https://github.com/vercel-labs/vercel-plugin -s project -y`,
    ]);
    const pluginOk =
      pluginInstall.exit === 0 ||
      pluginInstall.out.includes("successfully") ||
      pluginInstall.out.includes("added");
    results.push({
      step: "install-plugin",
      ok: pluginOk,
      detail: pluginOk
        ? "plugin installed"
        : `exit=${pluginInstall.exit} out=${pluginInstall.out.slice(0, 200)}`,
      time: elapsed(t3),
    });
    if (!pluginOk) throw new Error(`Plugin install failed: ${pluginInstall.out.slice(0, 300)}`);
    console.log(`  OK (${elapsed(t3)})`);

    // Verify hooks.json exists
    const hooksCheck = await run(sandbox, "sh", [
      "-c",
      `test -f ${projectDir}/.claude/hooks.json && echo EXISTS || echo MISSING`,
    ]);
    console.log(`  hooks.json: ${hooksCheck.out}`);

    // ── Step 4: Check for PTY wrapper availability ───────────────────
    console.log("[4/7] Checking PTY wrapper availability...");
    const t4 = performance.now();
    const scriptCheck = await run(sandbox, "sh", [
      "-c",
      "which script 2>/dev/null && echo FOUND || echo MISSING",
    ]);
    const hasScript = scriptCheck.out.includes("FOUND");
    // Also check for unbuffer as alternative
    const unbufferCheck = await run(sandbox, "sh", [
      "-c",
      "which unbuffer 2>/dev/null && echo FOUND || echo MISSING",
    ]);
    const hasUnbuffer = unbufferCheck.out.includes("FOUND");
    results.push({
      step: "pty-check",
      ok: true, // informational
      detail: `script=${hasScript ? "yes" : "no"} unbuffer=${hasUnbuffer ? "yes" : "no"}`,
      time: elapsed(t4),
    });
    console.log(
      `  script: ${hasScript ? "yes" : "no"}, unbuffer: ${hasUnbuffer ? "yes" : "no"}`
    );

    // ── Step 5: Run interactive Claude Code session ──────────────────
    console.log("[5/7] Running Claude Code session...");
    const t5 = performance.now();

    // Build the claude command. Key flags:
    //   --dangerously-skip-permissions: avoids interactive permission prompts
    //   --settings: point to plugin settings
    //   The prompt is passed as a positional argument
    //
    // We try multiple approaches in order:
    //   1. `script` PTY wrapper (most likely to trigger hooks)
    //   2. Direct `claude` invocation (may work if SDK detects session context)
    const settingsPath = `${projectDir}/.claude/settings.json`;
    const escapedPrompt = TEST_PROMPT.replace(/'/g, "'\\''");

    let sessionResult: { out: string; err: string; exit: number };
    let sessionMethod: string;

    if (hasScript) {
      // `script -qec` wraps the command in a PTY on Linux
      // -q: quiet (no "Script started" banner)
      // -e: return exit code of child
      // -c: command to run
      sessionMethod = "script-pty";
      const scriptCmd = [
        "-c",
        `cd ${projectDir} && VERCEL_PLUGIN_LOG_LEVEL=trace script -qec 'claude --dangerously-skip-permissions --verbose "${escapedPrompt}"' /dev/null`,
      ];
      sessionResult = await run(sandbox, "sh", scriptCmd, {
        timeout: 120_000, // 2 min for a simple prompt
      });
    } else {
      // Direct invocation — hooks may or may not fire
      sessionMethod = "direct";
      sessionResult = await run(
        sandbox,
        "sh",
        [
          "-c",
          `cd ${projectDir} && claude --dangerously-skip-permissions --verbose '${escapedPrompt}'`,
        ],
        { timeout: 120_000 }
      );
    }

    const sessionOk = sessionResult.exit === 0;
    results.push({
      step: "claude-session",
      ok: sessionOk,
      detail: `method=${sessionMethod} exit=${sessionResult.exit} out_len=${sessionResult.out.length} err_len=${sessionResult.err.length}`,
      time: elapsed(t5),
    });
    console.log(
      `  ${sessionOk ? "OK" : "FAIL"}: method=${sessionMethod} exit=${sessionResult.exit} (${elapsed(t5)})`
    );
    if (sessionResult.out.length > 0) {
      console.log(`  stdout preview: ${sessionResult.out.slice(0, 300)}`);
    }
    if (sessionResult.err.length > 0) {
      console.log(`  stderr preview: ${sessionResult.err.slice(0, 300)}`);
    }

    // ── Step 6: Verify hook firing ───────────────────────────────────
    console.log("[6/7] Verifying hook firing...");
    const t6 = performance.now();

    // Check 6a: Look for claim dir (dedup state = hooks wrote it)
    const claimCheck = await run(sandbox, "sh", [
      "-c",
      `find /tmp -maxdepth 1 -name 'vercel-plugin-*-seen-skills.d' -type d 2>/dev/null | head -5`,
    ]);
    const claimDirs = claimCheck.out
      .split("\n")
      .filter((l) => l.length > 0);
    const hasClaimDirs = claimDirs.length > 0;

    // If claim dirs exist, list their contents (= which skills were injected)
    let claimedSkills: string[] = [];
    if (hasClaimDirs) {
      const claimContents = await run(sandbox, "sh", [
        "-c",
        `ls ${claimDirs[0]} 2>/dev/null`,
      ]);
      claimedSkills = claimContents.out
        .split("\n")
        .filter((l) => l.length > 0)
        .map((s) => decodeURIComponent(s));
    }

    // Check 6b: Look for seen-skills.txt file
    const seenFileCheck = await run(sandbox, "sh", [
      "-c",
      `find /tmp -maxdepth 1 -name 'vercel-plugin-*-seen-skills.txt' 2>/dev/null | head -3`,
    ]);
    const hasSeenFile = seenFileCheck.out.length > 0;
    let seenFileContents = "";
    if (hasSeenFile) {
      const firstFile = seenFileCheck.out.split("\n")[0];
      const contents = await run(sandbox, "cat", [firstFile]);
      seenFileContents = contents.out;
    }

    // Check 6c: Look for debug logs
    const debugLogCheck = await run(sandbox, "sh", [
      "-c",
      `find /root/.claude/debug -name '*.txt' -o -name '*.log' 2>/dev/null; find /home/user/.claude/debug -name '*.txt' -o -name '*.log' 2>/dev/null`,
    ]);
    const debugLogFiles = debugLogCheck.out
      .split("\n")
      .filter((l) => l.length > 0);

    // Check 6d: Grep stderr for hook trace markers
    const preToolUseInStderr = sessionResult.err.includes("PreToolUse") ||
      sessionResult.err.includes("pretooluse") ||
      sessionResult.err.includes("skill-inject");
    const userPromptInStderr = sessionResult.err.includes("UserPromptSubmit") ||
      sessionResult.err.includes("user-prompt-submit") ||
      sessionResult.err.includes("prompt-signal");

    const hookEvidence = {
      claimDirs: hasClaimDirs,
      claimedSkills,
      seenFile: hasSeenFile,
      seenFileContents,
      debugLogFiles,
      preToolUseInStderr,
      userPromptInStderr,
    };

    // A hook "fired" if we see any evidence at all
    const anyHookEvidence =
      hasClaimDirs ||
      hasSeenFile ||
      preToolUseInStderr ||
      userPromptInStderr ||
      debugLogFiles.length > 0;

    results.push({
      step: "hook-verification",
      ok: anyHookEvidence,
      detail: JSON.stringify(hookEvidence, null, 0),
      time: elapsed(t6),
    });
    console.log(
      `  ${anyHookEvidence ? "OK" : "FAIL"}: hook evidence found=${anyHookEvidence}`
    );
    console.log(`  claim dirs: ${hasClaimDirs} (skills: ${claimedSkills.join(", ") || "none"})`);
    console.log(`  seen-skills.txt: ${hasSeenFile} (${seenFileContents || "empty"})`);
    console.log(`  debug logs: ${debugLogFiles.length} file(s)`);
    console.log(`  stderr traces: PreToolUse=${preToolUseInStderr} UserPromptSubmit=${userPromptInStderr}`);

    // ── Step 7: Extract artifacts ────────────────────────────────────
    console.log("[7/7] Extracting artifacts...");
    const t7 = performance.now();

    const artifacts: Record<string, string> = {};

    // Extract debug log contents
    for (const logFile of debugLogFiles.slice(0, 3)) {
      try {
        const content = await run(sandbox, "sh", [
          "-c",
          `head -200 '${logFile}'`,
        ]);
        artifacts[logFile] = content.out;
      } catch {
        artifacts[logFile] = "(read failed)";
      }
    }

    // Extract project structure
    const tree = await run(sandbox, "sh", [
      "-c",
      `find ${projectDir} -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -50`,
    ]);
    artifacts["project-tree"] = tree.out;

    // Extract .claude directory structure
    const claudeTree = await run(sandbox, "sh", [
      "-c",
      `find ${projectDir}/.claude -type f 2>/dev/null | head -20`,
    ]);
    artifacts[".claude-tree"] = claudeTree.out;

    // Full stderr (hook trace log)
    artifacts["stderr-trace"] = sessionResult.err.slice(0, 5000);

    // Claude output
    artifacts["claude-output"] = sessionResult.out.slice(0, 3000);

    results.push({
      step: "artifact-extraction",
      ok: true,
      detail: `${Object.keys(artifacts).length} artifacts extracted`,
      time: elapsed(t7),
    });
    console.log(`  OK: ${Object.keys(artifacts).length} artifacts (${elapsed(t7)})`);

    // Print key artifacts
    console.log("\n--- Artifacts ---");
    console.log("\n[.claude tree]");
    console.log(artifacts[".claude-tree"] || "(empty)");
    console.log("\n[project tree]");
    console.log(artifacts["project-tree"]?.slice(0, 500) || "(empty)");
    if (artifacts["stderr-trace"]) {
      console.log("\n[stderr trace (first 1000 chars)]");
      console.log(artifacts["stderr-trace"].slice(0, 1000));
    }
    for (const [path, content] of Object.entries(artifacts)) {
      if (path.includes("debug") && content !== "(read failed)") {
        console.log(`\n[debug log: ${path} (first 500 chars)]`);
        console.log(content.slice(0, 500));
      }
    }
  } catch (err: any) {
    results.push({
      step: "fatal",
      ok: false,
      detail: err.message?.slice(0, 400) ?? String(err),
      time: elapsed(t0),
    });
    console.error(`Fatal error: ${err.message}`);
  } finally {
    if (sandbox) {
      try {
        console.log("\nStopping sandbox...");
        await sandbox.stop();
        console.log("Sandbox stopped");
      } catch {
        console.log("Sandbox stop failed (may already be stopped)");
      }
    }
  }

  // ── summary ────────────────────────────────────────────────────────
  const allPassed = results.every((r) => r.ok);
  const hookStep = results.find((r) => r.step === "hook-verification");
  const sessionStep = results.find((r) => r.step === "claude-session");

  console.log("\n" + "=".repeat(60));
  console.log(allPassed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${r.step}: ${r.detail.slice(0, 120)} (${r.time})`);
  }
  console.log(`\nTotal time: ${elapsed(t0)}`);

  // Verdict on the critical question
  console.log("\n--- VERDICT ---");
  if (sessionStep?.ok && hookStep?.ok) {
    console.log(
      "Interactive Claude Code session WORKS in sandbox with hooks firing."
    );
    console.log("Proceed to full sister skill implementation.");
  } else if (sessionStep?.ok && !hookStep?.ok) {
    console.log(
      "Claude Code session completed but NO hook evidence found."
    );
    console.log(
      "Hooks may not fire in sandbox. Investigate PTY requirements or alternative session modes."
    );
  } else {
    console.log(
      "Claude Code session did NOT complete successfully."
    );
    console.log(
      "Review error output above. May need different install approach or sandbox configuration."
    );
  }

  process.exit(allPassed ? 0 : 1);
}

main();
