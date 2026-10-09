---
name: fastify-best-practices
description: "In this project: the local server/ module (request log of e-Consul calls, schedule-change log). Guides development of Fastify Node.js backend servers and REST APIs using TypeScript or JavaScript. Use when building, configuring, or debugging a Fastify application — including defining routes, implementing plugins, setting up JSON Schema validation, handling errors, optimising performance, managing authentication, configuring CORS and security headers, integrating databases, working with WebSockets, and deploying to production. Covers the full Fastify request lifecycle (hooks, serialization, logging with Pino) and TypeScript integration via strip types. Trigger terms: Fastify, Node.js server, REST API, API routes, backend framework, fastify.config, server.ts, app.ts."
metadata:
  tags: fastify, nodejs, typescript, backend, api, server, http
---

## In this project — read first

> Status: proposed 2026-10-09, pending the stack decision in `docs/brainstorm/ideas.md`.
> If brainstorm records a different server or database, this section is out of date: say so.

The backend is a small local module, `server/` (Fastify 5 + Drizzle + Postgres in Docker),
next to the web app. Its first job is the **request log**: every request the web app makes to
e-Consul is recorded in the database. It may also take over the schedule-change log
(`POST /schedule-log`, today written to `logs/schedule-changes.jsonl` by `main.go`).

What shapes the server:

- **The server never calls e-Consul.** Requests to `my.e-consul.gov.ua` work only from a browser
  (Cloudflare) and carry the user's token (`docs/booking.md` §1, §14). The web app makes them and
  then *reports* each one to `POST /request-log`. A route that proxies e-Consul is a design error.
- **No token, ever.** The log body schema is `.strict()`: an unknown key such as `token` or
  `headers` is rejected with 422, not stripped silently. Never log request headers with Pino
  either (`redact: ['req.headers.token', 'req.headers.authorization']` as a second guard).
- **Local only.** Listen on `127.0.0.1`, CORS allows exactly `http://localhost:3000`, body limit
  ~256 KB, batches of at most 100 entries.
- **Logging must never slow monitoring.** The route validates and inserts in one statement and
  returns 204; no reads, no enrichment on the write path.
- Module shape follows `onion-architecture` §11: `modules/request-log/routes.ts` (zod schemas,
  one call) → `service.ts` only if there is logic → `repository.ts` (Drizzle). Contracts live in
  `server/src/contracts/` and are shared with the web app.

| Route | Purpose |
|---|---|
| `POST /request-log` | `{ entries: RequestLogEntry[] }`, 1–100 entries → 204 |
| `GET /request-log` | `from`, `to`, `method`, `outcome`, `institutionCode`, `limit` (≤ 500), cursor by `id` → entries, newest first |
| `GET /request-log/summary` | counts and p50/p95 duration per method and outcome for a period |
| `GET /health` | liveness for the web app's status line |

The general guidance below is upstream (mcollina/skills) and applies as written.

## When to use

Use this skill when you need to:
- Develop backend applications using Fastify
- Implement Fastify plugins and route handlers
- Get guidance on Fastify architecture and patterns
- Use TypeScript with Fastify (strip types)
- Implement testing with Fastify's inject method
- Configure validation, serialization, and error handling

## Quick Start

A minimal, runnable Fastify server to get started immediately:

```ts
import Fastify from 'fastify'

const app = Fastify({ logger: true })

app.get('/health', async (request, reply) => {
  return { status: 'ok' }
})

const start = async () => {
  await app.listen({ port: 3000, host: '0.0.0.0' })
}
start()
```

## Recommended Reading Order for Common Scenarios

- **New to Fastify?** Start with `plugins.md` → `routes.md` → `schemas.md`
- **Adding authentication:** `plugins.md` → `hooks.md` → `authentication.md`
- **Improving performance:** `schemas.md` → `serialization.md` → `performance.md`
- **Setting up testing:** `routes.md` → `testing.md`
- **Going to production:** `logging.md` → `configuration.md` → `deployment.md`

## How to use

Read individual rule files for detailed explanations and code examples:

- [rules/plugins.md](rules/plugins.md) - Plugin development and encapsulation
- [rules/routes.md](rules/routes.md) - Route organization and handlers
- [rules/schemas.md](rules/schemas.md) - JSON Schema validation
- [rules/error-handling.md](rules/error-handling.md) - Error handling patterns
- [rules/hooks.md](rules/hooks.md) - Hooks and request lifecycle
- [rules/authentication.md](rules/authentication.md) - Authentication and authorization
- [rules/testing.md](rules/testing.md) - Testing with inject()
- [rules/performance.md](rules/performance.md) - Performance optimization
- [rules/logging.md](rules/logging.md) - Logging with Pino
- [rules/typescript.md](rules/typescript.md) - TypeScript integration
- [rules/decorators.md](rules/decorators.md) - Decorators and extensions
- [rules/content-type.md](rules/content-type.md) - Content type parsing
- [rules/serialization.md](rules/serialization.md) - Response serialization
- [rules/cors-security.md](rules/cors-security.md) - CORS and security headers
- [rules/websockets.md](rules/websockets.md) - WebSocket support
- [rules/database.md](rules/database.md) - Database integration patterns
- [rules/configuration.md](rules/configuration.md) - Application configuration
- [rules/deployment.md](rules/deployment.md) - Production deployment
- [rules/http-proxy.md](rules/http-proxy.md) - HTTP proxying and reply.from()

## Core Principles

- **Encapsulation**: Fastify's plugin system provides automatic encapsulation
- **Schema-first**: Define schemas for validation and serialization
- **Performance**: Fastify is optimized for speed; use its features correctly
- **Async/await**: All handlers and hooks support async functions
- **Minimal dependencies**: Prefer Fastify's built-in features and official plugins
