#!/usr/bin/env bun
/**
 * Spike: Sandbox provisioning + Claude Code install
 *
 * Acceptance criteria:
 *  1. Creates a Vercel Sandbox with node24 runtime
 *  2. Claude Code installs via npm install -g @anthropic-ai/claude-code
 *  3. `claude --version` returns a valid version string
 *  4. ANTHROPIC_API_KEY is accessible inside the sandbox
 *  5. Script exits cleanly and reports success/failure
 */

import { Sandbox } from "@vercel/sandbox";

// ── helpers ──────────────────────────────────────────────────────────

function resolveApiKey(): string {
  // Support direct key or AI Gateway key
  const key =
    process.env.ANTHROPIC_API_KEY ??
    process.env.AI_GATEWAY_API_KEY ??
    process.env.VERCEL_API_KEY;
  if (!key) {
    console.error(
      "❌ Missing API key. Set one of: ANTHROPIC_API_KEY, AI_GATEWAY_API_KEY, VERCEL_API_KEY"
    );
    process.exit(1);
  }
  return key;
}

function resolveBaseUrl(): string | undefined {
  return process.env.ANTHROPIC_BASE_URL;
}

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

async function stdout(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>["runCommand"]>>
): Promise<string> {
  return (await result.stdout()).trim();
}

async function stderr(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>["runCommand"]>>
): Promise<string> {
  return (await result.stderr()).trim();
}

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  const t0 = performance.now();
  const apiKey = resolveApiKey();
  const baseUrl = resolveBaseUrl();

  const results: { step: string; ok: boolean; detail: string; time: string }[] =
    [];

  let sandbox: InstanceType<typeof Sandbox> | undefined;

  try {
    // Step 1 — Create sandbox
    console.log("⏳ Creating sandbox (node24)…");
    const t1 = performance.now();
    const sandboxEnv: Record<string, string> = {
      ANTHROPIC_API_KEY: apiKey,
    };
    if (baseUrl) sandboxEnv.ANTHROPIC_BASE_URL = baseUrl;

    sandbox = await Sandbox.create({
      runtime: "node24",
      env: sandboxEnv,
    });
    results.push({
      step: "create-sandbox",
      ok: true,
      detail: `id=${sandbox.sandboxId} status=${sandbox.status}`,
      time: elapsed(t1),
    });
    console.log(`✅ Sandbox created: ${sandbox.sandboxId} (${elapsed(t1)})`);

    // Step 2 — Verify env vars are accessible
    console.log("⏳ Verifying env vars inside sandbox…");
    const t2 = performance.now();
    const envCheck = await sandbox.runCommand("sh", [
      "-c",
      'echo "KEY=$(test -n \\"$ANTHROPIC_API_KEY\\" && echo SET || echo MISSING) BASE_URL=${ANTHROPIC_BASE_URL:-unset}"',
    ]);
    const envOut = await stdout(envCheck);
    const envOk = envOut.includes("KEY=SET");
    results.push({
      step: "env-var-check",
      ok: envOk,
      detail: envOut,
      time: elapsed(t2),
    });
    console.log(
      envOk
        ? `✅ Env vars verified: ${envOut} (${elapsed(t2)})`
        : `❌ Env var issue: ${envOut}`
    );

    // Step 3 — Install Claude Code
    console.log("⏳ Installing Claude Code (npm install -g)…");
    const t3 = performance.now();
    const install = await sandbox.runCommand("npm", [
      "install",
      "-g",
      "@anthropic-ai/claude-code",
    ]);
    const installExit = (install as any).exitCode ?? 0;
    const installErr = await stderr(install);
    const installOk = installExit === 0;
    results.push({
      step: "install-claude-code",
      ok: installOk,
      detail: installOk
        ? `exit=0`
        : `exit=${installExit} stderr=${installErr.slice(0, 200)}`,
      time: elapsed(t3),
    });
    console.log(
      installOk
        ? `✅ Claude Code installed (${elapsed(t3)})`
        : `❌ Install failed (exit=${installExit}): ${installErr.slice(0, 200)}`
    );

    // Step 4 — Verify claude --version
    console.log("⏳ Checking claude --version…");
    const t4 = performance.now();
    const ver = await sandbox.runCommand("claude", ["--version"]);
    const verOut = await stdout(ver);
    const verOk = /\d+\.\d+/.test(verOut);
    results.push({
      step: "claude-version",
      ok: verOk,
      detail: verOut || "(empty)",
      time: elapsed(t4),
    });
    console.log(
      verOk
        ? `✅ claude --version: ${verOut} (${elapsed(t4)})`
        : `❌ Unexpected version output: ${verOut}`
    );
  } catch (err: any) {
    results.push({
      step: "fatal",
      ok: false,
      detail: err.message?.slice(0, 300) ?? String(err),
      time: elapsed(t0),
    });
    console.error(`💥 Fatal error: ${err.message}`);
  } finally {
    // Cleanup
    if (sandbox) {
      try {
        console.log("⏳ Stopping sandbox…");
        await sandbox.stop();
        console.log("✅ Sandbox stopped");
      } catch {
        console.log("⚠️  Sandbox stop failed (may already be stopped)");
      }
    }
  }

  // ── summary ──────────────────────────────────────────────────────
  const allPassed = results.every((r) => r.ok);
  console.log("\n" + "─".repeat(60));
  console.log(
    allPassed
      ? "🎉 ALL CHECKS PASSED"
      : "⚠️  SOME CHECKS FAILED"
  );
  console.log("─".repeat(60));
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.step}: ${r.detail} (${r.time})`);
  }
  console.log(`\nTotal time: ${elapsed(t0)}`);

  process.exit(allPassed ? 0 : 1);
}

main();
