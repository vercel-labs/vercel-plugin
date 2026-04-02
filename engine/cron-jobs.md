---
name: cron-jobs
priority: 6
docs: https://vercel.com/docs/cron-jobs
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - "vercel.json"
  - "apps/*/vercel.json"
chainTo:
  - pattern: "from\\s+[''\\\"](node-cron|cron)[''\"]|require\\s*\\(\\s*[''\\\"](node-cron|cron)[''\"]\\)"
    targetSkill: vercel-functions
    message: "npm cron package detected — Vercel Cron Jobs invoke serverless functions natively via vercel.json, no cron library needed. Loading Functions guidance."
  - pattern: "setTimeout\\s*\\(|setInterval\\s*\\(|while\\s*\\(\\s*true\\s*\\)"
    targetSkill: workflow
    message: "Long-running or polling logic in cron handler — loading Workflow DevKit for durable execution that survives timeouts."
  - pattern: "from\\s+[''\\\"](cron-parser|croner|node-schedule)[''\"]|require\\s*\\(\\s*[''\\\"](cron-parser|croner|node-schedule)[''\"]\\)"
    targetSkill: cron-jobs
    message: "Third-party cron library detected — Vercel Cron Jobs handle scheduling natively via vercel.json. No cron-parser/croner/node-schedule needed. Loading Cron Jobs guidance."
retrieval:
  aliases: ["scheduled tasks", "cron", "recurring jobs", "timed execution"]
  intents: ["add cron job", "schedule task", "set up recurring job", "configure cron"]
  entities: ["vercel.json", "cron", "schedule", "cron expression"]
---

Guidance for cron-jobs. Install from registry for full content.
