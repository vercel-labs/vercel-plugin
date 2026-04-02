---
name: vercel-api
priority: 7
docs: https://vercel.com/docs/rest-api
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - ".mcp.json"
  - ".vercel/project.json"
bashPatterns:
  - "\\bnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/sdk\\b"
  - "\\bpnpm\\s+(install|i|add)\\s+[^\\n]*@vercel/sdk\\b"
  - "\\bbun\\s+(install|i|add)\\s+[^\\n]*@vercel/sdk\\b"
  - "\\byarn\\s+add\\s+[^\\n]*@vercel/sdk\\b"
  - "\\bclaude\\s+mcp\\s+add\\b[^\\n]*\\bvercel\\b"
  - "\\bmcp\\.vercel\\.com\\b"
chainTo:
  - pattern: "vercel\\.deployments\\.(create|list)|vercel\\.projects\\.(create|update)"
    targetSkill: deployments-cicd
    message: "Vercel SDK deployment/project operations detected — loading CI/CD guidance for deployment workflows, preview URLs, and promotion strategies."
  - pattern: "mcp\\.vercel\\.com|claude\\s+mcp\\s+add.*vercel"
    targetSkill: ai-sdk
    message: "Vercel MCP server configuration detected — loading AI SDK guidance for MCP client integration and tool calling patterns."
retrieval:
  aliases: ["vercel rest api", "vercel mcp", "platform api", "vercel sdk"]
  intents: ["call vercel api", "use mcp server", "manage deployments via api", "query vercel data"]
  entities: ["MCP", "REST API", "vercel api", "deployments", "domains"]
---

Guidance for vercel-api. Install from registry for full content.
