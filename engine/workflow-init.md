---
name: workflow-init
priority: 7
description: "Install and configure Vercel Workflow SDK"
registry: vercel/workflow
summary: "Install and configure Workflow SDK for Next.js, Express, Hono, Fastify, NestJS, and more"
bashPatterns:
  - "\\bpnpm add workflow\\b"
  - "\\bnpm install workflow\\b"
  - "\\byarn add workflow\\b"
  - "\\bbun add workflow\\b"
promptSignals:
  phrases:
    - "install workflow"
    - "set up workflow"
    - "add durable workflows"
    - "configure workflow sdk"
    - "init workflow"
  anyOf:
    - "install"
    - "setup"
    - "configure"
  allOf:
    - ["workflow", "install"]
    - ["workflow", "setup"]
  minScore: 6
docs:
  - https://vercel.com/docs/workflow
  - https://useworkflow.dev
---
