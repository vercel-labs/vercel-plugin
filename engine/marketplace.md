---
name: marketplace
priority: 3
docs: https://vercel.com/docs/integrations
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - "integration.json"
bashPatterns:
  - "\\bvercel\\s+integration\\b"
  - "\\bvercel\\s+integration\\s+add\\b"
  - "\\bvercel\\s+integration\\s+discover\\b"
chainTo:
  - pattern: "NEON_|POSTGRES_|DATABASE_URL|@neondatabase|@vercel/postgres"
    targetSkill: vercel-storage
    message: "Database integration detected — loading Storage guidance for Neon Postgres setup, connection pooling, and serverless patterns."
  - pattern: "CLERK_|@clerk/|clerkMiddleware"
    targetSkill: auth
    message: "Clerk integration detected — loading Auth guidance for middleware setup, route protection, and organization flows."
retrieval:
  aliases: ["vercel integrations", "marketplace", "third party services", "add ons"]
  intents: ["install integration", "build integration", "manage marketplace", "add third party service"]
  entities: ["Vercel Marketplace", "integration", "vercel integration", "unified billing"]
---

Guidance for marketplace. Install from registry for full content.
