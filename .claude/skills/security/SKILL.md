---
name: security
description: "Security for the e-Consul slot monitor and its Chrome extension, plus general web security based on OWASP Top 10:2025. Use when code touches the user's e-Consul session token, window.postMessage or chrome.runtime messaging, extension permissions or content scripts, auto-booking, the schedule-log endpoint, localStorage, third-party fonts/scripts, or when reviewing code for vulnerabilities, handling input, managing secrets or building API endpoints. Covers React, Next.js route handlers, Chrome extensions (MV3) and JWT handling."
---

# Security Best Practices — OWASP Top 10:2025

Security guidance for React web apps with a JWT-based API. See `examples.md` for unsafe/safe code pairs, `checklists.md` for quick checklists, `references.md` for all sources.

## In this project — read first

A local, single-user tool: the app on `http://localhost:3000` and the Chrome
extension «e-Consul Helper» act on the user's real e-Consul session. The general
OWASP sections below apply to the small server part; the risks that matter most
here are specific:

| Asset / action | Rule | Where |
|---|---|---|
| **e-Consul JWT** (`token` header, `localStorage.token` on the site) | Lives in memory of the app tab and in `chrome.storage.session` of the extension. Sent **only** to `https://my.e-consul.gov.ua`. Never to our server or the schedule-log route, never into logs, `console`, error messages, URLs, the JSONL log, `localStorage` of the app, screenshots or commits. | `adapters/econsul-api` (today `callExternalReader` in `slots.html`), `extension/econsul.js`, `extension/background.js` |
| **App ↔ extension messages** | `postMessage` with target `window.location.origin`, never `"*"`. Receivers check `event.source === window`, `event.origin`, the `source` field (`econsul-app` / `econsul-ext`) and parse with the protocol schema; unknown types are dropped. The background gives the token only to tabs whose `sender.url` origin is `http://localhost:3000` (not by "has no tab": a popup opened as a tab has one). | `extension/app-bridge.js`, `background.js`, `extension/plans/extension-plan.md` §8 |
| **Auto-booking** («Підтвердити» on step 4) | Happens only when the user enabled the auto-booking setting; every path that can click it checks the setting at the moment of clicking. «Підтверджую» and «Записатись в чергу очікування» are never clicked. No booking API calls, no `PUT /documents` from our code. | `extension/picker.js`, `econsul.js` |
| **Extension permissions** | Keep `host_permissions` to `e-consul.gov.ua`, `my.e-consul.gov.ua` and `localhost:3000`. A new permission or host needs a stated reason in the change. Content scripts never inject remote code or `eval`. | `extension/manifest.json` |
| **Schedule-log endpoint** (`POST /schedule-log`) | Bound to localhost, size-limited (1 MB today), accepts JSON only, writes to a fixed path. No path, filename or command from the request body. | `main.go` today, `server/src/modules/schedule-log/` after the rewrite |
| **Request log** (`POST /request-log`, table `econsul_requests`) | Records method, filters, status, duration and outcome of each e-Consul call — never the token, request headers or response bodies. The body schema is `.strict()`, so a stray `token` key is a 422, not a silently stored secret. Server listens on `127.0.0.1`, CORS only `http://localhost:3000`. | `src/adapters/request-log`, `server/src/modules/request-log` |
| **Third-party code in the page** | The page holds the token, so every external script is a token thief in waiting. No analytics, no CDN scripts without an exact version and SRI; fonts are self-hosted (the extension already does this). | `slots.html` `<head>`, Next.js `layout.tsx` |
| **Rate of requests to e-Consul** | Keep the monitor's floor (10 s minimum interval, schedule once per 30 min, fast checks only in the ±window). Hammering the API risks the user's session and account. | `domain/monitoring` |
| **Testing** | Never test by booking a real slot or joining the waiting queue; use stubs and `test: true` messages (`extension/plans/extension-plan.md` §12). | — |

Not relevant here unless the stack changes: accounts and passwords, MongoDB,
multi-tenant access control, file uploads. Do not report them as findings for
this app.

---

## Core Philosophy — Confidence-Based Review

Before flagging any issue, **trace the data flow** and confirm the input source.

