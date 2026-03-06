---
name: ai-gateway
description: Vercel AI Gateway expert guidance. Use when configuring model routing, provider failover, cost tracking, or managing multiple AI providers through a unified API.
metadata:
  priority: 7
  pathPatterns: []
  bashPatterns:
    - '\bvercel\s+env\s+pull\b'
    - '\bnpm\s+(install|i|add)\s+[^\n]*@ai-sdk/gateway\b'
    - '\bpnpm\s+(install|i|add)\s+[^\n]*@ai-sdk/gateway\b'
    - '\bbun\s+(install|i|add)\s+[^\n]*@ai-sdk/gateway\b'
    - '\byarn\s+add\s+[^\n]*@ai-sdk/gateway\b'
---

# Vercel AI Gateway

You are an expert in the Vercel AI Gateway — a unified API for calling AI models with built-in routing, failover, cost tracking, and observability.

## Overview

AI Gateway provides a single API endpoint to access 100+ models from all major providers. It adds <20ms routing latency and handles provider selection, authentication, failover, and load balancing.

## Setup

The AI SDK automatically uses the AI Gateway when you pass a model string in `"provider/model"` format:

```ts
import { generateText } from 'ai'
import { gateway } from 'ai' // Available since AI SDK 5.0.36+

const result = await generateText({
  model: gateway('openai/gpt-5.2'),
  prompt: 'Hello!',
})
```

No additional package needed — the `gateway` provider is built into the `ai` package.

## Authentication (OIDC — Default)

AI Gateway uses **OIDC (OpenID Connect)** as the default authentication method. No manual API keys needed.

### Setup

```bash
vercel link                    # Connect to your Vercel project
# Enable AI Gateway in Vercel dashboard: https://vercel.com/{team}/{project}/settings → AI Gateway
vercel env pull .env.local     # Provisions VERCEL_OIDC_TOKEN automatically
```

### How It Works

1. `vercel env pull` writes a `VERCEL_OIDC_TOKEN` to `.env.local` — a short-lived JWT (~24h)
2. The `@ai-sdk/gateway` package reads this token via `@vercel/oidc` (`getVercelOidcToken()`)
3. No `AI_GATEWAY_API_KEY` or provider-specific keys (like `ANTHROPIC_API_KEY`) are needed
4. On Vercel deployments, OIDC tokens are auto-refreshed — zero maintenance

### Local Development

For local dev, the OIDC token from `vercel env pull` is valid for ~24 hours. When it expires:

```bash
vercel env pull .env.local --yes   # Re-pull to get a fresh token
```

### Alternative: Manual API Key

If you prefer a static key (e.g., for CI or non-Vercel environments):

```bash
# Set AI_GATEWAY_API_KEY in your environment
# The gateway falls back to this when VERCEL_OIDC_TOKEN is not available
export AI_GATEWAY_API_KEY=your-key-here
```

### Auth Priority

The `@ai-sdk/gateway` package resolves authentication in this order:
1. `AI_GATEWAY_API_KEY` environment variable (if set)
2. `VERCEL_OIDC_TOKEN` via `@vercel/oidc` (default on Vercel and after `vercel env pull`)

## Provider Routing

Configure how AI Gateway routes requests across providers:

```ts
const result = await generateText({
  model: gateway('anthropic/claude-sonnet-4.6'),
  prompt: 'Hello!',
  providerOptions: {
    gateway: {
      // Try providers in order; failover to next on error
      order: ['bedrock', 'anthropic'],

      // Restrict to specific providers only
      only: ['anthropic', 'vertex'],

      // Fallback models if primary model fails
      models: ['openai/gpt-5.2', 'google/gemini-3-flash'],

      // Track usage per end-user
      user: 'user-123',

      // Tag for cost attribution and filtering
      tags: ['feature:chat', 'env:production', 'team:growth'],
    },
  },
})
```

### Routing Options

| Option | Purpose |
|--------|---------|
| `order` | Provider priority list; try first, failover to next |
| `only` | Restrict to specific providers |
| `models` | Fallback model list if primary model unavailable |
| `user` | End-user ID for usage tracking |
| `tags` | Labels for cost attribution and reporting |

## Cache-Control Headers

AI Gateway supports response caching to reduce latency and cost for repeated or similar requests:

```ts
const result = await generateText({
  model: gateway('openai/gpt-5.2'),
  prompt: 'What is the capital of France?',
  providerOptions: {
    gateway: {
      // Cache identical requests for 1 hour
      cacheControl: 'max-age=3600',
    },
  },
})
```

### Caching strategies

