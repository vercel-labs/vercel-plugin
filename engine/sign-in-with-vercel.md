---
name: sign-in-with-vercel
docs: https://vercel.com/docs/sign-in-with-vercel
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - "app/api/auth/**"
  - "app/login/**"
  - "src/app/api/auth/**"
  - "src/app/login/**"
  - "pages/api/auth/**"

  - pattern: "next-auth|NextAuth|from\\s+[''\"]next-auth[''\"\"]|from\\s+[''\"]@auth/[''\"\"]"
    targetSkill: auth
    message: "NextAuth/Auth.js detected alongside Vercel OAuth — loading Auth guidance for proper integration patterns, middleware setup, and provider configuration."
  - pattern: "VERCEL_CLIENT_ID|VERCEL_CLIENT_SECRET"
    targetSkill: env-vars
    message: "Vercel OAuth environment variables detected — loading Env Vars guidance for secure configuration and vercel env management."
retrieval:
  aliases: ["vercel oauth", "vercel login", "vercel identity", "oauth provider"]
  intents: ["add vercel login", "implement oauth with vercel", "use vercel as identity provider"]
  entities: ["OAuth 2.0", "OIDC", "Sign in with Vercel", "identity provider"]
chainTo:
  - pattern: "next-auth|NextAuth|from\\s+[''\"]next-auth[''\"\"]|from\\s+[''\"]@auth/[''\"\"]"
    targetSkill: auth
    message: "NextAuth/Auth.js detected alongside Vercel OAuth — loading Auth guidance for proper integration patterns, middleware setup, and provider configuration."
    skipIfFileContains: "clerkMiddleware|@clerk/|from\\s+[''\"]@descope/"
  - pattern: "VERCEL_CLIENT_ID|VERCEL_CLIENT_SECRET"
    targetSkill: env-vars
    message: "Vercel OAuth environment variables detected — loading Env Vars guidance for secure configuration and vercel env management."
    skipIfFileContains: "vercel\\s+env\\s+pull|process\\.env\\.VERCEL_CLIENT_ID"
---

Guidance for sign-in-with-vercel. Install from registry for full content.
