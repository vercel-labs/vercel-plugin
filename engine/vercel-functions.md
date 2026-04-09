---
name: vercel-functions
docs:
  - https://vercel.com/docs/functions
  - https://vercel.com/docs/functions/runtimes
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - "api/**/*.*"
  - "pages/api/**"
  - "src/pages/api/**"
  - "app/**/route.*"
  - "src/app/**/route.*"
  - "apps/*/api/**/*.*"
  - "apps/*/app/**/route.*"
  - "apps/*/src/app/**/route.*"
  - "apps/*/pages/api/**"
  - "vercel.json"
  - "apps/*/vercel.json"
bashPatterns:
  - "\\bvercel\\s+dev\\b"
  - "\\bvercel\\s+logs\\b"
validate:
  - pattern: "export\\s+default\\s+function"
    message: "Use named exports (GET, POST, PUT, DELETE) instead of default export for route handlers"
    severity: error
  - pattern: "NextApiRequest|NextApiResponse"
    message: "NextApiRequest/NextApiResponse are Pages Router types — use Web API Request/Response"
    severity: error
  - pattern: "from\\s+[''\"](openai|@anthropic-ai/sdk|anthropic)[''\"]|new\\s+(OpenAI|Anthropic)\\("
    message: "Direct AI provider SDK detected in route handler. Use the Vercel AI SDK for streaming, tools, and provider abstraction."
    severity: recommended
    skipIfFileContains: "@ai-sdk/|from\\s+[''\"](ai)[''\"]|import.*from\\s+[''\"](ai)[''\"]|streamText|generateText"
    upgradeToSkill: ai-sdk
    upgradeWhy: "Replace vendor-locked provider SDKs with @ai-sdk/openai or @ai-sdk/anthropic for unified streaming and tool support."
  - pattern: "setTimeout\\s*\\(|setInterval\\s*\\(|await\\s+new\\s+Promise\\s*\\([^)]*setTimeout"
    message: "Long-running or polling logic detected in a serverless handler. Functions have execution time limits."
    severity: recommended
    skipIfFileContains: "use workflow|use step|@vercel/workflow"
    upgradeToSkill: workflow
    upgradeWhy: "Move delayed/polling logic to Vercel Workflow for durable execution with pause, resume, retries, and crash safety."
  - pattern: "writeFile(Sync)?\\(|createWriteStream\\(|from\\s+[''\"](multer|formidable)[''\"]|fs\\.writeFile"
    message: "Local filesystem write detected. Serverless functions have ephemeral, read-only filesystems."
    severity: error
    skipIfFileContains: "@vercel/blob|@upstash/|@neondatabase/"
    upgradeToSkill: vercel-storage
    upgradeWhy: "Replace local filesystem writes with Vercel Blob, Neon, or Upstash for persistent, platform-native storage."
  - pattern: "export\\s+(async\\s+)?function\\s+(GET|POST|PUT|PATCH|DELETE)\\b"
    message: "Route handler has no observability instrumentation. Add logging and error tracking for production debugging."
    severity: warn
    skipIfFileContains: "console\\.error|logger\\.|captureException|Sentry|@vercel/otel|withTracing"
    upgradeToSkill: observability
    upgradeWhy: "Add structured logging, error tracking, and OTel instrumentation to route handlers."
  - pattern: "from\\s+[''\"\"](lru-cache|node-cache|memory-cache)[''\"\"]|new\\s+(LRUCache|NodeCache|Map)\\(\\s*\\).*cache"
    message: "In-process memory cache detected in serverless function. Process memory is not shared across invocations."
    severity: recommended
    skipIfFileContains: "getCache|from\\s+[''\"\"]\\@vercel/functions[''\"\"]"
    upgradeToSkill: runtime-cache
    upgradeWhy: "Replace in-process caches with Vercel Runtime Cache (getCache from @vercel/functions) for region-aware caching that persists across invocations."
  - pattern: "maxRetries\\s*[=:]|retryCount\\s*[=:]|retry\\s*\\(\\s*|for\\s*\\([^)]*retry|while\\s*\\([^)]*retry"
    message: "Manual retry logic detected. Use Vercel Workflow DevKit for automatic retries with durable execution."
    severity: recommended
    skipIfFileContains: "use workflow|use step|@vercel/workflow|from\\s+[''\"\"](workflow)[''\"\"]"
    upgradeToSkill: workflow
    upgradeWhy: "Replace manual retry loops with Workflow DevKit steps that provide automatic retries, crash safety, and observability."
  - pattern: "from\\s+[''\"](express)[''\"\"]|require\\s*\\(\\s*[''\"](express)[''\"\"\\)]"
    message: "Express.js detected in a Vercel project. Vercel Functions use the Web Request/Response API — Express middleware, req/res, and app.listen() do not work in serverless."
    severity: recommended
    skipIfFileContains: "export\\s+(async\\s+)?function\\s+(GET|POST|PUT|PATCH|DELETE)|from\\s+[''\"\"](next/server|@vercel/functions)[''\"\"]"
    upgradeToSkill: vercel-functions
    upgradeWhy: "Replace Express with Next.js route handlers (export async function GET/POST) or Vercel Functions using the Web Request/Response API."

  - pattern: "from\\s+[''\\\"](openai|@anthropic-ai/sdk|anthropic)[''\"]|new\\s+(OpenAI|Anthropic)\\("
    targetSkill: ai-sdk
    message: "Direct AI provider SDK in route handler — loading AI SDK guidance for unified streaming and tool support."
  - pattern: "setTimeout\\s*\\(|setInterval\\s*\\(|await\\s+new\\s+Promise\\s*\\([^)]*setTimeout"
    targetSkill: workflow
    message: "Long-running or polling logic in serverless handler — loading Workflow DevKit for durable execution."
  - pattern: "writeFile(Sync)?\\(|createWriteStream\\(|from\\s+[''\\\"](multer|formidable)[''\"]|fs\\.writeFile"
    targetSkill: vercel-storage
    message: "Local filesystem write in serverless function — loading Vercel Storage guidance for platform-native persistence."
  - pattern: "from\\s+[''\"\"]@vercel/(postgres|kv)[''\"\"]"
    targetSkill: vercel-storage
    message: "@vercel/postgres and @vercel/kv are sunset — loading Vercel Storage guidance for Neon and Upstash migration."
  - pattern: "generateObject\\s*\\(|streamObject\\s*\\(|toDataStreamResponse|maxSteps\\b|CoreMessage\\b"
    targetSkill: ai-sdk
    message: "Deprecated AI SDK v5 API detected — loading AI SDK v6 guidance for migration."
  - pattern: "while\\s*\\(\\s*true\\s*\\)\\s*\\{|for\\s*\\(\\s*;\\s*;\\s*\\)\\s*\\{|setInterval\\s*\\(\\s*async"
    targetSkill: workflow
    message: "Polling loop in serverless function detected — loading Workflow DevKit for durable, crash-safe execution with pause/resume."
  - pattern: "from\\\\s+['\\\"]express['\\\"]|require\\\\s*\\\\(\\\\s*['\\\"]express['\\\"]"
    targetSkill: vercel-functions
    message: "Express.js detected — loading Vercel Functions guidance for Web Request/Response API route handlers that replace Express middleware and routing."
  - pattern: "from\\s+[''\"\"](lru-cache|node-cache|memory-cache)[''\"\"]|new\\s+(LRUCache|NodeCache|Map)\\(\\s*\\).*cache"
    targetSkill: runtime-cache
    message: "In-process memory cache in serverless function — loading Runtime Cache guidance for region-aware caching that persists across invocations."
  - pattern: "maxRetries\\s*[=:]|retryCount\\s*[=:]|retry\\s*\\(\\s*|for\\s*\\([^)]*retry|while\\s*\\([^)]*retry"
    targetSkill: workflow
    message: "Manual retry logic in serverless handler — loading Workflow DevKit guidance for automatic retries with durable execution."
