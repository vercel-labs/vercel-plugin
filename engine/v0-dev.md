---
name: v0-dev
docs:
  - https://v0.dev/docs
  - https://vercel.com/docs/v0
sitemap: https://v0.dev/sitemap.xml
bashPatterns:
  - "\\bnpx\\s+v0\\b"
  - "\\bbunx\\s+v0\\b"
  - "\\bv0\\s+(generate|dev|chat)\\b"
importPatterns:
  - "@v0/sdk"
  - "v0"
promptSignals:
  phrases:
    - "generate with v0"
    - "v0 components"
    - "use v0"
    - "v0 generate"
  minScore: 6

  - pattern: "from\\s+[''\"]@/components/ui/|npx\\s+shadcn|@shadcn/"
    targetSkill: shadcn
    message: "shadcn/ui components detected in v0 output — loading shadcn guidance for theming, registry, and component customization."
  - pattern: "useChat\\s*\\(|streamText\\s*\\(|generateText\\s*\\(|from\\s+[''\"]ai[''\"]"
    targetSkill: ai-sdk
    message: "AI SDK usage detected in v0-generated code — loading AI SDK v6 guidance for proper streaming, transport, and gateway patterns."
  - pattern: "from\\s+[''\"]next/image[''\"]|from\\s+[''\"]next/font[''\"]|from\\s+[''\"]next/link[''\"]"
    targetSkill: nextjs
    message: "Next.js imports in v0 output — loading Next.js 16 guidance for App Router patterns, async APIs, and proxy.ts."
retrieval:
  aliases: ["v0", "ai code gen", "ui generator", "prompt to code"]
  intents: ["generate ui with v0", "use v0 cli", "integrate v0 sdk", "create component from prompt"]
  entities: ["v0", "v0 CLI", "v0 SDK", "AI code generation"]
chainTo:
  - pattern: "from\\s+[''\"]@/components/ui/|npx\\s+shadcn|@shadcn/"
    targetSkill: shadcn
    message: "shadcn/ui components detected in v0 output — loading shadcn guidance for theming, registry, and component customization."
  - pattern: "useChat\\s*\\(|streamText\\s*\\(|generateText\\s*\\(|from\\s+[''\"]ai[''\"]"
    targetSkill: ai-sdk
    message: "AI SDK usage detected in v0-generated code — loading AI SDK v6 guidance for proper streaming, transport, and gateway patterns."
    skipIfFileContains: "convertToModelMessages|toUIMessageStreamResponse"
  - pattern: "from\\s+[''\"]next/image[''\"]|from\\s+[''\"]next/font[''\"]|from\\s+[''\"]next/link[''\"]"
    targetSkill: nextjs
    message: "Next.js imports in v0 output — loading Next.js 16 guidance for App Router patterns, async APIs, and proxy.ts."
    skipIfFileContains: "generateStaticParams|generateMetadata"
---

Guidance for v0-dev. Install from registry for full content.
