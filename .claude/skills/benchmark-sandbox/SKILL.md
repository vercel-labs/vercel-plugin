---
name: benchmark-sandbox
description: Run vercel-plugin eval scenarios in Vercel Sandboxes instead of local WezTerm panels. Provisions ephemeral microVMs with Claude Code + plugin pre-installed, runs benchmark prompts, extracts hook artifacts, and produces coverage reports.
---

# Benchmark Sandbox — Remote Eval via Vercel Sandboxes

Run benchmark scenarios inside Vercel Sandboxes — ephemeral Firecracker microVMs with node24. Each sandbox gets a fresh Claude Code + Vercel CLI + agent-browser install, the local vercel-plugin uploaded, and runs a two-phase eval:

- **Phase 1 (BUILD)**: Claude Code builds a Vercel-stack app with `--dangerously-skip-permissions --debug`
- **Phase 2 (VERIFY)**: A follow-up Claude Code session uses `agent-browser` to walk through user stories, fixing issues until all pass

**Proven working** on 2026-03-09: 5 sandboxes running in parallel, 10+ skills injected per scenario, hooks firing (PreToolUse, PostToolUse, SessionEnd), full Next.js apps built, agent-browser verification passing 6/6 user stories, public URLs via `sandbox.domain(3000)`, completed in 5 minutes.

## Proven Working Script

Use `run-eval.ts` — the proven eval runner:

