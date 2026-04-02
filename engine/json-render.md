---
name: json-render
priority: 4
docs: https://nextjs.org/docs/app/api-reference/file-conventions/route
sitemap: https://nextjs.org/sitemap.xml
pathPatterns:
  - "components/chat/**"
  - "components/chat-*.tsx"
  - "components/chat-*.ts"
  - "src/components/chat/**"
  - "src/components/chat-*.tsx"
  - "src/components/chat-*.ts"
  - "components/message*.tsx"
  - "src/components/message*.tsx"
chainTo:
  - pattern: "message\\.content\\b|tool-invocation"
    targetSkill: ai-sdk
    message: "Deprecated UIMessage v5 rendering pattern (message.content / tool-invocation) — loading AI SDK v6 guidance for message.parts migration."
  - pattern: "react-markdown|ReactMarkdown|dangerouslySetInnerHTML"
    targetSkill: ai-elements
    message: "Manual markdown rendering of AI content detected — loading AI Elements for streaming-aware, safe AI message rendering."
retrieval:
  aliases: ["chat rendering", "ai response display", "message parts", "tool call ui"]
  intents: ["render chat messages", "display tool calls", "show streaming response", "format ai output"]
  entities: ["UIMessage", "tool call", "streaming", "message parts"]
---

Guidance for json-render. Install from registry for full content.
