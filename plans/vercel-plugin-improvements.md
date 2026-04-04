---
goal: >
  Systematically improve the vercel-plugin across every dimension — reliability,
  performance, developer experience, observability, test coverage, and novel
  capabilities. Work through the items roughly in order (quick wins first, novel
  explorations last). Each item should leave the codebase in a passing state
  (bun test) before moving to the next.
suggested-cmd: >
  ploop autoloop --goal plans/vercel-plugin-improvements.md --iterate 12
estimated-iters: 10-14
---

# Vercel-Plugin Improvement Sweep

## Context

- **Codebase**: 40 engine rules, 45 hook source files (17k LOC), 55 test files (20k LOC)
- **Stack**: Bun + TypeScript + tsup → ESM hooks consumed by Claude Code agent SDK
- **Branch**: `orchestrator` — actively transitioning from bundled skills to on-demand install via skills.sh registry
- **Build**: `bun run build` (hooks + manifest), `bun test` (typecheck + tests)
- **Current version**: 0.24.0

## Guardrails

- Do NOT delete or rename any file in `hooks/` that is referenced by `hooks/hooks.json`
- Do NOT change the `SyncHookJSONOutput` contract or hook registration schema
- Do NOT modify engine rule `priority` values without justifying the rebalancing
- Do NOT break the dedup contract (atomic O_EXCL claims, env-var fallback, session file)
- Run `bun test` after every meaningful change group — never leave tests red
- Run `bun run build:hooks` after editing any `.mts` file
- Commit after each completed item with a descriptive message

## Verify

```bash
bun run build && bun test
```

---

## Items

### Tier 1 — Quick Wins (each ≤30 min)

1. **Dead-code sweep in hook modules**
   Grep for unexported functions and unused imports across `hooks/src/*.mts`. Remove anything not imported by another module or test. Verify with `bun run typecheck`.

2. **Consistent error boundaries in all hooks**
   Audit every entry-point hook for unhandled exceptions. Several hooks catch errors but silently swallow them. Add structured `logger.error()` calls with the hook name and error message so failures surface in debug mode.

3. **Normalize timeout declarations in hooks.json**
   Some hooks declare `"timeout": "5s"`, others omit it. Add explicit timeouts to every hook entry for predictability. Use 5s for tool-use hooks, 10s for session-start hooks.

4. **Add `--verbose` flag to `vercel-plugin doctor`**
   Currently doctor outputs pass/fail. Add a `--verbose` mode that prints the raw manifest diff, dedup file contents, and hook registration details for debugging in the field.

5. **Type-narrow `parseSimpleYaml` edge cases**
   The inline YAML parser treats bare `null`/`true`/`false` as strings. Add explicit JSDoc warnings at the call sites and a `yamlBoolean()` helper that hooks can use when they actually need boolean coercion from frontmatter.

6. **Deduplicate test fixture creation**
   Multiple test files create similar mock skill maps and env setups. Extract a `tests/helpers/fixtures.ts` factory (or consolidate into the existing `tests/helpers/`) to reduce boilerplate and make fixture updates atomic.

7. **Add `engines` field to package.json**
   Lock `"bun": ">=1.0.0"` and `"node": ">=20"` so contributors get a clear error if running with an incompatible runtime.

### Tier 2 — Reliability & Correctness

8. **Race-condition hardening for dedup claims**
   The O_EXCL atomic claim is solid, but the env-var fallback path does a read-modify-write without locking. Add a compare-and-swap retry loop (read → append → re-read → verify) or document the accepted race window.

9. **Graceful degradation when `CLAUDE_ENV_FILE` is missing**
   Several hooks assume the env file exists. If Claude Code changes its contract, hooks will throw. Add a guard that logs a warning and falls back to in-memory state.

10. **Validation rule conflict detection**
    Two engine rules could define contradictory `validate` patterns for the same file glob. Add a `doctor` check that scans all rules for overlapping `pathPatterns` with conflicting validation messages.

11. **Prompt signal collision audit**
    Run a pairwise comparison of all `promptSignals.phrases` across engine rules. Flag any phrase that appears in multiple rules (could cause unexpected double-injection). Add this as a `doctor` check.

12. **Budget overflow regression test**
    Write a test that constructs a scenario where 10+ skills all match a single file path, verifies only 3 are injected, and asserts the total byte count stays under 18KB.

