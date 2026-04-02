---
name: investigation-mode
priority: 8
docs: https://docs.anthropic.com/en/docs/claude-code/sub-agents
pathPatterns:
  - "**/middleware.{ts,js,mjs}"
  - "**/lib/logger.{ts,js}"
  - "**/utils/logger.{ts,js}"
  - "**/instrumentation.{ts,js}"
  - "**/*.log"
  - "**/error.{tsx,ts,js,jsx}"
  - "**/global-error.{tsx,ts,js,jsx}"
  - "**/not-found.{tsx,ts,js,jsx}"
bashPatterns:
  - "\\bvercel\\s+logs?\\b"
  - "\\bvercel\\s+inspect\\b"
  - "\\btail\\s+-f\\b.*\\.log"
  - "\\bworkflow\\s+runs?\\b"
  - "\\bvercel\\s+ls\\b"
  - "\\bcurl\\s+-[vI]"
promptSignals:
  phrases:
    - "nothing happened"
    - "still waiting"
    - "it's stuck"
    - "it's hung"
    - "nothing is happening"
    - "not responding"
    - "just sitting there"
    - "just sits there"
    - "seems frozen"
    - "is it frozen"
    - "frozen"
    - "why is it hanging"
    - "check the logs"
    - "check logs"
    - "where are the logs"
    - "how do I debug"
    - "how to debug"
    - "white screen"
    - "blank page"
    - "spinning forever"
    - "timed out"
    - "keeps timing out"
    - "no response"
    - "no output"
    - "not loading"
    - "debug this"
    - "investigate why"
    - "what went wrong"
    - "why did it fail"
    - "why is it failing"
    - "something is broken"
    - "something broke"
    - "seems broken"
    - "check what happened"
    - "check the status"
    - "where is the error"
    - "where did it fail"
    - "find the error"
    - "show me the error"
    - "why is it slow"
    - "taking forever"
    - "still loading"
    - "not finishing"
    - "seems dead"
    - "been waiting"
    - "waiting forever"
    - "stuck on"
    - "hung up"
    - "not progressing"
    - "stalled out"
    - "is it running"
    - "did it crash"
    - "keeps failing"
    - "why no response"
    - "where did it go"
    - "lost connection"
    - "never finishes"
    - "pending forever"
    - "queue stuck"
    - "job stuck"
    - "build stuck"
    - "request hanging"
    - "api not responding"
  allOf:
    - ["stuck", "workflow"]
    - ["stuck", "deploy"]
    - ["stuck", "loading"]
    - ["stuck", "build"]
    - ["stuck", "queue"]
    - ["stuck", "job"]
    - ["hung", "request"]
    - ["hung", "api"]
    - ["frozen", "page"]
    - ["frozen", "app"]
    - ["check", "why"]
    - ["check", "broken"]
    - ["check", "error"]
    - ["check", "status"]
    - ["check", "logs"]
    - ["debug", "workflow"]
    - ["debug", "deploy"]
    - ["debug", "api"]
    - ["debug", "issue"]
    - ["investigate", "error"]
    - ["logs", "error"]
    - ["logs", "check"]
    - ["slow", "response"]
    - ["slow", "loading"]
    - ["timeout", "api"]
    - ["timeout", "request"]
    - ["waiting", "response"]
    - ["waiting", "forever"]
    - ["waiting", "deploy"]
    - ["not working", "why"]
    - ["not", "responding"]
    - ["hanging", "for"]
    - ["been", "hanging"]
    - ["been", "stuck"]
    - ["been", "waiting"]
    - ["why", "slow"]
    - ["why", "failing"]
    - ["why", "stuck"]
    - ["why", "hanging"]
    - ["job", "failing"]
    - ["queue", "processing"]
  anyOf:
    - "stuck"
    - "hung"
    - "frozen"
    - "broken"
    - "failing"
    - "timeout"
    - "slow"
    - "debug"
    - "investigate"
    - "check"
    - "logs"
    - "error"
    - "hanging"
    - "waiting"
    - "stalled"
    - "pending"
    - "processing"
    - "loading"
    - "unresponsive"
  noneOf:
    - "css stuck"
    - "sticky position"
    - "position: sticky"
    - "z-index"
    - "sticky nav"
    - "sticky header"
    - "sticky footer"
    - "overflow: hidden"
    - "add a button"
    - "create a button"
    - "style the button"
  minScore: 4

  - pattern: "createWorkflow|use workflow|use step|@workflow/"
    targetSkill: workflow
    message: "Workflow code detected during investigation — loading Workflow DevKit guidance for debugging durable execution, step replay, and hook state."
  - pattern: "VERCEL_URL|DEPLOYMENT_ID|vercel\\.app|VERCEL_ENV"
    targetSkill: deployments-cicd
    message: "Deployment context detected — loading Deployments guidance for inspecting builds, preview URLs, and production promotion."
  - pattern: "@vercel/analytics|@vercel/speed-insights|otel|OpenTelemetry|instrumentation\\.(ts|js)"
    targetSkill: observability
    message: "Observability instrumentation detected — loading Observability guidance for log queries, tracing, and monitoring setup."
retrieval:
  aliases: ["debug helper", "troubleshooter", "stuck helper", "problem solver"]
  intents: ["debug issue", "fix stuck app", "investigate error", "triage problem"]
  entities: ["runtime logs", "workflow status", "browser verify", "triage"]
chainTo:
  - pattern: "createWorkflow|use workflow|use step|@workflow/"
    targetSkill: workflow
    message: "Workflow code detected during investigation — loading Workflow DevKit guidance for debugging durable execution, step replay, and hook state."
  - pattern: "VERCEL_URL|DEPLOYMENT_ID|vercel\\.app|VERCEL_ENV"
    targetSkill: deployments-cicd
    message: "Deployment context detected — loading Deployments guidance for inspecting builds, preview URLs, and production promotion."
    skipIfFileContains: "vercel\\s+inspect|vercel\\s+logs"
  - pattern: "@vercel/analytics|@vercel/speed-insights|otel|OpenTelemetry|instrumentation\\.(ts|js)"
    targetSkill: observability
    message: "Observability instrumentation detected — loading Observability guidance for log queries, tracing, and monitoring setup."
---

Debug stuck/hung apps: check logs → workflow runs → browser → deployment