| Header Value | Behavior |
|-------------|----------|
| `max-age=3600` | Cache response for 1 hour |
| `max-age=0` | Bypass cache, always call provider |
| `s-maxage=86400` | Cache at the edge for 24 hours |
| `stale-while-revalidate=600` | Serve stale for 10 min while refreshing in background |

### When to use caching

- **Static knowledge queries**: FAQs, translations, factual lookups — cache aggressively
- **User-specific conversations**: Do not cache — each response depends on conversation history
- **Embeddings**: Cache embedding results for identical inputs to save cost
- **Structured extraction**: Cache when extracting structured data from identical documents

### Cache key composition

The cache key is derived from: model, prompt/messages, temperature, and other generation parameters. Changing any parameter produces a new cache key.

## Per-User Rate Limiting

Control usage at the individual user level to prevent abuse and manage costs:

```ts
const result = await generateText({
  model: gateway('openai/gpt-5.2'),
  prompt: userMessage,
  providerOptions: {
    gateway: {
      user: userId, // Required for per-user rate limiting
      tags: ['feature:chat'],
    },
  },
})
```

### Rate limit configuration

Configure rate limits at `https://vercel.com/{team}/{project}/settings` → **AI Gateway** → **Rate Limits**:

- **Requests per minute per user**: Throttle individual users (e.g., 20 RPM)
- **Tokens per day per user**: Cap daily token consumption (e.g., 100K tokens/day)
- **Concurrent requests per user**: Limit parallel calls (e.g., 3 concurrent)

### Handling rate limit responses

When a user exceeds their limit, the gateway returns HTTP 429:

```ts
import { generateText, APICallError } from 'ai'

try {
  const result = await generateText({
    model: gateway('openai/gpt-5.2'),
    prompt: userMessage,
    providerOptions: { gateway: { user: userId } },
  })
} catch (error) {
  if (APICallError.isInstance(error) && error.statusCode === 429) {
    const retryAfter = error.responseHeaders?.['retry-after']
    return new Response(
      JSON.stringify({ error: 'Rate limited', retryAfter }),
      { status: 429 }
    )
  }
  throw error
}
```

## Budget Alerts and Cost Controls

### Tagging for cost attribution

Use tags to track spend by feature, team, and environment:

```ts
providerOptions: {
  gateway: {
    tags: [
      'feature:document-qa',
      'team:product',
      'env:production',
      'tier:premium',
    ],
    user: userId,
  },
}
```

### Setting up budget alerts

In the Vercel dashboard at `https://vercel.com/{team}/{project}/settings` → **AI Gateway**:

1. Navigate to **AI Gateway → Usage & Budgets**
2. Set monthly budget thresholds (e.g., $500/month warning, $1000/month hard limit)
3. Configure alert channels (email, Slack webhook, Vercel integration)
4. Optionally set per-tag budgets for granular control

### Hard spending limits

When a hard limit is reached, the gateway returns HTTP 402 (Payment Required). Handle this gracefully:

```ts
if (APICallError.isInstance(error) && error.statusCode === 402) {
  // Budget exceeded — degrade gracefully
  return fallbackResponse()
}
```

### Cost optimization patterns

- Use cheaper models for classification/routing, expensive models for generation
- Cache embeddings and static queries (see Cache-Control above)
- Set per-user daily token caps to prevent runaway usage
- Monitor cost-per-feature with tags to identify optimization targets

## Audit Logging

AI Gateway logs every request for compliance and debugging:

### What's logged

- Timestamp, model, provider used
- Input/output token counts
- Latency (routing + provider)
- User ID and tags
- HTTP status code
- Failover chain (which providers were tried)

### Accessing logs

- **Vercel Dashboard** at `https://vercel.com/{team}/{project}/ai` → **Logs** — filter by model, user, tag, status, date range
- **Vercel API**: Query logs programmatically:

```bash
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v1/ai-gateway/logs?projectId=$PROJECT_ID&limit=100"
```

- **Log Drains**: Forward AI Gateway logs to Datadog, Splunk, or other providers via Vercel Log Drains (configure at `https://vercel.com/dashboard/{team}/~/settings/log-drains`) for long-term retention and custom analysis

### Compliance considerations

- AI Gateway does not log prompt or completion content by default
- Enable content logging in project settings if required for compliance
- Logs are retained per your Vercel plan's retention policy
- Use `user` field consistently to support audit trails

## Error Handling Patterns

### Provider unavailable

When a provider is down, the gateway automatically fails over if you configured `order` or `models`:

```ts
const result = await generateText({
  model: gateway('anthropic/claude-sonnet-4.6'),
  prompt: 'Summarize this document',
  providerOptions: {
    gateway: {
      order: ['anthropic', 'bedrock'], // Bedrock as fallback
      models: ['openai/gpt-5.2'],   // Final fallback model
    },
  },
})
```

