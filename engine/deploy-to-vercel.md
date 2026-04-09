---
name: deploy-to-vercel
priority: 5
description: "Deploy applications and websites to Vercel"
registry: vercel-labs/agent-skills
summary: "Deploy to Vercel — preview deployments, production deployments, deployment links"
bashPatterns:
  - "\\bvercel deploy\\b"
  - "\\bvercel --prod\\b"
promptSignals:
  phrases:
    - "deploy to vercel"
    - "deploy my app"
    - "push this live"
    - "create a preview deployment"
    - "deploy and give me the link"
  anyOf:
    - "deploy"
    - "vercel"
  minScore: 6
docs:
  - https://vercel.com/docs/deployments
---