13. **Session-end cleanup resilience**
    If the session-end hook fails (crash, timeout), dedup temp files leak. Add a startup sweep in `session-start-seen-skills.mts` that cleans stale claim dirs older than 1 hour.

### Tier 3 — Performance

14. **Lazy-load the manifest in PreToolUse**
    `generated/skill-rules.json` is currently `JSON.parse`'d on every PreToolUse invocation. Cache the parsed object in a module-level variable (hooks are long-lived ESM modules loaded once per session). Benchmark before/after with `console.time`.

15. **Precompile regex patterns at module load**
    `pathRegexSources` and `bashPatterns` are compiled to `RegExp` on every match call. Move compilation to module initialization and cache the `RegExp` objects.

16. **Parallel skill resolution in PreToolUse**
    When multiple skills match, their SKILL.md files are read sequentially from the cache. Use `Promise.all` to read them in parallel since they're independent I/O.

17. **MiniSearch index warming**
    If the lexical stemmer uses MiniSearch, build the index once at session start rather than on first prompt match. Measure the cold-start penalty.

18. **Shrink manifest size**
    `generated/skill-rules.json` includes fields only used by the CLI (`description`, `summary`). Split into `skill-rules-runtime.json` (patterns + priority only) and `skill-rules-meta.json` (descriptions). Hooks load only runtime; CLI loads both.

### Tier 4 — Developer Experience

19. **`vercel-plugin explain --prompt "how do I deploy"`**
    Extend the CLI to accept a `--prompt` flag that runs the prompt signal scorer and shows which skills would match, with score breakdowns. Currently only file/bash explain is supported.

20. **`vercel-plugin diff` command**
    Show what changed between the current manifest and the last git-committed version. Useful for PR reviews of engine rule changes.

21. **Hot-reload for engine rules in dev mode**
    Watch `engine/*.md` and auto-rebuild the manifest on change. Use `Bun.file().watch()` or `fs.watch`. Print a notification when rebuild completes.

22. **Skill authoring linter**
    A `vercel-plugin lint` command that validates all engine rules against a schema: required fields present, priority in range, glob patterns are valid, regex patterns compile, promptSignal phrases aren't substrings of each other.

23. **Interactive `doctor` with fix suggestions**
    When doctor finds issues, print suggested fix commands (e.g., "run `bun run build:manifest` to fix manifest drift"). For auto-fixable issues, add a `--fix` flag.

24. **Onboarding smoke test generator**
    A script that creates a minimal Next.js project in a temp dir, installs the plugin, and runs a simulated Claude Code session to verify hooks fire correctly. Use this as a CI integration test.

### Tier 5 — Observability & Diagnostics

25. **Structured telemetry events**
    Define a `TelemetryEvent` type with fields: `hookName`, `event` (matched/skipped/error), `skillSlug`, `durationMs`, `budgetRemaining`. Emit to stderr as JSON when `VERCEL_PLUGIN_LOG_LEVEL=trace`.

26. **Session injection timeline**
    At session end, write a `session-timeline.json` to the project cache summarizing every injection decision: which skills matched, which were deduped, which exceeded budget. The CLI can render this as a table.

27. **Budget utilization histogram**
    Track how much of the 18KB PreToolUse budget and 8KB prompt budget is used per invocation. Log min/mean/max/p95 at session end. Helps tune budget values.

28. **Dedup collision counter**
    Count how often a skill is requested but already claimed. High collision rates indicate a skill is over-matched and its patterns should be narrowed.

29. **Rule coverage heatmap**
    After a session, report which engine rules were never triggered. Rules with zero hits over many sessions might have overly narrow patterns or be obsolete.

### Tier 6 — Test Infrastructure

30. **Property-based testing for glob→regex conversion**
    Use fast-check to generate random file paths and verify that the glob→regex conversion in `patterns.mts` matches the behavior of a reference glob library (e.g., micromatch).

31. **Mutation testing pilot**
    Run Stryker (or a Bun-compatible mutation tester) on `patterns.mts` and `prompt-patterns.mts`. Identify surviving mutants and add targeted tests to kill them.

32. **Snapshot coverage for all 40 engine rules**
    Currently snapshots cover a subset of vercel.json fixtures. Add a snapshot test that exercises every engine rule's `pathPatterns` with at least one matching file.

