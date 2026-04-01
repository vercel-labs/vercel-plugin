---
name: micro
description: Micro-frontend patterns and module federation for Vercel deployments.
summary: Micro-frontend guidance for module federation, shared dependencies, and cross-app communication on Vercel.
metadata:
  priority: 5
  docs:
    - "https://webpack.js.org/concepts/module-federation/"
  pathPatterns:
    - '**/micro-frontend/**'
    - '**/module-federation/**'
  bashPatterns:
    - '\bmodule-federation\b'
  importPatterns:
    - '@module-federation/nextjs-mf'
---

# Micro-Frontend Patterns

Best practices for micro-frontend architecture on Vercel.

## Module Federation

Use Next.js Module Federation for sharing components across independently deployed apps.

## Shared Dependencies

Configure shared dependencies to avoid duplicate bundles.

## Cross-App Communication

Use custom events or a shared state layer for cross-app communication.
