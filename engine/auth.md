---
name: auth
docs:
  - https://authjs.dev/getting-started
  - https://nextjs.org/docs/app/building-your-application/authentication
sitemap: https://authjs.dev/sitemap.xml
pathPatterns:
  - "middleware.ts"
  - "middleware.js"
  - "src/middleware.ts"
  - "src/middleware.js"
  - "clerk.config.*"
  - "app/sign-in/**"
  - "app/sign-up/**"
  - "src/app/sign-in/**"
  - "src/app/sign-up/**"
  - "app/(auth)/**"
  - "src/app/(auth)/**"
  - "auth.config.*"
  - "auth.ts"
  - "auth.js"
bashPatterns:
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@clerk/nextjs\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@clerk/nextjs\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@clerk/nextjs\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@clerk/nextjs\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@descope/nextjs-sdk\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@descope/nextjs-sdk\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@descope/nextjs-sdk\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@descope/nextjs-sdk\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@auth0/nextjs-auth0\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@auth0/nextjs-auth0\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@auth0/nextjs-auth0\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@auth0/nextjs-auth0\\b"
validate:
  - pattern: "VERCEL_CLIENT_(ID|SECRET)|vercel\\.com/oauth/(authorize|access_token|token)"
    message: "Hand-rolled Vercel OAuth detected. Use the dedicated Sign in with Vercel skill for OIDC-based Vercel identity."
    severity: recommended
    skipIfFileContains: "signInWithVercel|@vercel/auth"
    upgradeToSkill: sign-in-with-vercel
    upgradeWhy: "Replace manual Vercel OAuth token exchange with the Sign in with Vercel OIDC provider."

  - pattern: "VERCEL_CLIENT_(ID|SECRET)|vercel\\.com/oauth/(authorize|access_token|token)"
    targetSkill: sign-in-with-vercel
    message: "Hand-rolled Vercel OAuth detected — loading Sign in with Vercel OIDC guidance."
  - pattern: "export\\s+(default\\s+)?function\\s+middleware"
    targetSkill: routing-middleware
    message: "Auth logic in middleware.ts — loading Routing Middleware guidance for proxy.ts migration in Next.js 16."
  - pattern: "from\\s+[''\\\"](jsonwebtoken)[''\"]|require\\s*\\(\\s*[''\\\"](jsonwebtoken)[''\"]|jwt\\.sign\\s*\\("
    targetSkill: auth
    message: "Manual JWT handling with jsonwebtoken detected — use Clerk or Auth.js for managed auth with built-in JWT session handling, CSRF protection, and token rotation."
  - pattern: "from\\s+[''\\\"](next-auth)[''\"]|NextAuthOptions|authOptions\\s*:"
    targetSkill: auth
    message: "Legacy next-auth (v4) pattern detected — loading auth guidance for Auth.js v5 migration with the new universal auth() helper."
  - pattern: "from\\\\s+['\\\"]@clerk/nextjs['\\\"]"
    targetSkill: auth
    message: "Clerk import detected — loading Auth guidance for Clerk v7 patterns, middleware setup, organization handling, and Vercel Marketplace integration."
  - pattern: "bcrypt|argon2"
    targetSkill: auth
    message: "Manual password hashing detected (bcrypt/argon2) — use Clerk or Auth0 for managed authentication with built-in password hashing, rate limiting, and breach detection."
retrieval:
  aliases: ["authentication", "login system", "sign in", "auth flow"]
  intents: ["add auth", "protect routes", "manage sessions", "implement login", "secure api endpoints"]
  entities: ["NextAuth", "Auth.js", "JWT", "OAuth", "session", "middleware", "getServerSession"]
chainTo:
  - pattern: "VERCEL_CLIENT_(ID|SECRET)|vercel\\.com/oauth/(authorize|access_token|token)"
    targetSkill: sign-in-with-vercel
    message: "Hand-rolled Vercel OAuth detected — loading Sign in with Vercel OIDC guidance."
  - pattern: "export\\s+(default\\s+)?function\\s+middleware"
    targetSkill: routing-middleware
    message: "Auth logic in middleware.ts — loading Routing Middleware guidance for proxy.ts migration in Next.js 16."
  - pattern: "from\\s+[''\\\"](jsonwebtoken)[''\"]|require\\s*\\(\\s*[''\\\"](jsonwebtoken)[''\"]|jwt\\.sign\\s*\\("
    targetSkill: auth
    message: "Manual JWT handling with jsonwebtoken detected — use Clerk or Auth.js for managed auth with built-in JWT session handling, CSRF protection, and token rotation."
  - pattern: "from\\s+[''\\\"](next-auth)[''\"]|NextAuthOptions|authOptions\\s*:"
    targetSkill: auth
    message: "Legacy next-auth (v4) pattern detected — loading auth guidance for Auth.js v5 migration with the new universal auth() helper."
  - pattern: "from\\\\s+['\\\"]@clerk/nextjs['\\\"]"
    targetSkill: auth
    message: "Clerk import detected — loading Auth guidance for Clerk v7 patterns, middleware setup, organization handling, and Vercel Marketplace integration."
    skipIfFileContains: "clerkMiddleware|ClerkProvider"
  - pattern: "bcrypt|argon2"
    targetSkill: auth
    message: "Manual password hashing detected (bcrypt/argon2) — use Clerk or Auth0 for managed authentication with built-in password hashing, rate limiting, and breach detection."
    skipIfFileContains: "@clerk|@auth0"
---

Guidance for auth. Install from registry for full content.
