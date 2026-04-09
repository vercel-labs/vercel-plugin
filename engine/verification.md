---
name: verification
docs: https://vercel.com/docs/projects/project-configuration
sitemap: https://vercel.com/sitemap/docs.xml
bashPatterns:
  - "\\bnext\\s+dev\\b"
  - "\\bnpm\\s+run\\s+dev\\b"
  - "\\bpnpm\\s+dev\\b"
  - "\\bbun\\s+run\\s+dev\\b"
  - "\\byarn\\s+dev\\b"
  - "\\bvite\\s*(dev)?\\b"
  - "\\bvercel\\s+dev\\b"
  - "\\bastro\\s+dev\\b"
promptSignals:
  phrases:
    - "verify the flow"
    - "verify everything works"
    - "test the whole thing"
    - "does it actually work"
    - "check end to end"
    - "end to end test"
    - "why isn't it working right"
    - "why doesn't it work"
    - "it's not working correctly"
    - "something's off"
    - "not quite right"
    - "almost works but"
    - "works locally but"
    - "verify the feature"
    - "make sure it works"
    - "full verification"
  allOf:
    - ["verify", "flow"]
    - ["verify", "works"]
    - ["check", "everything"]
    - ["test", "end", "end"]
    - ["not", "working", "right"]
    - ["something", "off"]
    - ["almost", "works"]
    - ["make", "sure", "works"]
  anyOf:
    - "verify"
    - "verification"
    - "end-to-end"
    - "full flow"
    - "works"
    - "working"
  noneOf:
    - "unit test"
    - "jest"
    - "vitest"
    - "playwright test"
    - "cypress test"
  minScore: 6

  - pattern: "process\\.env\\.\\w+|NEXT_PUBLIC_\\w+"
    targetSkill: env-vars
    message: "Environment variable references detected during verification — loading Env Vars guidance for proper configuration, vercel env pull, and branch scoping."
  - pattern: "middleware\\.(ts|js)|proxy\\.(ts|js)|clerkMiddleware|NextResponse\\.redirect"
    targetSkill: routing-middleware
    message: "Middleware/proxy detected during verification — loading Routing Middleware guidance for request interception, auth checks, and proxy.ts migration."
  - pattern: "streamText\\s*\\(|generateText\\s*\\(|useChat\\s*\\("
    targetSkill: ai-sdk
    message: "AI SDK calls detected during verification — loading AI SDK v6 guidance for streaming, transport, and error handling patterns."
retrieval:
  aliases: ["end to end test", "full stack verify", "flow test", "integration check"]
  intents: ["verify full flow", "test end to end", "check if app works", "validate implementation"]
  entities: ["browser", "API", "data flow", "end-to-end", "verification"]
chainTo:
  - pattern: "process\\.env\\.\\w+|NEXT_PUBLIC_\\w+"
    targetSkill: env-vars
    message: "Environment variable references detected during verification — loading Env Vars guidance for proper configuration, vercel env pull, and branch scoping."
    skipIfFileContains: "vercel\\s+env\\s+pull|\\.env\\.local"
  - pattern: "middleware\\.(ts|js)|proxy\\.(ts|js)|clerkMiddleware|NextResponse\\.redirect"
    targetSkill: routing-middleware
    message: "Middleware/proxy detected during verification — loading Routing Middleware guidance for request interception, auth checks, and proxy.ts migration."
  - pattern: "streamText\\s*\\(|generateText\\s*\\(|useChat\\s*\\("
    targetSkill: ai-sdk
    message: "AI SDK calls detected during verification — loading AI SDK v6 guidance for streaming, transport, and error handling patterns."
    skipIfFileContains: "toUIMessageStreamResponse|DefaultChatTransport"
---

Verify full user story: browser + server + data flow + env
