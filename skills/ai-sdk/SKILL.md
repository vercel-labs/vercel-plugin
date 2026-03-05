---
name: ai-sdk
description: Vercel AI SDK expert guidance. Use when building AI-powered features — chat interfaces, text generation, structured output, tool calling, agents, MCP integration, streaming, embeddings, reranking, image generation, or working with any LLM provider.
---

# Vercel AI SDK (v6)

You are an expert in the Vercel AI SDK v6. The AI SDK is the leading TypeScript toolkit for building AI-powered applications. It provides a unified API across all LLM providers.

## Installation

```bash
npm install ai                # Core SDK — AI Gateway is built in, no provider SDK needed
npm install @ai-sdk/react     # Required for React hooks (useChat, useCompletion, useObject)
```

> **`@ai-sdk/react` is a separate package** — it is NOT included in the `ai` package. You must install it alongside `ai` for any React/Next.js project that uses `useChat` or other UI hooks.

> **Only install a direct provider SDK** (e.g., `@ai-sdk/anthropic`) if you need provider-specific features not exposed through the gateway.

## Setup for AI Projects

For the smoothest experience, link to a Vercel project so AI Gateway credentials are auto-provisioned via OIDC:

```bash
vercel link                    # Connect to your Vercel project
# Enable AI Gateway in Vercel dashboard
vercel env pull .env.local     # Provisions VERCEL_OIDC_TOKEN automatically
npm install ai                 # Gateway is built in
npx ai-elements                # Optional: install chat UI components
```

This gives you AI Gateway access with OIDC authentication, cost tracking, failover, and observability — no manual API keys needed.

**OIDC is the default auth**: `vercel env pull` provisions a `VERCEL_OIDC_TOKEN` (short-lived JWT, ~24h). The `@ai-sdk/gateway` reads it automatically via `@vercel/oidc`. On Vercel deployments, tokens auto-refresh. For local dev, re-run `vercel env pull` when the token expires. No `AI_GATEWAY_API_KEY` or provider-specific keys needed.

## Global Provider System (AI Gateway — Default)

In AI SDK 6, use `gateway('provider/model')` to route through the Vercel AI Gateway:

```ts
import { gateway } from 'ai'

const model = gateway('openai/gpt-5.2')
// or: gateway('anthropic/claude-sonnet-4.6')
// or: gateway('google/gemini-3-flash')
```

This automatically provides failover, cost tracking, and observability on Vercel. **This is the recommended default for all AI features.**

> **Direct provider SDKs** (`@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.) are only needed for provider-specific features not exposed through the gateway (e.g., Anthropic computer use, OpenAI fine-tuned model endpoints).

## Core Functions

### Text Generation
```ts
import { generateText, streamText, gateway } from 'ai'

// Non-streaming
const { text } = await generateText({
  model: gateway('openai/gpt-5.2'),
  prompt: 'Explain quantum computing in simple terms.',
})

// Streaming
const result = streamText({
  model: gateway('openai/gpt-5.2'),
  prompt: 'Write a poem about coding.',
})

for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}
```

### Structured Output
```ts
import { generateText, Output, gateway } from 'ai'
import { z } from 'zod'

const { output } = await generateText({
  model: gateway('openai/gpt-5.2'),
  output: Output.object({
    schema: z.object({
      recipe: z.object({
        name: z.string(),
        ingredients: z.array(z.object({
          name: z.string(),
          amount: z.string(),
        })),
        steps: z.array(z.string()),
      }),
    }),
  }),
  prompt: 'Generate a recipe for chocolate chip cookies.',
})
```

### Tool Calling (MCP-Aligned)

In AI SDK 6, tools use `inputSchema` (not `parameters`) and `output`/`outputSchema` (not `result`), aligned with the MCP specification.

```ts
import { generateText, tool, gateway } from 'ai'
import { z } from 'zod'

const result = await generateText({
  model: gateway('openai/gpt-5.2'),
  tools: {
    weather: tool({
      description: 'Get the weather for a location',
      inputSchema: z.object({
        city: z.string().describe('The city name'),
      }),
      outputSchema: z.object({
        temperature: z.number(),
        condition: z.string(),
      }),
      execute: async ({ city }) => {
        const data = await fetchWeather(city)
        return { temperature: data.temp, condition: data.condition }
      },
    }),
  },
  prompt: 'What is the weather in San Francisco?',
})
```

### Dynamic Tools (MCP Integration)

For tools with schemas not known at compile time (e.g., MCP server tools):

```ts
import { dynamicTool } from 'ai'