retrieval:
  aliases: ["serverless functions", "api routes", "edge functions", "lambda"]
  intents: ["create serverless function", "configure function runtime", "optimize cold starts", "add api route"]
  entities: ["Serverless Functions", "Edge Functions", "Fluid Compute", "streaming", "Cron Jobs"]
chainTo:
  - pattern: "from\\s+[''\\\"](openai|@anthropic-ai/sdk|anthropic)[''\"]|new\\s+(OpenAI|Anthropic)\\("
    targetSkill: ai-sdk
    message: "Direct AI provider SDK in route handler — loading AI SDK guidance for unified streaming and tool support."
  - pattern: "setTimeout\\s*\\(|setInterval\\s*\\(|await\\s+new\\s+Promise\\s*\\([^)]*setTimeout"
    targetSkill: workflow
    message: "Long-running or polling logic in serverless handler — loading Workflow DevKit for durable execution."
  - pattern: "writeFile(Sync)?\\(|createWriteStream\\(|from\\s+[''\\\"](multer|formidable)[''\"]|fs\\.writeFile"
    targetSkill: vercel-storage
    message: "Local filesystem write in serverless function — loading Vercel Storage guidance for platform-native persistence."
  - pattern: "from\\s+[''\"\"]@vercel/(postgres|kv)[''\"\"]"
    targetSkill: vercel-storage
    message: "@vercel/postgres and @vercel/kv are sunset — loading Vercel Storage guidance for Neon and Upstash migration."
  - pattern: "generateObject\\s*\\(|streamObject\\s*\\(|toDataStreamResponse|maxSteps\\b|CoreMessage\\b"
    targetSkill: ai-sdk
    message: "Deprecated AI SDK v5 API detected — loading AI SDK v6 guidance for migration."
  - pattern: "while\\s*\\(\\s*true\\s*\\)\\s*\\{|for\\s*\\(\\s*;\\s*;\\s*\\)\\s*\\{|setInterval\\s*\\(\\s*async"
    targetSkill: workflow
    message: "Polling loop in serverless function detected — loading Workflow DevKit for durable, crash-safe execution with pause/resume."
    skipIfFileContains: "use workflow|use step|from\\\\s+['\\\"]workflow['\\\"]"
  - pattern: "from\\\\s+['\\\"]express['\\\"]|require\\\\s*\\\\(\\\\s*['\\\"]express['\\\"]"
    targetSkill: vercel-functions
    message: "Express.js detected — loading Vercel Functions guidance for Web Request/Response API route handlers that replace Express middleware and routing."
    skipIfFileContains: "export\\\\s+(async\\\\s+)?function\\\\s+(GET|POST|PUT|PATCH|DELETE)"
  - pattern: "from\\s+[''\"\"](lru-cache|node-cache|memory-cache)[''\"\"]|new\\s+(LRUCache|NodeCache|Map)\\(\\s*\\).*cache"
    targetSkill: runtime-cache
    message: "In-process memory cache in serverless function — loading Runtime Cache guidance for region-aware caching that persists across invocations."
    skipIfFileContains: "getCache|from\\s+[''\"\"]\\@vercel/functions[''\"\"]"
  - pattern: "maxRetries\\s*[=:]|retryCount\\s*[=:]|retry\\s*\\(\\s*|for\\s*\\([^)]*retry|while\\s*\\([^)]*retry"
    targetSkill: workflow
    message: "Manual retry logic in serverless handler — loading Workflow DevKit guidance for automatic retries with durable execution."
    skipIfFileContains: "use workflow|use step|@vercel/workflow|from\\s+[''\"\"](workflow)[''\"\"]"
---

Guidance for vercel-functions. Install from registry for full content.