| Confidence | Criteria | Action |
|------------|----------|--------|
| **HIGH** | Vulnerable pattern + attacker-controlled input confirmed | **Report** with file, line, exploit, and fix |
| **MEDIUM** | Vulnerable pattern, input source unclear | **Note** for manual verification |
| **LOW** | Theoretical / best-practice deviation | **Do not report** — mention only if asked |

**Do NOT flag**: test files, dead code, server-controlled values (env vars, config constants), framework-mitigated patterns (React JSX escaping, Mongoose parameterized queries), development-only code gated by `NODE_ENV`.

> **Golden rule**: `fetch(process.env.API_URL)` = safe. `fetch(req.query.url)` = vulnerable. Always ask: **"Can an attacker control this value?"**

---

## OWASP Top 10:2025

| # | Category | Key Risk in This Stack |
|---|----------|----------------------|
| A01 | **Broken Access Control** | Missing auth middleware, IDOR, no ownership checks |
| A02 | **Security Misconfiguration** | Helmet disabled, CORS wildcard, stack traces in prod |
| A03 | **Supply Chain Failures** | Compromised npm packages, typosquatting |
| A04 | **Cryptographic Failures** | Weak JWT secret, low bcrypt cost, hardcoded secrets |
| A05 | **Injection** | MongoDB operator injection, XSS, command injection |
| A06 | **Insecure Design** | Missing rate limiting, no threat model |
| A07 | **Authentication Failures** | jwt.decode() instead of verify(), brute force |
| A08 | **Integrity Failures** | Mass assignment via req.body spread, unvalidated uploads |
| A09 | **Logging Failures** | Passwords in logs, missing auth event audit trail |
| A10 | **Exceptional Conditions** | Fail-open auth, stack trace leaks, missing async error handling |

---

## A01 — Broken Access Control

