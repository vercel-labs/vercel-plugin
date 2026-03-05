---
name: routing-middleware
description: Vercel Routing Middleware guidance — request interception before cache, rewrites, redirects, personalization. Works with any framework. Supports Edge, Node.js, and Bun runtimes. Use when intercepting requests at the platform level.
---

# Vercel Routing Middleware

You are an expert in Vercel Routing Middleware — the platform-level request interception layer.

## What It Is

Routing Middleware runs **before the cache** on every request matching its config. It is a **Vercel platform** feature (not framework-specific) that works with Next.js, SvelteKit, Astro, Nuxt, or any deployed framework. Built on Fluid Compute.

- **File**: `middleware.ts` or `middleware.js` at the project root
- **Default export required** (function name can be anything)
- **Runtimes**: Edge (default), Node.js (`runtime: 'nodejs'`), Bun (Node.js + `bunVersion` in vercel.json)

## CRITICAL: Middleware Disambiguation

There are THREE "middleware" concepts in the Vercel ecosystem:

| Concept | File | Runtime | Scope | When to Use |
|---------|------|---------|-------|-------------|
| **Vercel Routing Middleware** | `middleware.ts` (root) | Edge/Node/Bun | Any framework, platform-level | Request interception before cache: rewrites, redirects, geo, A/B |
| **Next.js 16 Proxy** | `proxy.ts` (root, or `src/proxy.ts` if using `--src-dir`) | Node.js only | Next.js 16+ only | Network-boundary proxy needing full Node APIs. NOT for auth. |
| **Edge Functions** | Any function file | V8 isolates | General-purpose | Standalone edge compute endpoints, not an interception layer |

**Why the rename in Next.js 16**: `middleware.ts` → `proxy.ts` clarifies it sits at the network boundary (not general-purpose middleware). Partly motivated by CVE-2025-29927 (middleware auth bypass via `x-middleware-subrequest` header). Migration codemod: `npx @next/codemod@latest middleware-to-proxy`

## Basic Example

```ts
// middleware.ts (project root)
import { geolocation, rewrite } from '@vercel/functions';

export default function middleware(request: Request) {
  const { country } = geolocation(request);
  const url = new URL(request.url);
  url.pathname = country === 'US' ? '/us' + url.pathname : '/intl' + url.pathname;
  return rewrite(url);
}

export const config = {
  runtime: 'edge', // 'edge' (default) | 'nodejs'
};
```

## Helper Methods (`@vercel/functions`)

For non-Next.js frameworks, import from `@vercel/functions`:

| Helper | Purpose |
|--------|---------|
| `next()` | Continue middleware chain (optionally modify headers) |
| `rewrite(url)` | Transparently serve content from a different URL |
| `geolocation(request)` | Get `city`, `country`, `latitude`, `longitude`, `region` |
| `ipAddress(request)` | Get client IP address |
| `waitUntil(promise)` | Keep function running after response is sent |

For Next.js, equivalent helpers are on `NextResponse` (`next()`, `rewrite()`, `redirect()`) and `NextRequest` (`request.geo`, `request.ip`).

## Matcher Configuration

Middleware runs on **every route** by default. Use `config.matcher` to scope it:

```ts
// Single path
export const config = { matcher: '/dashboard/:path*' };

// Multiple paths
export const config = { matcher: ['/dashboard/:path*', '/api/:path*'] };

// Regex: exclude static files
export const config = {
  matcher: ['/((?!_next/static|favicon.ico).*)'],
};
```

**Tip**: Using `matcher` is preferred — unmatched paths skip middleware invocation entirely (saves compute).

## Common Patterns

### IP-Based Header Injection

```ts
import { ipAddress, next } from '@vercel/functions';

export default function middleware(request: Request) {
  return next({ headers: { 'x-real-ip': ipAddress(request) || 'unknown' } });
}
```

### A/B Testing via Edge Config

```ts
import { get } from '@vercel/edge-config';
import { rewrite } from '@vercel/functions';

export default async function middleware(request: Request) {
  const variant = await get('experiment-homepage'); // <1ms read
  const url = new URL(request.url);
  url.pathname = variant === 'B' ? '/home-b' : '/home-a';
  return rewrite(url);
}
```

### Background Processing

```ts
import type { RequestContext } from '@vercel/functions';

export default function middleware(request: Request, context: RequestContext) {
  context.waitUntil(
    fetch('https://analytics.example.com/log', { method: 'POST', body: request.url })
  );
  return new Response('OK');
}
```

## Request Limits

| Limit | Value |
|-------|-------|
| Max URL length | 14 KB |
| Max request body | 4 MB |
| Max request headers | 64 headers / 16 KB total |

## When to Use

- Geo-personalization of static pages (runs before cache)
- A/B testing rewrites with Edge Config
- Custom redirects based on request properties
- Header injection (CSP, CORS, custom headers)
- Lightweight auth checks (defense-in-depth only — not sole auth layer)

## When NOT to Use

- Need full Node.js APIs in Next.js → use `proxy.ts`
- General compute at the edge → use Edge Functions
- Heavy business logic or database queries → use server-side framework features
- Auth as sole protection → use Layouts, Server Components, or Route Handlers

## References

- 📖 docs: https://vercel.com/docs/routing-middleware
- 📖 API reference: https://vercel.com/docs/routing-middleware/api
- 📖 getting started: https://vercel.com/docs/routing-middleware/getting-started
