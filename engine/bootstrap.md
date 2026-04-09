---
name: bootstrap
docs:
  - https://vercel.com/docs/getting-started-with-vercel
  - https://nextjs.org/docs/getting-started/installation
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - ".env.example"
  - ".env.sample"
  - ".env.template"
  - "README*"
  - "docs/**/setup*"
  - "package.json"
  - "drizzle.config.*"
  - "prisma/schema.prisma"
  - "auth.*"
  - "src/**/auth.*"
bashPatterns:
  - "\\\\bcp\\\\s+\\\\.env\\\\.(?:example|sample|template)\\\\s+\\\\.env\\\\.local\\\\b"
  - "\\\\b(?:npm|pnpm|bun|yarn)\\\\s+run\\\\s+db:(?:push|seed|migrate|generate)\\\\b"
  - "\\\\b(?:npm|pnpm|bun|yarn)\\\\s+run\\\\s+dev\\\\b"
  - "\\\\bvercel\\\\s+link\\\\b"
  - "\\\\bvercel\\\\s+integration\\\\s+(?:add|install)\\\\b"
  - "\\\\bvercel\\\\s+env\\\\s+pull\\\\b"
importPatterns:
  - "@neondatabase/serverless"
  - "drizzle-orm"
  - "@upstash/redis"
  - "@vercel/blob"
  - "@vercel/edge-config"
  - "next-auth"
  - "@auth/core"
  - "better-auth"

  - pattern: "@vercel/(postgres|kv)|\\b(KV_REST_API_URL|POSTGRES_URL)\\b"
    targetSkill: vercel-storage
    message: "@vercel/postgres and @vercel/kv are sunset — loading Vercel Storage guidance for Neon and Upstash migration."
  - pattern: "from\\s+[''\"\"](next-auth|@auth/core|@clerk/nextjs|better-auth)[''\"\"]"
    targetSkill: auth
    message: "Auth library detected during bootstrap — loading Auth guidance for Clerk Marketplace setup and middleware patterns."
  - pattern: "OPENAI_API_KEY|ANTHROPIC_API_KEY|AI_GATEWAY"
    targetSkill: env-vars
    message: "AI provider env vars detected — loading Environment Variables guidance for OIDC-based auth via vercel env pull."
retrieval:
  aliases: ["project setup", "repo init", "getting started", "scaffold"]
  intents: ["set up project", "initialize repo", "link vercel project", "pull env vars"]
  entities: ["vercel link", "env pull", "database setup", "first run"]
chainTo:
  - pattern: "@vercel/(postgres|kv)|\\b(KV_REST_API_URL|POSTGRES_URL)\\b"
    targetSkill: vercel-storage
    message: "@vercel/postgres and @vercel/kv are sunset — loading Vercel Storage guidance for Neon and Upstash migration."
  - pattern: "from\\s+[''\"\"](next-auth|@auth/core|@clerk/nextjs|better-auth)[''\"\"]"
    targetSkill: auth
    message: "Auth library detected during bootstrap — loading Auth guidance for Clerk Marketplace setup and middleware patterns."
  - pattern: "OPENAI_API_KEY|ANTHROPIC_API_KEY|AI_GATEWAY"
    targetSkill: env-vars
    message: "AI provider env vars detected — loading Environment Variables guidance for OIDC-based auth via vercel env pull."
    skipIfFileContains: "VERCEL_OIDC|vercel env pull"
---

Guidance for bootstrap. Install from registry for full content.