### Quota exceeded at provider

If your provider API key hits its quota, the gateway tries the next provider in the `order` list. Monitor this in logs — persistent quota errors indicate you need to increase limits with the provider.

### Invalid model identifier

```ts
// Bad — model doesn't exist
model: gateway('openai/gpt-99')  // Returns 400 with descriptive error

// Good — use models listed in Vercel docs
model: gateway('openai/gpt-5.2')
```

### Timeout handling

Gateway has a default timeout per provider. For long-running generations, use streaming:

```ts
import { streamText } from 'ai'

const result = streamText({
  model: gateway('anthropic/claude-sonnet-4.6'),
  prompt: longDocument,
})

for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}
```

### Complete error handling template

```ts
import { generateText, APICallError } from 'ai'

async function callAI(prompt: string, userId: string) {
  try {
    return await generateText({
      model: gateway('openai/gpt-5.2'),
      prompt,
      providerOptions: {
        gateway: {
          user: userId,
          order: ['openai', 'azure-openai'],
          models: ['anthropic/claude-haiku-4.5'],
          tags: ['feature:chat'],
        },
      },
    })
  } catch (error) {
    if (!APICallError.isInstance(error)) throw error

    switch (error.statusCode) {
      case 402: return { text: 'Budget limit reached. Please try again later.' }
      case 429: return { text: 'Too many requests. Please slow down.' }
      case 503: return { text: 'AI service temporarily unavailable.' }
      default: throw error
    }
  }
}
```

## Gateway vs Direct Provider — Decision Tree

Use this to decide whether to route through AI Gateway or call a provider SDK directly:

```
Need failover across providers?
  └─ Yes → Use Gateway
  └─ No
      Need cost tracking / budget alerts?
        └─ Yes → Use Gateway
        └─ No
            Need per-user rate limiting?
              └─ Yes → Use Gateway
              └─ No
                  Need audit logging?
                    └─ Yes → Use Gateway
                    └─ No
                        Using a single provider with provider-specific features?
                          └─ Yes → Use direct provider SDK
                          └─ No → Use Gateway (simplifies code)
```

### When to use direct provider SDK

- You need provider-specific features not exposed through the gateway (e.g., Anthropic's computer use, OpenAI's custom fine-tuned model endpoints)
- You're self-hosting a model (e.g., vLLM, Ollama) that isn't registered with the gateway
- You need request-level control over HTTP transport (custom proxies, mTLS)

### When to always use Gateway

- Production applications — failover and observability are essential
- Multi-tenant SaaS — per-user tracking and rate limiting
- Teams with cost accountability — tag-based budgeting

## Supported Providers

- OpenAI (GPT-5.x, o-series)
- Anthropic (Claude 4.x)
- Google (Gemini)
- xAI (Grok)
- Mistral
- DeepSeek
- Amazon Bedrock
- Azure OpenAI
- Cohere
- Perplexity
- Alibaba (Qwen)
- Meta (Llama)
- And many more (100+ models total)

## Pricing

- **Vercel-managed keys**: Tokens at provider list price, no markup
- **Bring Your Own Key**: 0% markup on token costs
- **Free tier**: $5 credits every 30 days on any Vercel account

## Multimodal Support

Text, image, and video generation all route through the gateway:

```ts
// Text
const { text } = await generateText({
  model: gateway('openai/gpt-5.2'),
  prompt: 'Hello',
})

// Image
const { image } = await generateImage({
  model: gateway('openai/dall-e-3'),
  prompt: 'A sunset',
})
```

## Key Benefits

1. **Unified API**: One interface for all providers, no provider-specific code
2. **Automatic failover**: If a provider is down, requests route to the next
3. **Cost tracking**: Per-user, per-feature attribution with tags
4. **Observability**: Built-in monitoring of all model calls
5. **Low latency**: <20ms routing overhead
6. **No lock-in**: Switch models/providers by changing a string

## When to Use AI Gateway

| Scenario | Use Gateway? |
|----------|-------------|
| Production app with AI features | Yes — failover, cost tracking |
| Prototyping with single provider | Optional — direct provider works fine |
| Multi-provider setup | Yes — unified routing |
| Need provider-specific features | Use direct provider SDK + Gateway as fallback |
| Cost tracking and budgeting | Yes — user tracking and tags |
| Multi-tenant SaaS | Yes — per-user rate limiting and audit |
| Compliance requirements | Yes — audit logging and log drains |

## Official Documentation

- [AI Gateway](https://vercel.com/docs/ai-gateway)
- [Providers and Models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK Core](https://ai-sdk.dev/docs/ai-sdk-core)
- [GitHub: AI SDK](https://github.com/vercel/ai)
