---
name: turbopack
suppressWhenProjectFacts:
  - greenfield
docs:
  - https://turbo.build/pack/docs
  - https://nextjs.org/docs/architecture/turbopack
sitemap: https://turbo.build/sitemap.xml
pathPatterns:
  - "next.config.*"
bashPatterns:
  - "\\bnext\\s+dev\\s+--turbo\\b"
  - "\\bnext\\s+dev\\s+--turbopack\\b"
chainTo:
  - pattern: "webpack\\s*:\\s*\\(|webpack\\s*\\(config"
    targetSkill: nextjs
    message: "Webpack config detected — loading Next.js guidance for migrating webpack customizations to Turbopack top-level config in Next.js 16."
  - pattern: "turbopack\\s*:\\s*\\{|experimental\\.turbopack"
    targetSkill: nextjs
    message: "Turbopack configuration detected — loading Next.js guidance for top-level turbopack config syntax in Next.js 16 (moved from experimental.turbopack)."
retrieval:
  aliases: ["next bundler", "turbopack", "fast bundler", "hmr"]
  intents: ["enable turbopack", "fix build issue", "speed up dev server", "configure bundler"]
  entities: ["Turbopack", "HMR", "bundler", "next dev --turbopack"]
---

Guidance for turbopack. Install from registry for full content.