const tools = {
  unknownTool: dynamicTool({
    description: 'A tool discovered at runtime',
    execute: async (input) => {
      // Handle dynamically
      return { result: 'done' }
    },
  }),
}
```

### Agents

The Agent class wraps `generateText`/`streamText` with agentic loop control:

```ts
import { Agent, gateway } from 'ai'

const agent = new Agent({
  model: gateway('anthropic/claude-sonnet-4.6'),
  tools: { weather, search, calculator },
  system: 'You are a helpful assistant.',
  stopWhen: (context) => context.toolCalls.length === 0, // Stop when no tools called
  prepareStep: (context) => ({
    // Customize each step
    toolChoice: context.steps.length > 5 ? 'none' : 'auto',
  }),
})

const { text } = await agent.generateText({
  prompt: 'Research the weather in Tokyo and calculate the average temperature this week.',
})
```

### MCP Client

Connect to any MCP server and use its tools:

```ts
import { gateway } from 'ai'
import { createMCPClient } from '@ai-sdk/mcp'

const mcpClient = await createMCPClient({
  transport: {
    type: 'sse',
    url: 'https://my-mcp-server.com/sse',
  },
})

const tools = await mcpClient.tools()

const result = await generateText({
  model: gateway('openai/gpt-5.2'),
  tools,
  prompt: 'Use the available tools to help the user.',
})

await mcpClient.close()
```

MCP OAuth for remote servers is handled automatically by `@ai-sdk/mcp`.

### Embeddings & Reranking

```ts
import { embed, embedMany, rerank } from 'ai'

// Single embedding
const { embedding } = await embed({
  model: openai.embedding('text-embedding-3-small'),
  value: 'The quick brown fox',
})

// Batch embeddings
const { embeddings } = await embedMany({
  model: openai.embedding('text-embedding-3-small'),
  values: ['text 1', 'text 2', 'text 3'],
})

// Rerank search results by relevance
const { results } = await rerank({
  model: cohere.reranker('rerank-v3.5'),
  query: 'What is quantum computing?',
  documents: searchResults,
})
```

### Image Generation & Editing

```ts
import { generateImage, editImage } from 'ai'

const { image } = await generateImage({
  model: openai.image('dall-e-3'),
  prompt: 'A futuristic cityscape at sunset',
})

const { image: edited } = await editImage({
  model: openai.image('dall-e-3'),
  image: originalImage,
  prompt: 'Add flying cars to the scene',
})
```

## UI Hooks (React)

### With AI Elements (Recommended)

```tsx
'use client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Conversation } from '@/components/ai-elements/conversation'
import { Message } from '@/components/ai-elements/message'

function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  return (
    <Conversation>
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
    </Conversation>
  )
}
```

AI Elements handles UIMessage parts (text, tool calls, reasoning, images) automatically. Install with `npx ai-elements`.

⤳ skill: ai-elements — Full component library for AI interfaces
⤳ skill: json-render — Manual rendering patterns for custom UIs

### Without AI Elements (Manual)

```tsx
'use client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          {m.parts?.map((part, i) => {
            if (part.type === 'text') return <p key={i}>{part.text}</p>
            if (part.type.startsWith('tool-')) return <ToolCard key={i} part={part} />
            return null
          })}
        </div>
      ))}
    </div>
  )
}
```

**v6 changes from v5:**
- `useChat({ api })` → `useChat({ transport: new DefaultChatTransport({ api }) })`
- `handleSubmit` → `sendMessage({ text })`
- `input` / `handleInputChange` → manage your own `useState`
- `isLoading` → `status === 'streaming' || status === 'submitted'`
- `message.content` → iterate `message.parts` (UIMessage format)

### Server-side for useChat
```ts
// app/api/chat/route.ts
import { streamText, convertToModelMessages, stepCountIs, gateway } from 'ai'
import type { UIMessage } from 'ai'

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()
  // IMPORTANT: convertToModelMessages is async in v6
  const modelMessages = await convertToModelMessages(messages)
  const result = streamText({
    model: gateway('openai/gpt-5.2'),
    messages: modelMessages,
    tools: { /* your tools */ },
    // IMPORTANT: use stopWhen with stepCountIs for multi-step tool calling
    // maxSteps was removed in v6 — use this instead
    stopWhen: stepCountIs(5),
  })
  // Use toUIMessageStreamResponse (not toDataStreamResponse) for chat UIs
  return result.toUIMessageStreamResponse()
}
```

## Language Model Middleware

Intercept and transform model calls for RAG, guardrails, logging:

```ts
import { wrapLanguageModel, gateway } from 'ai'

