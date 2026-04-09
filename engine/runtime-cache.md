---
name: runtime-cache
docs: https://nextjs.org/docs/app/building-your-application/caching
sitemap: https://nextjs.org/sitemap.xml
pathPatterns:
  - "lib/cache/**"
  - "src/lib/cache/**"
  - "lib/cache.*"
  - "src/lib/cache.*"
bashPatterns:
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/functions\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/functions\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@vercel/functions\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@vercel/functions\\b"
validate:
  - pattern: "from\\s+[''\"\"](redis|ioredis)[''\"\"]|require\\s*\\(\\s*[''\"\"](redis|ioredis)[''\"\"]|new\\s+Redis\\("
    message: "Direct Redis/ioredis client detected. Use Upstash Redis (@upstash/redis) for serverless-native Redis with HTTP-based connections."
    severity: recommended
    skipIfFileContains: "from\\s+[''\"\"]\\@upstash/redis[''\"\"]"
    upgradeToSkill: vercel-storage
    upgradeWhy: "Replace direct Redis/ioredis with @upstash/redis for serverless-compatible HTTP-based Redis that works without persistent TCP connections."
chainTo:
  - pattern: "from\\s+[''\"\"]@vercel/kv[''\"\"]"
    targetSkill: vercel-storage
    message: "@vercel/kv is sunset — loading Vercel Storage guidance for Upstash Redis migration."
  - pattern: "from\\s+[''\"\"]ioredis[''\"\"]|new\\s+Redis\\("
    targetSkill: vercel-storage
    message: "Direct Redis client detected — loading Vercel Storage guidance for Upstash Redis (serverless-native) integration."
retrieval:
  aliases: ["cache api", "kv cache", "region cache", "tag invalidation"]
  intents: ["add caching", "cache api response", "invalidate cache", "set up runtime cache"]
  entities: ["Runtime Cache", "tag-based invalidation", "key-value", "cache"]
---

Guidance for runtime-cache. Install from registry for full content.