```bash
# Run 5 heavy Vercel-stack scenarios in parallel (default)
bun run .claude/skills/benchmark-sandbox/run-eval.ts

# With agent-browser verification + keep sandboxes alive for 4 hours
bun run .claude/skills/benchmark-sandbox/run-eval.ts --keep-alive --keep-hours 4

# Custom concurrency and timeout
bun run .claude/skills/benchmark-sandbox/run-eval.ts --concurrency 3 --timeout 600000

# Skip verification phase (build only)
bun run .claude/skills/benchmark-sandbox/run-eval.ts --skip-verify
```

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--concurrency N` | 5 | Max parallel sandboxes (max 10) |
| `--timeout MS` | 1800000 (30 min) | Per-phase timeout in ms |
| `--keep-alive` | off | Keep sandboxes running after eval |
| `--keep-hours N` | 8 | Hours to keep alive (with `--keep-alive`) |
| `--skip-verify` | off | Skip the agent-browser verification phase |

## Critical Sandbox Environment Facts

| Property | Value |
|----------|-------|
| Home directory | `/home/vercel-sandbox` (NOT `/home/user`) |
| User | `vercel-sandbox` (NOT `root`) |
| Claude binary | `/home/vercel-sandbox/.global/npm/bin/claude` |
| PATH (via sh -c) | Includes `~/.global/npm/bin` — claude findable by name |
| Port exposure | `sandbox.domain(3000)` → `https://subdomain.vercel.run` |
| Snapshot persistence | **NOTHING survives snapshot restore** — no npm packages, no files, nothing |
| SDK version | `@vercel/sandbox@1.8.0` (v2 beta's named sandbox endpoint returns 404 for this team) |
| Hobby tier cap | **5 minutes max** per sandbox — `timeout` param is silently capped |

### Key Discoveries (Hard-Won)

1. **No snapshots**: Global npm packages and ALL filesystem changes are lost on snapshot restore. Create fresh sandboxes every time.
2. **Plugin install**: Use `npx add-plugin <path> -s project -y --target claude-code` — works because claude is in PATH after `npm install -g`. The `--target claude-code` flag is required because add-plugin can't auto-detect Claude Code without an initialized `~/.claude/` dir.
3. **File uploads**: Use `sandbox.writeFiles([{ path, content: Buffer }])` — NOT runCommand heredocs. Heredocs with special characters cause 400 errors from the sandbox API.
4. **Claude flags**: Always use `--dangerously-skip-permissions --debug`. The `--debug` flag writes to `~/.claude/debug/`.
5. **Auth**: API key from macOS Keychain (`ANTHROPIC_AUTH_TOKEN` — a `vck_*` Vercel Claude Key for AI Gateway), Vercel token from `~/.local/share/com.vercel.cli/auth.json` (a `vca_*` token).
6. **OIDC for sandbox SDK**: Run `npx vercel link --scope vercel-labs -y` + `npx vercel env pull` once before first use.
7. **Port exposure**: Pass `ports: [3000]` in `Sandbox.create()` to get a public URL immediately via `sandbox.domain(3000)`. Works on v1.8.0 — URL is assigned at creation time, before anything listens.
8. **extendTimeout**: Use `sandbox.extendTimeout(ms)` to keep sandboxes alive past the Hobby 5-min cap. Verified working — extends by the requested duration. Use this for overnight keep-alive.
9. **Background commands**: `runCommand` with backgrounded processes (`&` or `nohup`) may throw ZodError on v1. Write a script file first, then execute it.
10. **Session cleanup race**: The `session-end-cleanup.mjs` hook deletes `/tmp/vercel-plugin-*-seen-skills.d/` on session end. Extract artifacts BEFORE the session completes, or rely on poll history data.
11. **agent-browser works in sandboxes**: Install via `npm install -g agent-browser`. Claude Code can use it for browser-based verification inside the sandbox.

## When to Use This vs benchmark-agents

| | benchmark-agents (WezTerm) | benchmark-sandbox |
|---|---|---|
| **Environment** | Local macOS terminal panes | Remote Vercel Sandboxes (Amazon Linux) |
| **Parallelism** | Limited by local resources | Up to 10 (Hobby) or 2,000 (Pro) concurrent |
| **Session type** | Interactive TTY via `/bin/zsh -ic` | Direct `sh -c` invocation (PTY not required) |
| **Artifact access** | Direct filesystem (`~/.claude/debug/`) | `sandbox.readFile()` / poll via `runCommand` |
| **Port exposure** | `localhost:3000` | Public `https://sb-XXX.vercel.run` URLs |
| **Verification** | Manual browser check | Automated agent-browser in Phase 2 |
| **Best for** | Manual eval + iteration loop | Automated parallel coverage + verification runs |

## How It Works

1. **Create fresh sandbox**: `Sandbox.create({ runtime: "node24", ports: [3000], env: { ANTHROPIC_API_KEY, ... } })` — no snapshot
2. **Install tools**: `npm install -g @anthropic-ai/claude-code vercel agent-browser` (~20s per sandbox)
3. **Auth Vercel CLI**: Write token to `~/.local/share/com.vercel.cli/auth.json`
4. **Upload plugin**: `sandbox.writeFiles()` for 80 plugin files, then `npx add-plugin`
5. **Phase 1 — BUILD**: `claude --dangerously-skip-permissions --debug --settings <path> "<prompt>"`
6. **Monitor**: Poll every 20s for skill claims, debug logs, project files, port 3000 status
7. **Start dev server**: If not already running from the build prompt, start `npx next dev --port 3000`
8. **Extend timeout**: `sandbox.extendTimeout()` for verification phase + keep-alive
9. **Phase 2 — VERIFY**: Second Claude Code session uses `agent-browser` to test user stories
10. **Extract artifacts**: Pull claim dirs, seen-skills, debug logs, project tree, verification results

## DO NOT (Hard Rules)

Same rules as `benchmark-agents`, plus sandbox-specific:

- **DO NOT** use `claude --print` or `-p` flag — hooks don't fire without tool-calling sessions
- **DO NOT** let sandboxes run without extracting artifacts — ephemeral filesystem is lost on stop
- **DO NOT** pass API keys via `writeFiles()` — use `Sandbox.create({ env: { ... } })`
- **DO NOT** rely on snapshots for npm packages or project files — they don't persist
- **DO NOT** use v2 beta SDK — named sandbox endpoint returns 404 for this team; use v1.8.0
- **DO NOT** use `runCommand` heredocs to write file content — use `sandbox.writeFiles()` instead
- **DO NOT** assume `/home/user/` exists — the home dir is `/home/vercel-sandbox/`

## Prerequisites

```bash
# One-time setup: link project for OIDC sandbox auth
npx vercel link --scope vercel-labs -y
npx vercel env pull .env.local

# Auth (auto-resolved from macOS Keychain + Vercel CLI auth):
# - ANTHROPIC_API_KEY: from Keychain "ANTHROPIC_AUTH_TOKEN" (vck_* key) or env var
# - VERCEL_TOKEN: from ~/.local/share/com.vercel.cli/auth.json (vca_* token) or env var
# - ANTHROPIC_BASE_URL: defaults to https://ai-gateway.vercel.sh
```

## Commands

### Run eval with verification (recommended)

```bash
# Run 5 Vercel-stack scenarios in parallel with agent-browser verification
bun run .claude/skills/benchmark-sandbox/run-eval.ts

# Keep sandboxes alive overnight with public URLs
bun run .claude/skills/benchmark-sandbox/run-eval.ts --keep-alive --keep-hours 8

# Custom concurrency (max 10)
bun run .claude/skills/benchmark-sandbox/run-eval.ts --concurrency 3

# Build-only (skip verification)
bun run .claude/skills/benchmark-sandbox/run-eval.ts --skip-verify

# Longer timeout per phase (default 30 min)
bun run .claude/skills/benchmark-sandbox/run-eval.ts --timeout 600000
```

### Legacy runner (uses snapshots — less reliable)

```bash
bun run .claude/skills/benchmark-sandbox/sandbox-runner.ts --quick
```

## Sandbox Session Flow (Per Scenario)

```
Sandbox.create({ runtime: "node24", ports: [3000], env: { ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, VERCEL_PLUGIN_LOG_LEVEL: "trace" } })
  │
  ├─ npm install -g @anthropic-ai/claude-code vercel agent-browser   (~20s)
  ├─ Write Vercel CLI auth token to ~/.local/share/com.vercel.cli/auth.json
  ├─ mkdir -p /home/vercel-sandbox/<slug> && npm init -y
  ├─ sandbox.writeFiles() → /home/vercel-sandbox/vercel-plugin/  (80 files, ~945KB)
  ├─ npx add-plugin /home/vercel-sandbox/vercel-plugin -s project -y --target claude-code
  │
  ├─ Phase 1: BUILD
  │   ├─ sandbox.writeFiles() → /tmp/prompt.txt
  │   ├─ claude --dangerously-skip-permissions --debug --settings <path> "$(cat /tmp/prompt.txt)"
  │   │   (with AbortSignal.timeout(TIMEOUT_MS))
  │   │
  │   ├─ Poll every 20s:
  │   │   ├─ ls /tmp/vercel-plugin-*-seen-skills.d/     (claimed skills)
  │   │   ├─ cat /tmp/vercel-plugin-*-seen-skills.txt    (seen skills snapshot)
  │   │   ├─ find ~/.claude/debug -type f                (debug log count)
  │   │   ├─ find <project> -newer /tmp/prompt.txt       (new project files)
  │   │   └─ curl localhost:3000                         (port status + public URL)
  │   │
  │   └─ Extract build artifacts
  │
  ├─ Start dev server (if not already running from build prompt)
  │   └─ nohup npx next dev --port 3000 --turbopack &
  │
  ├─ sandbox.extendTimeout(keep_alive_hours * 3600000)
  │
  ├─ Phase 2: VERIFY (if port 3000 is up + enough files built)
  │   ├─ sandbox.writeFiles() → /tmp/verify.txt  (agent-browser verification prompt)
  │   ├─ claude --dangerously-skip-permissions --debug "$(cat /tmp/verify.txt)"
  │   │   (with AbortSignal.timeout(300_000))
  │   └─ Parse VERIFICATION_RESULTS from output (STORY_1: PASS/FAIL, etc.)
  │
  ├─ Extract final artifacts + verification results
  └─ sandbox.stop()  (skipped if --keep-alive)
```

## Verification Prompt Structure

The Phase 2 verification prompt instructs Claude to:

1. Open `http://localhost:3000` with `agent-browser open`
2. Wait for page load with `agent-browser wait --load networkidle`
3. Take annotated screenshots with `agent-browser screenshot --annotate`
4. Get interactive elements with `agent-browser snapshot -i`
5. Interact with UI to test each user story
6. Fix code if a story fails, then re-verify
7. Output structured results: `STORY_1: PASS` or `STORY_1: FAIL`

## Monitoring While Running

The orchestrator prints live status. For manual checks on a running sandbox:

```typescript
// List claimed skills
const claims = await sandbox.runCommand("sh", ["-c",
  "ls /tmp/vercel-plugin-*-seen-skills.d/ 2>/dev/null"
]);

// Check hook firing count
const hooks = await sandbox.runCommand("sh", ["-c",
  "find /home/vercel-sandbox/.claude/debug -name '*.txt' -exec grep -c 'executePreToolHooks' {} +"
]);

// Check port 3000
const port = await sandbox.runCommand("sh", ["-c",
  "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000"
]);

// Get public URL (after ports: [3000] in Sandbox.create)
const url = sandbox.domain(3000);
```

## Artifact Export Layout

Results are written to `~/dev/vercel-plugin-testing/sandbox-results/<run-id>/`:

```
<run-id>/
  results.json             # Full run results with poll history, skills, verification
  live-urls.json           # Public URLs for --keep-alive sandboxes
```

Each scenario result includes:
- `slug`, `sandboxId`, `success`, `durationMs`
- `claimedSkills[]`, `expectedSkills[]`, `projectFiles[]`
- `appUrl` — public `https://sb-XXX.vercel.run` URL
- `pollHistory[]` — timestamped skill/file/port snapshots
- `verification` — `{ ran, exitCode, stories: [{ index, status }], output }`

## Coverage Report

The summary output includes:

1. **Build/Verify table** — slug, build status, skills count, files, verification pass rate, duration
2. **Verification details** — per-story PASS/FAIL with icons
3. **App URLs** — public URLs for all sandboxes with port 3000
4. **Skill coverage** — expected vs actual per scenario, with missing/bonus breakdown

## Current Scenarios (Heavy Vercel Stack)

The 5 scenarios are designed to stress-test deep Vercel platform skill injection:

| Scenario | Expected Skills | Key Vercel Features |
|----------|----------------|---------------------|
| ai-chatbot-rag | ai-sdk, vercel-storage, swr, shadcn, routing-middleware, geist, nextjs | AI SDK streaming, Blob storage, SWR, middleware auth |
| feature-flagged-dashboard | vercel-flags, edge-runtime, shadcn, cron-jobs, runtime-cache, observability, nextjs, vercel-functions | Flags SDK, edge runtime, KV cache, cron, structured logging |
| ai-image-gallery | ai-sdk, vercel-storage, satori, swr, shadcn, nextjs, vercel-functions | AI generation, Blob upload, Satori OG images, SWR |
| realtime-collab-notes | ai-sdk, runtime-cache, shadcn, routing-middleware, edge-runtime, cron-jobs, vercel-functions, geist, nextjs | AI summarize, KV/cache CRUD, middleware timing, cron cleanup |
| deploy-monitor-ai | ai-sdk, vercel-api, vercel-flags, shadcn, cron-jobs, edge-runtime, observability, vercel-functions, nextjs | Vercel API client, Flags toggle, cron health check, structured logging |

Each scenario includes 3 user stories for agent-browser verification.

**Project naming**: Use timestamped slugs (e.g., `ai-chatbot-rag-2026-03-10`) to avoid collisions when linking to vercel-labs team projects.

## Proven Results

Best run (2026-03-09): 5 parallel sandboxes, ~5 min total

| Scenario | Skills | Files | Verify | URL |
|----------|--------|-------|--------|-----|
| feature-flagged-dashboard | 11 (87.5% expected) | 8 | 3/3 PASS | `https://sb-XXX.vercel.run` |
| deploy-monitor-ai | 9 (56% expected) | 20 | 3/3 PASS | `https://sb-XXX.vercel.run` |
| ai-chatbot-rag | 1 | 0 | skip | (too complex for 5-min Hobby cap) |
| realtime-collab-notes | 1 | 1 | skip | (too complex for 5-min Hobby cap) |
| ai-image-gallery | 1 | 0 | skip | (too complex for 5-min Hobby cap) |

Key findings:
- `vercel-flags` and `runtime-cache` correctly detected on feature-flagged-dashboard
- `ai-sdk`, `observability`, `shadcn` consistently detected across scenarios
- Lexical prompt inject (UserPromptSubmit) working — skills injected before any files written
- Complex multi-package scenarios need Pro tier (>5 min build time)
- `session-end-cleanup` deletes claim dirs — use poll history for final skill counts

## Known Limitations

1. **Hobby tier 5-min cap**: Sandbox auto-terminates at ~300s regardless of `timeout` param. Use `extendTimeout()` after build, or Pro tier for longer sessions.
2. **Snapshot uselessness**: Neither npm globals, node_modules, nor files created by runCommand survive snapshot restore. Always create fresh sandboxes.
3. **v2 beta incompatible**: `@vercel/sandbox@2.0.0-beta.3`'s named sandbox endpoint returns 404 for this team. Stick with v1.8.0.
4. **Artifact window**: Must extract before `sandbox.stop()` — filesystem is ephemeral. Session cleanup hook may delete claim dirs before extraction.
5. **Amazon Linux paths**: User is `vercel-sandbox` (home at `/home/vercel-sandbox/`). NOT `/home/user/` or `/root/`.
6. **`--dangerously-skip-permissions` parity**: Sandbox evals auto-approve all tool calls. WezTerm evals use normal permission flow. Coverage results may differ.
7. **`runCommand` timeout**: Use `{ signal: AbortSignal.timeout(ms) }` — the `{ timeout }` option is silently ignored.
8. **BrotliDecompressionError**: Transient Vercel API errors can kill sandbox creation. Retry logic recommended for production runs.
9. **Complex prompts vs 5-min cap**: Heavy multi-package prompts (ai-chatbot-rag, realtime-collab-notes) don't complete within Hobby's 5-min limit. Simpler prompts or Pro tier needed.