const wrappedModel = wrapLanguageModel({
  model: gateway('openai/gpt-5.2'),
  middleware: {
    transformParams: async ({ params }) => {
      // Inject RAG context, modify system prompt, etc.
      return { ...params, system: params.system + '\n\nContext: ...' }
    },
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      // Post-process, log, validate guardrails
      return result
    },
  },
})
```

## Provider Routing via AI Gateway

```ts
import { generateText } from 'ai'
import { gateway } from 'ai'

const result = await generateText({
  model: gateway('anthropic/claude-sonnet-4.6'),
  prompt: 'Hello!',
  providerOptions: {
    gateway: {
      order: ['bedrock', 'anthropic'],        // Try Bedrock first
      models: ['openai/gpt-5.2'],           // Fallback model
      only: ['anthropic', 'bedrock'],          // Restrict providers
      user: 'user-123',                        // Usage tracking
      tags: ['feature:chat', 'env:production'], // Cost attribution
    },
  },
})
```

## DevTools

```bash
npx @ai-sdk/devtools
# Opens http://localhost:4983 — inspect LLM calls, agents, token usage, timing
```

## Key Patterns

1. **Default to AI Gateway with OIDC** — use `import { gateway } from 'ai'` for all AI features. `vercel env pull` provisions OIDC tokens automatically. No manual API keys needed.
2. **Set up a Vercel project for AI** — `vercel link` → enable AI Gateway in dashboard → `vercel env pull` to get OIDC credentials. Never manually create `.env.local` with provider-specific API keys.
3. **Use AI Elements for chat UIs** — `npx ai-elements` installs production-ready Message, Conversation, and Tool components that handle UIMessage parts automatically. ⤳ skill: ai-elements
4. **Always stream for user-facing AI** — use `streamText` + `useChat`, not `generateText`
5. **Server: `convertToModelMessages()` (async) + `toUIMessageStreamResponse()`** — not `toDataStreamResponse()`. Client: `DefaultChatTransport` with `useChat`.
6. **Use structured output** for extracting data — `generateText` with `Output.object()` and Zod schemas
7. **Use the Agent class** for multi-step reasoning — not manual loops
8. **Use DurableAgent** (from Workflow DevKit) for production agents that must survive crashes
9. **Use `mcp-to-ai-sdk`** to generate static tool definitions from MCP servers for security

## Migration from AI SDK 5

Run `npx @ai-sdk/codemod v6` to auto-migrate. Key changes:
- `generateObject` / `streamObject` → `generateText` / `streamText` with `Output.object()`
- `parameters` → `inputSchema`
- `result` → `output`
- `maxSteps` → `stopWhen: stepCountIs(N)` (import `stepCountIs` from `ai`)
- `CoreMessage` → `ModelMessage` (use `convertToModelMessages()` — now async)
- `Experimental_Agent` → `ToolLoopAgent` (`system` → `instructions`)
- `experimental_createMCPClient` → `createMCPClient` (stable)
- `useChat({ api })` → `useChat({ transport: new DefaultChatTransport({ api }) })`
- `handleSubmit` / `input` → `sendMessage({ text })` / manage own state
- `toDataStreamResponse()` → `toUIMessageStreamResponse()` (for chat UIs)
- `message.content` → `message.parts` (UIMessage format with typed parts)
- UIMessage / ModelMessage types introduced
- `@ai-sdk/react` must be installed separately (`npm install @ai-sdk/react`)

## Official Documentation

- [AI SDK Documentation](https://ai-sdk.dev/docs)
- [AI SDK Core](https://ai-sdk.dev/docs/ai-sdk-core)
- [AI SDK UI](https://ai-sdk.dev/docs/ai-sdk-ui)
- [Generating Text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Structured Data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [Tools and Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [Agents](https://ai-sdk.dev/docs/ai-sdk-core/agents)
- [Providers and Models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [Provider Directory](https://ai-sdk.dev/providers)
- [GitHub: AI SDK](https://github.com/vercel/ai)
