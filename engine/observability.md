---
name: observability
docs:
  - https://vercel.com/docs/observability
  - https://vercel.com/docs/observability/otel-overview
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - "instrumentation.ts"
  - "instrumentation.js"
  - "src/instrumentation.ts"
  - "src/instrumentation.js"
  - "app/layout.*"
  - "src/app/layout.*"
  - "pages/_app.*"
  - "src/pages/_app.*"
  - "apps/*/instrumentation.ts"
  - "apps/*/instrumentation.js"
  - "apps/*/app/layout.*"
  - "apps/*/src/app/layout.*"
  - "apps/*/pages/_app.*"
  - "apps/*/src/pages/_app.*"
  - "sentry.client.config.*"
  - "sentry.server.config.*"
  - "sentry.edge.config.*"
bashPatterns:
  - "\\bvercel\\s+logs?\\b"
  - "\\bvercel\\s+logs?\\s+.*--follow\\b"
  - "\\bvercel\\s+logs?\\s+.*--level\\b"
  - "\\bvercel\\s+logs?\\s+.*--since\\b"
  - "\\bcurl\\s+.*deployments.*events\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/analytics\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/analytics\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@vercel/analytics\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@vercel/analytics\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/speed-insights\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/speed-insights\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@vercel/speed-insights\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@vercel/speed-insights\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@sentry/nextjs\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@sentry/nextjs\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@sentry/nextjs\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@sentry/nextjs\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@sentry/node\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@sentry/node\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@sentry/node\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@sentry/node\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@datadog/browser-rum\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@datadog/browser-rum\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@datadog/browser-rum\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@datadog/browser-rum\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*\\bcheckly\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*\\bcheckly\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*\\bcheckly\\b"
  - "\\byarn\\s+add\\s+[^\\n]*\\bcheckly\\b"
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*\\bnewrelic\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*\\bnewrelic\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*\\bnewrelic\\b"
  - "\\byarn\\s+add\\s+[^\\n]*\\bnewrelic\\b"
promptSignals:
  phrases:
    - "add logging"
    - "add logs"
    - "set up logging"
    - "setup logging"
    - "configure logging"
    - "structured logging"
    - "log drain"
    - "log drains"
    - "vercel analytics"
    - "speed insights"
    - "web analytics"
    - "opentelemetry"
    - "otel"
    - "instrumentation"
    - "monitoring"
    - "set up monitoring"
    - "add observability"
    - "track errors"
    - "error tracking"
    - "sentry"
    - "datadog"
    - "check the logs"
    - "show me the error"
    - "what went wrong"
    - "where did it fail"
    - "show me the logs"
    - "find the error"
    - "why did it fail"
    - "debug the error"
  allOf:
    - ["add", "logging"]
    - ["add", "monitoring"]
    - ["set up", "logs"]
    - ["configure", "analytics"]
    - ["vercel", "logs"]
    - ["vercel", "analytics"]
    - ["track", "performance"]
    - ["track", "errors"]
  anyOf:
    - "logging"
    - "monitoring"
    - "analytics"
    - "observability"
    - "telemetry"
    - "traces"
    - "metrics"
    - "debug"
    - "debugging"
    - "stuck"
    - "hanging"
    - "hung"
    - "waiting"
    - "stalled"
    - "spinning"
    - "timeout"
    - "slow"
    - "pending"
    - "unresponsive"
  minScore: 6
validate:
  - pattern: "export (async )?function (GET|POST|PUT|PATCH|DELETE)"
    message: "API route handlers should include error logging — wrap in try/catch with console.error for production debugging"
    severity: warn
    skipIfFileContains: "console\\\\.error|logger\\\\.|captureException|Sentry"

  - pattern: "console\\.log\\s*\\(\\s*[''\"]error|catch\\s*\\(\\w+\\)\\s*\\{\\s*\\n\\s*console\\.log"
    targetSkill: vercel-functions
    message: "Console.log-only error handling detected in route handler — loading Vercel Functions guidance for structured error handling, proper logging, and function runtime configuration."
  - pattern: "from\\s+[''\"]@sentry/(nextjs|node)[''\"\"]"
    targetSkill: nextjs
    message: "Sentry SDK import detected — loading Next.js guidance for instrumentation.ts setup and Sentry config integration."
  - pattern: "winston|pino|bunyan"
    targetSkill: observability
    message: "Third-party logger detected (winston/pino/bunyan) — Vercel provides native structured logging, runtime logs, and Drains for log export. Loading Observability guidance for Vercel-native logging."
retrieval:
  aliases: ["monitoring", "logging", "analytics", "performance tracking"]
  intents: ["add monitoring", "set up logging", "track performance", "configure analytics"]
  entities: ["Web Analytics", "Speed Insights", "OpenTelemetry", "Drains", "runtime logs"]
chainTo:
  - pattern: "console\\.log\\s*\\(\\s*[''\"]error|catch\\s*\\(\\w+\\)\\s*\\{\\s*\\n\\s*console\\.log"
    targetSkill: vercel-functions
    message: "Console.log-only error handling detected in route handler — loading Vercel Functions guidance for structured error handling, proper logging, and function runtime configuration."
    skipIfFileContains: "captureException|@sentry/|@opentelemetry/|logger\\.\\w+|Sentry\\.|reportError"
  - pattern: "from\\s+[''\"]@sentry/(nextjs|node)[''\"\"]"
    targetSkill: nextjs
    message: "Sentry SDK import detected — loading Next.js guidance for instrumentation.ts setup and Sentry config integration."
    skipIfFileContains: "instrumentation\\.register|withSentryConfig"
  - pattern: "winston|pino|bunyan"
    targetSkill: observability
    message: "Third-party logger detected (winston/pino/bunyan) — Vercel provides native structured logging, runtime logs, and Drains for log export. Loading Observability guidance for Vercel-native logging."
    skipIfFileContains: "@vercel/otel|@opentelemetry/|Sentry\\\\."
---

Guidance for observability. Install from registry for full content.
