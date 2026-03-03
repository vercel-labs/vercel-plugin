---
name: turborepo
description: Turborepo expert guidance. Use when setting up or optimizing monorepo builds, configuring task caching, remote caching, parallel execution, or the --affected flag for incremental CI.
---

# Turborepo

You are an expert in Turborepo — a high-performance build system for JavaScript/TypeScript monorepos, built by Vercel with a Rust-powered core.

## Key Features

- **Task caching**: Content-aware hashing — only rebuilds when files actually change
- **Remote caching**: Share build caches across machines and CI via Vercel
- **Parallel execution**: Uses all CPU cores automatically
- **Incremental builds**: `--affected` flag runs only changed packages + dependents
- **Pruned subsets**: Generate minimal monorepo for deploying a single app
- **Dependency graph awareness**: Understands package relationships

## Setup

```bash
npx create-turbo@latest
# or add to existing monorepo:
npm install turbo --save-dev
```

## turbo.json Task Pipeline

The `turbo.json` file defines your task dependency graph. Here are comprehensive examples:

### Basic pipeline

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### Advanced pipeline with environment variables and inputs

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "globalDependencies": [".env"],
  "globalEnv": ["CI", "NODE_ENV"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"],
      "env": ["DATABASE_URL", "NEXT_PUBLIC_API_URL"],
      "inputs": ["src/**", "package.json", "tsconfig.json"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"],
      "env": ["TEST_DATABASE_URL"]
    },
    "test:unit": {
      "dependsOn": [],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "inputs": ["src/**", ".eslintrc.*"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json"]
    },
    "db:generate": {
      "cache": false
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

### Key Configuration

- `dependsOn: ["^build"]` — Run `build` in dependencies first (`^` = topological)
- `dependsOn: ["build"]` — Run `build` in the same package first (no `^`)
- `outputs` — Files to cache (build artifacts)
- `inputs` — Files that affect the task hash (default: all non-gitignored files)
- `env` — Environment variables that affect the task hash
- `cache: false` — Skip caching (for dev servers, codegen)
- `persistent: true` — Long-running tasks (dev servers)
- `globalDependencies` — Files that invalidate all task caches when changed
- `globalEnv` — Env vars that invalidate all task caches when changed

## Workspace Filtering

Run tasks in specific packages or subsets of your monorepo:

```bash
# Single package
turbo build --filter=web

# Package and its dependencies
turbo build --filter=web...

# Package and its dependents (what depends on it)
turbo build --filter=...ui

# Multiple packages
turbo build --filter=web --filter=api

# By directory
turbo build --filter=./apps/*

# Packages that changed since main
turbo build --filter=[main]

# Combine: changed packages and their dependents
turbo build --filter=...[main]

# Exclude a package
turbo build --filter=!docs

# Packages matching a pattern
turbo build --filter=@myorg/*
```

### Filter syntax reference

| Pattern | Meaning |
|---------|---------|
| `web` | Only the `web` package |
| `web...` | `web` and all its dependencies |
| `...web` | `web` and all its dependents |
| `...web...` | `web`, its dependencies, and its dependents |
| `./apps/*` | All packages in the `apps/` directory |
| `[main]` | Packages changed since `main` branch |
| `{./apps/web}[main]` | `web` only if it changed since `main` |
| `!docs` | Exclude the `docs` package |

## CI Matrix Strategies

### GitHub Actions — parallel jobs per package

```yaml
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Required for --affected
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: turbo build test lint --affected
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}

  deploy-web:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: turbo build --filter=web
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}
```

### Dynamic matrix from workspace list

```yaml
jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.list.outputs.packages }}
    steps:
      - uses: actions/checkout@v4
      - id: list
        run: |
          PACKAGES=$(turbo ls --affected --output=json | jq -c '[.[].name]')
          echo "packages=$PACKAGES" >> "$GITHUB_OUTPUT"

  test:
    needs: detect
    if: needs.detect.outputs.packages != '[]'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: ${{ fromJson(needs.detect.outputs.packages) }}
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: turbo test --filter=${{ matrix.package }}
```

### Remote caching in CI

```bash
# Set in CI environment
TURBO_TOKEN=your-vercel-token
TURBO_TEAM=your-vercel-team

# Builds automatically use remote cache
turbo build
```

## Watch Mode

Run tasks in watch mode for development — re-executes when source files change:

```bash
# Watch a specific task
turbo watch test

# Watch with a filter
turbo watch test --filter=web

# Watch multiple tasks
turbo watch test lint
```

Watch mode respects the task graph — if `test` depends on `build`, changing a source file re-runs `build` first, then `test`.

### Persistent tasks vs watch

- `persistent: true` in turbo.json: The task itself is long-running (e.g., `next dev`). Turbo starts it and keeps it alive.
- `turbo watch`: Turbo re-invokes the task on file changes. Use for tasks that run and exit (e.g., `vitest run`, `tsc --noEmit`).

## Boundary Rules

Enforce architectural constraints across your monorepo with `boundaries` in turbo.json:

```json
{
  "boundaries": {
    "tags": {
      "apps/*": ["app"],
      "packages/ui": ["shared", "ui"],
      "packages/utils": ["shared"],
      "packages/config": ["config"]
    },
    "rules": [
      {
        "from": ["app"],
        "allow": ["shared"]
      },
      {
        "from": ["shared"],
        "deny": ["app"]
      }
    ]
  }
}
```

This enforces:
- Apps can import shared packages
- Shared packages cannot import from apps
- Violations produce build-time errors with `turbo boundaries`

```bash
# Check boundary compliance
turbo boundaries

# Add to your pipeline
{
  "tasks": {
    "check": {
      "dependsOn": ["lint", "typecheck", "boundaries"]
    },
    "boundaries": {}
  }
}
```

## Graph Visualization

Inspect your task dependency graph:

```bash
# Print graph to terminal
turbo build --graph

# Output as DOT format (Graphviz)
turbo build --graph=graph.dot

# Output as JSON
turbo build --graph=graph.json

# Open interactive graph in browser
turbo build --graph=graph.html
```

### Dry run — see what would execute

```bash
# Show tasks that would run without executing them
turbo build --dry-run

# JSON output for programmatic use
turbo build --dry-run=json
```

The dry run output shows:
- Each task that would execute
- Cache status (HIT or MISS)
- Dependencies and dependents
- File hash used for caching

## Common Commands

```bash
# Run build across all packages
turbo build

# Run only affected packages (changed since main branch)
turbo build --affected

# Run specific tasks in specific packages
turbo build --filter=web

# Run with remote caching
turbo build --remote-cache

# Prune monorepo for a single app deployment
turbo prune web --docker

# List all packages
turbo ls

# List affected packages
turbo ls --affected
```

## Remote Caching

```bash
# Login to Vercel for remote caching
turbo login

# Link to a Vercel team
turbo link

# Now builds share cache across all machines
turbo build  # Cache hits from CI, teammates, etc.
```

## Monorepo Structure

```
my-monorepo/
├── turbo.json
├── package.json
├── apps/
│   ├── web/           # Next.js app
│   │   └── package.json
│   ├── api/           # Backend service
│   │   └── package.json
│   └── docs/          # Documentation site
│       └── package.json
├── packages/
│   ├── ui/            # Shared component library
│   │   └── package.json
│   ├── config/        # Shared configs (eslint, tsconfig)
│   │   └── package.json
│   └── utils/         # Shared utilities
│       └── package.json
└── node_modules/
```

## --affected Flag

The most important optimization for CI pipelines:

```bash
# Only build/test packages that changed since main
turbo build test lint --affected
```

This performs intelligent graph traversal:
1. Identifies changed files since the base branch
2. Maps changes to affected packages
3. Includes all dependent packages (transitively)
4. Runs tasks only for the affected subgraph

## Deploying to Vercel

Vercel auto-detects Turborepo and optimizes builds. Each app in `apps/` can be a separate Vercel project with automatic dependency detection.

## When to Use Turborepo

| Scenario | Use Turborepo? |
|----------|----------------|
| Single Next.js app | No — Turbopack handles bundling |
| Multiple apps sharing code | Yes — orchestrate builds |
| Shared component library | Yes — manage dependencies |
| CI taking too long | Yes — caching + affected |
| Team sharing build artifacts | Yes — remote caching |
| Enforcing architecture boundaries | Yes — boundary rules |
| Complex multi-step CI pipelines | Yes — task graph + matrix |

## Official Documentation

- [Turborepo Documentation](https://turborepo.dev/repo/docs)
- [Getting Started](https://turborepo.dev/repo/docs/getting-started)
- [Crafting Your Repository](https://turborepo.dev/repo/docs/crafting-your-repository)
- [Task Configuration](https://turborepo.dev/repo/docs/reference/configuration)
- [Filtering](https://turborepo.dev/repo/docs/crafting-your-repository/running-tasks#using-filters)
- [GitHub: Turborepo](https://github.com/vercel/turborepo)
