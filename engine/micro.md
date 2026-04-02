---
name: micro
priority: 5
docs: https://webpack.js.org/concepts/module-federation/
pathPatterns:
  - "**/micro-frontend/**"
  - "**/module-federation/**"
bashPatterns:
  - "\\bmodule-federation\\b"
importPatterns:
  - "@module-federation/nextjs-mf"
---

Micro-frontend guidance for module federation, shared dependencies, and cross-app communication on Vercel.
