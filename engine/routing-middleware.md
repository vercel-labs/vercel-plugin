---
name: routing-middleware
docs:
  - https://nextjs.org/docs/app/building-your-application/routing/middleware
  - https://vercel.com/docs/routing-middleware
sitemap: https://nextjs.org/sitemap.xml
pathPatterns:
  - "middleware.ts"
  - "middleware.js"
  - "middleware.mts"
  - "middleware.mjs"
  - "proxy.ts"
  - "proxy.js"
  - "proxy.mts"
  - "proxy.mjs"
  - "src/middleware.ts"
  - "src/middleware.js"
  - "src/middleware.mts"
  - "src/middleware.mjs"
  - "src/proxy.ts"
  - "src/proxy.js"
  - "src/proxy.mts"
  - "src/proxy.mjs"
  - "vercel.json"
  - "apps/*/vercel.json"
  - "vercel.ts"
  - "vercel.mts"
bashPatterns:
  - "\\bnpx\\s+@vercel/config\\b"
validate:
  - pattern: "NextResponse.*from\\s+[''\"]next/server[''\"]|from\\s+[''\"]next/server[''\"].*NextResponse"
    message: "Next.js middleware.ts is renamed to proxy.ts in Next.js 16 — rename the file and use the Node.js runtime. Run Skill(nextjs) for proxy.ts migration guidance."
    severity: recommended
    skipIfFileContains: "proxy\\.ts|runtime.*nodejs"
    upgradeToSkill: nextjs
    upgradeWhy: "Guides migration from middleware.ts to proxy.ts with correct file placement, Node.js runtime, and Next.js 16 patterns."

  - pattern: "from\\s+[''\"\"]next-auth[''\"\"]"
    targetSkill: auth
    message: "Auth logic in middleware — loading Auth guidance for Clerk/Auth0 integration patterns."
  - pattern: "NextResponse.*from\\s+[''\"]next/server[''\"]|from\\s+[''\"]next/server[''\"].*NextResponse"
    targetSkill: nextjs
    message: "middleware.ts with next/server imports detected — loading Next.js guidance for proxy.ts migration (Next.js 16 renames middleware.ts to proxy.ts with Node.js runtime)."
  - pattern: "from\\s+[''\"\"](cookie|cookies-next)[''\"\"]|req\\.cookies\\.get\\s*\\(|NextResponse\\.next\\(\\s*\\{.*headers"
    targetSkill: vercel-flags
    message: "Cookie-based routing in middleware — loading Vercel Flags guidance for managed feature flags with Edge Config storage."
  - pattern: "from\\s+[''\"\"](jsonwebtoken)[''\"\"]|jwt\\.(verify|decode)\\("
    targetSkill: auth
    message: "Manual JWT verification in middleware — loading Auth guidance for managed auth middleware patterns (Clerk, Descope)."
retrieval:
  aliases: ["request interceptor", "middleware", "rewrite rules", "redirect rules"]
  intents: ["intercept requests", "add middleware", "configure rewrites", "set up redirects"]
  entities: ["middleware", "rewrite", "redirect", "personalization", "Edge"]
chainTo:
  - pattern: "from\\s+[''\"\"]next-auth[''\"\"]"
    targetSkill: auth
    message: "Auth logic in middleware — loading Auth guidance for Clerk/Auth0 integration patterns."
  - pattern: "NextResponse.*from\\s+[''\"]next/server[''\"]|from\\s+[''\"]next/server[''\"].*NextResponse"
    targetSkill: nextjs
    message: "middleware.ts with next/server imports detected — loading Next.js guidance for proxy.ts migration (Next.js 16 renames middleware.ts to proxy.ts with Node.js runtime)."
    skipIfFileContains: "proxy\\.ts|runtime.*nodejs"
  - pattern: "from\\s+[''\"\"](cookie|cookies-next)[''\"\"]|req\\.cookies\\.get\\s*\\(|NextResponse\\.next\\(\\s*\\{.*headers"
    targetSkill: vercel-flags
    message: "Cookie-based routing in middleware — loading Vercel Flags guidance for managed feature flags with Edge Config storage."
    skipIfFileContains: "@vercel/flags|@vercel/edge-config"
  - pattern: "from\\s+[''\"\"](jsonwebtoken)[''\"\"]|jwt\\.(verify|decode)\\("
    targetSkill: auth
    message: "Manual JWT verification in middleware — loading Auth guidance for managed auth middleware patterns (Clerk, Descope)."
    skipIfFileContains: "clerkMiddleware|@clerk/|@auth0/"
---

Guidance for routing-middleware. Install from registry for full content.