- **Deny by default** — every route is protected unless explicitly public
- Apply `auth` middleware as a **barrier** (via `router.use(auth)`) rather than per-route to prevent omissions
- **Always check ownership** on update/delete — being authenticated does not mean authorized for all resources
- Compare `resource.author.toString() === req.user.userId` plus admin role escape hatch
- React route guards are UX only — **server must enforce all access control**
- Test both horizontal (user A → user B's data) and vertical (author → admin endpoints) escalation

---

## A02 — Security Misconfiguration

- **Helmet**: Enable with `crossOriginResourcePolicy: 'cross-origin'` for uploads. If CSP disabled, implement custom CSP restricting `script-src` to `'self'`
- **CORS**: Explicit origin allowlist with `credentials: true`. Never `origin: '*'` or `origin: true` with credentials
- **Error handler**: Generic message in production, stack traces only when `NODE_ENV === 'development'`
- **Vite env vars**: `VITE_*` prefixed vars are **public in the client bundle** — never put secrets there
- **MongoDB**: Require auth + TLS in production, never expose port 27017 to internet, use `serverSelectionTimeoutMS`
- **Defaults**: Change seed credentials, disable debug middleware in production

---

## A03 — Supply Chain Failures

- Run `npm audit` before every release. Commit `package-lock.json` always.
- Pin exact versions for security-sensitive packages
- Before adding a dependency: check CVEs, maintenance activity (< 6 months), download count (> 10K/week), scope of access (network/fs/env)
- Watch for typosquatting (`expres` vs `express`)
- Vite plugins run with full Node.js access during build — use only well-known publishers

---

## A04 — Cryptographic Failures

- **Passwords**: bcrypt with salt rounds >= 10 (never MD5, SHA-1/256, or plain text). Preferred: Argon2id > bcrypt > scrypt
- **JWT secret**: Minimum 256-bit (32 bytes) cryptographically random, from `process.env.JWT_SECRET`
- **JWT signing**: Explicitly set `algorithm: 'HS256'` and `expiresIn`. Never allow `none` algorithm
- **JWT verification**: Always `jwt.verify()`, never `jwt.decode()` (decode doesn't check signature)
- **JWT payload**: Never store sensitive data (it's base64-encoded, not encrypted)
- **Transit**: HTTPS in production, `Strict-Transport-Security` header via Helmet
- **At rest**: Encrypt sensitive fields if storing PII. Never store raw credentials in MongoDB

---

## A05 — Injection

### MongoDB NoSQL Injection
- **Cast input types explicitly**: `String(req.body.email)` — neutralizes operator objects like `{ "$gt": "" }`
- Never put user input in `$where`, `$expr`, or `$function` (server-side JS execution)
- Never construct regex from user input without escaping (`str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`)
- Use Mongoose strict schemas with type definitions. Consider `mongo-sanitize` to strip `$` keys

### Cross-Site Scripting (XSS)
- React auto-escapes JSX — that's your default safety net
- **Never** use `dangerouslySetInnerHTML` without DOMPurify sanitization (allowlist tags/attributes)
- Validate URLs before `href`/`src` — reject `javascript:` protocol, allow only `http:`/`https:`
- Blog content and AI-generated content are high-risk for stored XSS — sanitize on input AND output
- Set CSP headers to mitigate any XSS that slips through

### Command Injection
- Never use `exec()` or `spawn({ shell: true })` with user input
- Use `execFile()` which passes arguments directly without shell interpretation

---

## A06 — Insecure Design

**Rate limiting strategy:**

| Endpoint | Limit | Window |
|----------|-------|--------|
| Login | 5 req | 15 min |
| Comments | 5 req | 1 min |
| AI generation | 3 req | 1 min |
| File upload | 10 req | 1 min |
| General API | 100 req | 1 min |

- **AI content generation**: Sanitize AI output before storing (XSS risk), validate prompt length, set request timeouts, never expose API keys to client, log prompts for audit
- **Comments**: Rate limit + sanitize + moderation (`isApproved` flag)

---

## A07 — Authentication Failures

- **Login**: Find user by email with `isActive: true`, compare with bcrypt, return generic "Invalid credentials" for both wrong email and wrong password (prevents enumeration)
- **JWT claims**: `{ userId, email, name, role }` — minimum viable
- **Token extraction**: Support `Bearer <token>` from Authorization header
- **Auth middleware must be fail-closed**: `next()` only called on successful `jwt.verify()`. Missing `return` before error response = fail-open vulnerability
- **Rate limit login**: `loginLimiter` on login endpoint (5 attempts / 15 min)
- **Password model**: Hash in `pre('save')` hook only if modified, `comparePassword` instance method, `toJSON` strips password from all responses
- Consider account lockout, progressive delays, CAPTCHA after N failures

---

## A08 — Software and Data Integrity

- **Mass assignment prevention**: Destructure only expected fields from `req.body` — never `Model.create(req.body)` (attacker can set `role: 'admin'`)
- **Mongoose schemas**: Use `enum` for fixed values, `required` on mandatory fields, `minlength`/`maxlength`, `strict: true` (default)
- **File upload integrity**: MIME type allowlist, check magic bytes for high-security. MIME types can be spoofed
- **CSP**: Restrict `script-src`, `frame-ancestors 'none'`, `object-src 'none'`

---

## A09 — Logging and Alerting

**Log these**: Login success/failure, token rejection, admin actions, file uploads, rate limit hits, 5xx errors, 403 denials
**Never log**: Passwords, JWT tokens, API keys, credit cards, SSNs

- Redact sensitive fields (`password`, `token`, `secret`, `authorization`) before logging — replace with `***`
- Use structured JSON logging for production (searchable, integrates with aggregation)
- Log auth events with userId, IP, timestamp, and action

---

## A10 — Exceptional Conditions

- **Fail-closed**: Errors must deny access, not grant it. `catch` blocks must `return` error response before any `next()` call
- **Global error handler**: Must have 4 params `(err, req, res, next)`. Return generic message in production.
- **Async wrapper**: Use `asyncHandler` to catch Promise rejections — eliminates need for try-catch in every controller
- **DB connection**: `serverSelectionTimeoutMS: 5000`, `process.exit(1)` on connection failure
- **404 handler**: Catch-all for unmatched routes (`app.use('*', ...)`)

---

## File Upload Security

- **MIME allowlist**: `['image/jpeg', 'image/png', 'image/gif', 'image/webp']` — whitelist, not blacklist
- **Size limit**: `5 * 1024 * 1024` (5MB) via `multer.limits`
- **Filename**: Server-generated (`blog-{timestamp}-{random9digits}.{ext}`) — never user-provided
- **Path traversal**: Use `path.basename()` to strip directory components. Validate `path.resolve()` starts with upload directory before deletion
- **Cleanup**: Delete uploaded file when resource is deleted, validate path is within uploads dir
- **Serving**: `crossOriginResourcePolicy: 'cross-origin'` for static files, no directory listing

---

## Secret Detection

Scan for these patterns in all code and config:

| Type | Pattern |
|------|---------|
| AWS Key | `AKIA[0-9A-Z]{16}` |
| Google API | `AIza[0-9A-Za-z_-]{35}` |
| JWT/Generic | `(secret\|key\|token\|password)\s*[:=]\s*['"][^'"]{8,}` |
| MongoDB URI | `mongodb(\+srv)?://[^:]+:[^@]+@` |
| Private Key | `-----BEGIN .* PRIVATE KEY-----` |
| GitHub Token | `gh[ps]_[A-Za-z0-9]{36,}` |
| npm Token | `npm_[A-Za-z0-9]{36}` |
| Slack Token | `xox[bpsa]-[0-9a-zA-Z-]+` |

**Never commit**: `.env`, `.env.local`, `.env.production`, `logs/`, `uploads/`

---

## Agentic AI Security (OWASP 2026)

Relevant to AI content generation features (Gemini API):

- **ASI01 Goal Hijacking**: Sanitize prompt input, set max length, strip control characters
- **ASI02 Tool Misuse**: AI should not have access to system tools without explicit scoping
- **ASI03 Identity Abuse**: API keys server-side only, short-lived if possible
- **ASI05 Code Execution**: Never execute AI-generated code without review
- **ASI09 Trust Exploitation**: Label AI-generated content, validate before storing
- Sanitize AI output before storing — it could contain XSS, malicious links, or script tags

---

## Framework Security Quirks

### JavaScript/Node.js
- Prototype pollution via `__proto__`/`constructor.prototype` — validate object keys
- `JSON.parse()` throws on malformed input — always wrap in try-catch
- `RegExp(userInput)` enables ReDoS — escape special characters
- `path.join()` with user input allows traversal — use `path.basename()` first
- `setTimeout(string)` is implicit eval — always pass a function

### MongoDB/Mongoose
- Query operator injection via JSON body `{ password: { "$gt": "" } }` — cast to `String()`
- `$where` clause = server-side JS execution — never use with user input
- Unbounded queries exhaust memory — always `.limit()` and `.skip()`
- `strict: false` accepts arbitrary fields — keep default `strict: true`

### React
- `dangerouslySetInnerHTML` bypasses escaping — require DOMPurify
- `href={userUrl}` allows `javascript:` XSS — validate protocol
- `VITE_*` env vars are public — never prefix secrets

### Express
- Middleware ordering matters — auth bypass if `router.use(auth)` placed after unprotected routes
- `req.query` values are always strings — validate and cast types
- Error handler must have exactly 4 params — missing `next` breaks error handling
- Set `trust proxy` behind reverse proxy — otherwise rate limiter gets wrong IP

---

## Security Review Process

1. **Detect context** — API endpoint, auth logic, DB query, file handling, frontend, config, or dependency change
2. **Load relevant rules** — Only the OWASP categories that apply to this context
3. **Trace data flow** — Where does the input come from? Is it attacker-controlled?
4. **Check upstream controls** — Middleware, framework defaults, validation already applied?
5. **Verify exploitability** — Can an attacker actually reach and control this?
6. **Report HIGH confidence only** — Include file, line, exploit scenario, specific fix

---

## Severity Classification

| Severity | Criteria | Stack Examples |
|----------|----------|----------------|
| **CRITICAL** | Direct exploit, no auth required | NoSQL injection auth bypass, hardcoded prod secrets, missing auth on admin endpoint, RCE |
| **HIGH** | Exploitable with conditions | Stored XSS in blog content, IDOR on delete, JWT with weak secret, passwords in logs |
| **MEDIUM** | Specific conditions, limited impact | Missing rate limiter, CORS misconfiguration, verbose prod errors, missing input validation |
| **LOW** | Defense-in-depth | Low bcrypt cost, missing security event logging, sequential ObjectId exposure |

---

## ASVS 5.0 Quick Reference

**Level 1 (All Apps)**: 12+ char passwords, breached list check, login rate limiting, 128+ bit session entropy, HTTPS, server-side validation, generic error messages

**Level 2 (Sensitive)**: + MFA for sensitive ops, crypto key management, comprehensive security logging, schema-based input validation, CSRF protection

**Level 3 (Critical)**: + HSM key storage, documented threat model, anomaly detection, penetration testing, supply chain verification