33. **Chaos testing for dedup**
    Write a test that spawns 50 concurrent mock hooks all trying to claim the same skill simultaneously. Verify exactly one succeeds and the rest see it as already claimed.

34. **End-to-end hook chain test**
    Simulate a full hook lifecycle: SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → SessionEnd. Verify state propagation (env vars, dedup files, seen-skills) across the chain.

### Tier 7 — Architecture & Refactoring

35. **Extract a `SkillResolver` class**
    The skill resolution logic is spread across `skill-store.mts`, `patterns.mts`, `unified-ranker.mts`, and `pretooluse-skill-inject.mts`. Extract a `SkillResolver` class with methods: `match(input)`, `rank(matches)`, `dedup(ranked)`, `budget(deduped)`. This makes the pipeline testable as a unit.

36. **Event-driven hook communication**
    Replace the env-var + temp-file state passing between hooks with a lightweight event bus (JSON lines to a session-scoped FIFO or Unix domain socket). This eliminates the read-modify-write races and makes state transitions auditable.

37. **Schema-validated hook I/O**
    Define Zod (or TypeBox) schemas for every hook's input and output. Validate at hook boundaries. This catches contract drift between Claude Code SDK updates early.

38. **Separate "matching" from "injection" in PreToolUse**
    Currently PreToolUse does pattern matching AND skill injection in one function. Split into `matchSkills(input): MatchResult[]` and `injectSkills(matches): HookOutput`. This enables dry-run mode, better testing, and the explain CLI.

39. **Plugin configuration file**
    Support a `.vercel-plugin.json` or `vercel-plugin` key in `package.json` for project-level config: custom budget values, disabled rules, priority overrides. The profiler reads this at session start.

40. **Versioned hook protocol**
    Add a `"protocolVersion": 2` field to `hooks.json`. When Claude Code loads hooks, it can check compatibility. This future-proofs against SDK breaking changes.

### Tier 8 — Novel & Experimental

41. **Adaptive budget based on context window**
    Instead of fixed 18KB/8KB budgets, query the model's remaining context window (if exposed by the SDK) and scale the budget proportionally. Large contexts get more skill injection; small contexts get summaries only.

42. **Skill dependency graph**
    Engine rules can declare `coInject` relationships. Extend this to a full dependency graph: if skill A is injected, skill B is always co-injected (like `peerDependencies`). Visualize with `vercel-plugin deps --dot | dot -Tpng`.

43. **Predictive skill pre-warming**
    At session start, analyze the git diff (staged + unstaged) to predict which skills will be needed. Pre-read their SKILL.md files into memory so PreToolUse has zero I/O latency on first match.

44. **Conversation-aware injection decay**
    Track how many turns ago a skill was injected. If the same skill keeps matching but the user hasn't referenced it in 5+ turns, suppress re-injection and free budget for other skills.

45. **Skill effectiveness scoring**
    After injection, monitor whether the agent actually uses the injected knowledge (e.g., does it reference the skill's recommended patterns in subsequent tool calls?). Log an effectiveness score. Over time, deprioritize skills with low effectiveness.

46. **Multi-model skill tuning**
    Different models (Opus, Sonnet, Haiku) may need different skill prompts — Haiku benefits from more explicit instructions, Opus from denser reference material. Support model-specific skill variants in the cache.

47. **Self-improving engine rules**
    After each session, compare injected skills against PostToolUse validation failures. If a skill is consistently followed by validation errors, auto-generate a GitHub issue (or local report) suggesting rule improvements.

48. **Federated skill registries**
    Support multiple registries beyond skills.sh — allow teams to host private registries. Add a `registries` array to `.vercel-plugin.json` with URLs and auth tokens.

49. **Skill A/B testing framework**
    For engine rules with alternate prompt strategies, support a `variants` field. Randomly assign sessions to variant A or B, log which variant leads to fewer PostToolUse validation errors, and auto-promote the winner.

50. **Natural language rule authoring**
    Instead of writing YAML frontmatter, let developers describe a skill in plain English: "Inject when the user is working with Vercel Blob storage and editing upload handlers." A build step converts this to patterns and signals using an LLM, with human review.

---

## Completion Criteria

The goal is achieved when:
- At least 20 items are completed with passing tests
- No regressions in existing test suite
- `bun run build && bun test` passes clean
- Each completed item has its own commit

The polish phase should focus on: consistency across the changes, removing any dead code introduced, and ensuring new tests follow existing conventions.
