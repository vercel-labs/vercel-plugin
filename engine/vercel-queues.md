---
name: vercel-queues
priority: 5
docs: https://vercel.com/docs/workflow-collaboration/conformance
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - "lib/queues/**"
  - "src/lib/queues/**"
  - "lib/queues.*"
  - "lib/queue.*"
  - "src/lib/queues.*"
  - "src/lib/queue.*"
  - "workflows/*.ts"
  - "workflows/*.mts"
  - "src/workflows/*.ts"
  - "src/workflows/*.mts"
  - "app/api/workflow/**"
  - "src/app/api/workflow/**"
  - "app/api/workflows/**"
  - "src/app/api/workflows/**"
  - "vercel.ts"
  - "vercel.mts"
bashPatterns:
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/queue\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/queue\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@vercel/queue\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@vercel/queue\\b"
importPatterns:
  - "workflow"
  - "@vercel/workflow"
chainTo:
  - pattern: "from\\s+[''\"\"]bullmq[''\"\"]|from\\s+[''\"\"]bull[''\"\"]|new\\s+(Queue|Worker)\\("
    targetSkill: workflow
    message: "BullMQ/Bull job queue detected — Vercel Queues provides managed durable event streaming. Loading Workflow DevKit guidance for durable execution patterns."
  - pattern: "from\\s+[''\"\"]@aws-sdk/client-sqs[''\"\"]|from\\s+[''\"\"]amqplib[''\"\"]"
    targetSkill: workflow
    message: "External message queue SDK detected — Vercel Queues replaces SQS/RabbitMQ with managed event streaming. Loading Workflow DevKit for durable patterns."
  - pattern: "from\\s+[''\\\"](p-queue|fastq|piscina)[''\"]|require\\s*\\(\\s*[''\\\"](p-queue|fastq|piscina)[''\"]|from\\s+[''\"\"]redis-queue[''\"\"]|new\\s+PQueue\\s*\\("
    targetSkill: vercel-queues
    message: "In-process queue library detected (p-queue/fastq/piscina) — Vercel Queues provides durable, distributed event streaming with at-least-once delivery, retries, and delayed delivery across serverless functions."
retrieval:
  aliases: ["message queue", "event streaming", "async processing", "task queue"]
  intents: ["add message queue", "process events async", "set up fan out", "configure retries"]
  entities: ["Vercel Queues", "topics", "consumer groups", "delayed delivery", "Workflow DevKit"]
---

Guidance for vercel-queues. Install from registry for full content.
