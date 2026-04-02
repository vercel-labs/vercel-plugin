---
name: vercel-agent
priority: 4
docs:
  - https://vercel.com/docs
  - https://sdk.vercel.ai/docs
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - ".github/workflows/vercel*.yml"
  - ".github/workflows/vercel*.yaml"
  - ".github/workflows/deploy*.yml"
  - ".github/workflows/deploy*.yaml"
  - ".github/workflows/preview*.yml"
  - ".github/workflows/preview*.yaml"
bashPatterns:
  - "\\bvercel\\s+agent\\b"
chainTo:
  - pattern: "uses:\\s*vercel/|vercel-action|VERCEL_TOKEN.*github"
    targetSkill: deployments-cicd
    message: "GitHub Actions with Vercel detected — loading CI/CD guidance for deployment workflows, preview URLs, and production promotions."
  - pattern: "@vercel/sdk|vercel\\.deployments|vercel\\.projects"
    targetSkill: vercel-api
    message: "Vercel SDK usage detected — loading API guidance for programmatic deployment management, project configuration, and MCP server integration."
retrieval:
  aliases: ["ai code review", "incident debugger", "vercel ai tools", "pr analyzer"]
  intents: ["set up vercel agent", "automate code review", "investigate incident", "configure ai tools"]
  entities: ["Vercel Agent", "code review", "incident investigation", "SDK"]
---

Guidance for vercel-agent. Install from registry for full content.
