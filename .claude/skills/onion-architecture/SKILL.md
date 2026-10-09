---
name: onion-architecture
description: "Onion (clean / hexagonal, ports-and-adapters) architecture for the e-Consul slot monitor web app: which ring a piece of code belongs to, which way imports may point, where the slot algorithm, monitoring rules, e-Consul API calls, extension messaging, notifications, storage and the schedule log live, how time, randomness and the session token are handled, and how errors cross the rings. Use when porting logic out of slots.html, adding or restructuring a use case, port or adapter; when a component or hook calls fetch, Date.now(), Math.random(), localStorage, Notification or window.postMessage directly; when deciding where a function belongs; when reviewing a change for structure; or when the user mentions onion, clean or hexagonal architecture, layers, ports and adapters, dependency rule, use cases or domain logic — even if they never say 'architecture'. Not for React/Next.js API details or folder layout of the UI (react-best-practices, next-best-practices, frontend-ui-architecture cover those)."
metadata:
  version: 1.0.0
---

# Onion Architecture (e-Consul slot monitor)

One rule drives this skill: **source-code dependencies point inwards only.**
The slot algorithm and the monitoring rules sit in the middle and know nothing
about React, Next.js, `fetch`, the browser, the Chrome extension or the clock.
Those are outer rings that plug in.

## 0. Read the existing convention first

1. `CLAUDE.md` at the repo root — what the app is, how it runs.
2. `docs/booking.md` — **the specification of the domain**: how the site builds
   calendar days (§6), how its web worker decides a slot is free (§7), why the old
   version showed phantom slots (§8), monitoring and day releases (§9), booking
   (§14). Domain code must match it; a change in behaviour is a change to that doc.
3. `docs/plans/extension-plan.md` §8 — the message protocol between the app and
   the extension. It is a contract, not an implementation detail.
4. `docs/insights.md` — known traps (React re-rendering the site, `chrome.storage.session`
   cleared on reload, the token appearing seconds after load).
5. `docs/brainstorm/ideas.md` — the decision log for the rewrite (stack, layout).
   If it settled something this file contradicts, the recorded decision wins and
   this file is out of date: say so.

## 1. When the full onion pays off — and when it does not

Palermo is explicit that the onion is for long-lived applications with real
behaviour; Seemann (*Ports and fat adapters*) warns that a use-case layer that only
forwards calls costs more than it returns. In this app:

- **Always:** the dependency direction (section 3) and "no clock, no randomness,
  no I/O in the domain" (section 5). They are free and they are what makes the
  slot algorithm testable against recorded responses.
- **Full rings** (pure domain + use case + ports): free-slot calculation, calendar
  days and the horizon rule, day-release times and fast-check windows, the
  monitoring loop (check → diff → alert → schedule next), session-expiry handling,
  handing found slots to the extension.
- **Thin** (UI + one adapter, no use case): the country/institution/service
  picker reading `locations.json`, remembered form values, the date-range inputs,
  test-sound buttons. Do not invent a service that only forwards to storage.

Signals that a piece of UI logic must move inwards: it reads the clock; it is
duplicated in two components; it branches on schedule/slot data; a test needs a
DOM or a browser only to check a calculation.

## 2. The rings in this app

> Target layout for the rewrite (proposed 2026-10-09). Paths assume the
> Next.js + TypeScript app agreed in brainstorm; if `docs/brainstorm/ideas.md`
> records a different stack or root, map the rings onto it — the rings and the
> rules do not change.

```
composition root   src/app/providers.tsx (client deps) · src/app/api/**/route.ts (server deps)
 └─ presentation   src/app/** pages · src/features/** components and hooks
     └─ application   src/application/** use cases · ports.ts
         └─ domain        src/domain/{slots,monitoring,locations}/** pure functions
             └─ core          src/domain/contracts/** zod schemas + types + domain errors

infrastructure     src/adapters/** (browser) · src/server/** (server-only)
                   └─ implement the ports; wired in by the composition root
extension/         separate entry point (MV3); may import src/domain/contracts only
```

| Ring | Paths | Knows | Must not import |
|---|---|---|---|
| **Contracts** (core) | `src/domain/contracts/` — e-Consul response schemas (schedule row, reserved slot, `nonWorkingTime`), `locations.json` schema, extension message protocol (`ext:*`, `app:*`), domain errors | zod, itself | anything else |
| **Domain** | `src/domain/slots/` (calendar days, horizon, free slots, windows), `src/domain/monitoring/` (release times, fast window, next-check delay, new-slot diff, date-range filter), `src/domain/locations/` | contracts | React, Next, `fetch`, `window`, `chrome.*`, `localStorage`, `Date.now()`, `new Date()` without an argument, `Math.random()`, adapters |
| **Application** | `src/application/<use-case>.ts`, `src/application/ports.ts` | domain, contracts, ports | React, Next, `src/adapters/**`, `src/server/**`, browser globals |
| **Presentation** | `src/app/**` (pages, layouts), `src/features/**` (components, hooks) | application, domain (read-only helpers for display), contracts | `src/adapters/**` directly, `src/server/**` from client code, `fetch` to e-Consul |
| **Infrastructure** | `src/adapters/econsul-api`, `extension-bridge`, `alerts` (Notification + Web Audio), `settings-store` (localStorage), `schedule-log` (HTTP client); `src/server/schedule-log-file.ts` | contracts, ports, browser/Node APIs | application use cases, presentation, other adapters |
| **Composition root** | `src/app/providers.tsx`, `src/app/api/**/route.ts` | everything | — (this is where rings are wired) |

Three facts about this app that change the textbook picture:

- **e-Consul is called from the browser, never from our server.** Cloudflare blocks
  requests made outside a browser, and the user's JWT must not reach our server
  (`docs/booking.md` §1, §14). So the `EconsulApi` adapter is client-only, and the
  Next.js server never proxies it. A server route that calls `my.e-consul.gov.ua`
  is a design error, not a shortcut.
- **The domain replicates someone else's algorithm.** The rules in `domain/slots`
  are not ours to improve; they mirror the site's worker. Every change is checked
  against recorded responses (section 8) and documented in `docs/booking.md`.
- **The extension is a second client of the contracts.** The message protocol lives
  in `domain/contracts/extension-messages.ts`; the app's `extension-bridge` adapter
  and the extension both conform to it. The extension never imports app code beyond
  contracts.

## 3. The dependency rule, concretely

Palermo's first tenet: *all code can depend on layers more central, but code
cannot depend on layers further out from the core.* Uncle Bob's version: a name
declared in an outer circle must not be mentioned by code in an inner circle —
**type-only imports count**.

Allowed direction: `features → application → (domain, ports)` and
`adapters → ports, contracts`. The composition root is the only file that sees
both a use case and the concrete adapter that satisfies its port.

- A feature never imports another feature (see `frontend-ui-architecture`).
- An adapter never imports another adapter; if two need the same helper, it is
  either domain (pure) or a shared infrastructure util under `src/adapters/_shared/`.
- `extension/` never imports `src/` outside `src/domain/contracts/`.
- `src/server/**` starts with `import 'server-only'` and is never reachable from a
  `'use client'` module.

## 4. Where does X go?

| Code (today in `slots.html`) | Home | Ring |
|---|---|---|
| Shape of `public-calendar-get-actual-consuls-schedule` / `public-get-consuls-reserved-slots` responses | `domain/contracts/econsul.ts` (zod) | contracts |
| `locations.json` shape, service durations, holidays | `domain/contracts/locations.ts` | contracts |
| `ext:*` / `app:*` messages | `domain/contracts/extension-messages.ts` (discriminated union) | contracts |
| `buildScheduleDays`, horizon rule, holidays, `ukrainianDayMap` | `domain/slots/schedule-days.ts` | domain |
| `calculateBookableWindows` (free slots + merged windows) | `domain/slots/free-slots.ts` | domain |
| ISO parsing, wall-clock minutes, `addDays`, offsets | `domain/slots/time.ts` | domain |
| `getUpcomingReleases`, `getFastWindow`, next-check delay | `domain/monitoring/schedule.ts` | domain |
| New-slot diff, date-range filter, "N outside the range" | `domain/monitoring/slots-diff.ts` | domain |
| Schedule-change detection for the log | `domain/monitoring/schedule-changes.ts` | domain |
| One monitoring check: fetch → compute → diff → alert → log → schedule | `application/run-check.ts` | application |
| Start/stop/resume-after-login, timers | `application/monitor.ts` (owns the timer through the `Scheduler` port) | application |
| `callExternalReader`, 401/403 → `SessionExpiredError` | `adapters/econsul-api/` | infrastructure |
| `window.postMessage` bridge, origin and `source` checks | `adapters/extension-bridge/` | infrastructure |
| `new Notification`, Web Audio tones, glass crash | `adapters/alerts/` | infrastructure |
| `localStorage` keys (`slots.selection`, `slots.interval`, draft, date range) | `adapters/settings-store/` | infrastructure |
| Writing `logs/schedule-changes.jsonl` | `src/server/schedule-log-file.ts` behind `app/api/schedule-log/route.ts` | infrastructure + composition root |
| Building the deps object, picking fakes for tests | `src/app/providers.tsx` | composition root |
| Calendar grid, day modal, monitoring log view | `features/<feature>/components/` | presentation |

## 5. Ring by ring

### Contracts

- Parse every e-Consul response with its zod schema **once, in the adapter**
  ("parse, don't validate"). Inner code receives parsed types and never re-checks.
  The API is not ours and changes without notice; a schema failure must surface as
  a clear error, not as `undefined` deep in the calendar.
- The message protocol is a discriminated union on `type`. Both sides parse
  incoming messages with it; unknown types are ignored, never `eval`-ed or trusted.
- Domain errors are plain classes here (`SessionExpiredError`,
  `EconsulUnavailableError`, `EconsulSchemaError`). No HTTP or React in them.

### Domain — pure functions

- Plain TypeScript over contract types. **Time comes in as an argument**
  (`nowMs`), as `buildScheduleDays(nowMs)` already does in `slots.html`.
  Randomness comes in as a number or a `() => number`. No I/O, no globals.
- Times follow `docs/booking.md` §7: reception hours are wall-clock time in the
  institution's `timeZone`; blocks compare as the wall-clock minutes written in
  the ISO strings. Do not "fix" this with `Date` arithmetic in the user's time zone.
- Keep domain output serialisable (plain objects, arrays, strings): it crosses
  into React state, `postMessage` and the schedule log.
- An anemic model is fine — this code is functional-style. What must not happen is
  the rule leaking into components, hooks or adapters.

### Application — use cases

A use case: read through ports → call pure functions to decide → act through
ports → return a result the UI can render. Keep effects at the edges (Seemann's
*impureim sandwich*): the middle is a plain function you can unit-test.

- Take a narrow `Deps` object with exactly the ports it uses
  (`{ econsul, alerts, extension, scheduleLog, clock, random, scheduler }`), never
  the whole deps bag.
- Never `new` an adapter inside a use case; construction belongs to the
  composition root.
- **Timers are a port.** `setTimeout`/`setInterval` live behind `Scheduler` so a test
  can advance time without waiting. The domain says *when* the next check is;
  the use case asks the scheduler to run it.
- Decisions on errors live here: `SessionExpiredError` → stop monitoring, alert,
  tell the extension (`app:auth-failed`), wait for `ext:token` to resume;
  `EconsulUnavailableError` / network → log and keep monitoring.
- The monitor exposes state through a subscribe/getSnapshot store so React reads it
  with `useSyncExternalStore`; the loop never lives inside a `useEffect`.

### Presentation — pages, features, hooks

- Components render state and call use-case methods. No `fetch`, no
  `localStorage`, no `Notification`, no `postMessage`, no `Date.now()` for anything
  but display.
- A hook may adapt a use case to React (`useMonitor()`), it may not contain the
  monitoring rules.
- Formatting for display (`formatDateLong`, `formatTimeShort`) is presentation; it
  may use `Intl`, it may not decide which slots are free.

### Infrastructure — adapters

- Each adapter implements one port from `application/ports.ts` and may use any
  browser or Node API. It must not import use cases, components or other adapters.
- `econsul-api`: sends `token` only to `https://my.e-consul.gov.ua`; maps 401/403 to
  `SessionExpiredError`, other HTTP/network failures to `EconsulUnavailableError`,
  schema failures to `EconsulSchemaError`. Never logs or stores the token.
- `extension-bridge`: `postMessage` with `window.location.origin` as target and
  `source: 'econsul-app'`; accepts only messages from the same window, same origin,
  `source: 'econsul-ext'`, parsed by the contract.
- `settings-store`: every `localStorage` access in try/catch; a missing or broken
  value returns defaults.

### Composition root

`src/app/providers.tsx` builds the deps once (lazily, client-side), and provides
them through context. Tests and Storybook pass fakes through the same props.
Server route handlers build their own server-only deps. If a new port needs
wiring, it is added here and nowhere else.

## 6. Ordering of effects

The app never books through the API; the extension clicks in the site's own UI
(`docs/booking.md` §14, `extension-plan.md`). Still, a use case that does
*act → outside call → act* must leave a true state when the middle fails:

- Mark found slots as "sent to extension" only after `ext:slots-received`.
- A schedule-log write that fails must not stop the check; it is logged and retried
  with the next change, not silently dropped.
- Alert first, then side work: a failing log write or bridge must never swallow a
  "new slots" alert.

## 7. Errors

Domain errors are thrown by adapters and inner rings; the application ring decides
what they mean for monitoring; the presentation ring decides how they look. Never
branch on `error.message` text or on HTTP status outside the `econsul-api` adapter.

## 8. Testing by ring

| Ring | Test | Needs |
|---|---|---|
| Domain | unit tests with recorded responses (`slots.json`, `slots_not_working.json`, `locations.json`, move them to `src/domain/__fixtures__/`) and a fixed `nowMs` | nothing — no DOM, no network |
| Application | unit tests with fake ports and a fake `Scheduler`/`Clock` | nothing |
| Infrastructure | adapter tests with a stubbed `fetch` / `window` | jsdom at most |
| Presentation | React Testing Library over a fake monitor store | jsdom |
| End to end | real Chrome + extension, as in `docs/insights.md` → «Тестування» | a live session; **never book** |

**Port check for the algorithm.** While `slots.html` still exists, a domain change
to `slots/` or `monitoring/` is accepted only if, for the same fixtures and `nowMs`,
it returns the same free slots as the old page, and `docs/booking.md` §11 still
holds. If testing a rule forces you to open a browser, the rule is in the wrong ring.

## 9. Enforcement

When the app is scaffolded, encode sections 2–3 as `dependency-cruiser` rules
(`pnpm arch:check`) — see `references/enforcement.md` for the rule set. Until then,
the checklist below is the enforcement. Never add a known-violations baseline entry
to make a new violation pass.

## 10. Structural review checklist

- [ ] Nothing in `src/domain/**` reads the clock, randomness, storage, network or a browser global.
- [ ] No component or hook calls `fetch`, `localStorage`, `Notification`, `postMessage` or Web Audio.
- [ ] e-Consul is called only from `adapters/econsul-api`, only from the browser; the token never reaches `src/server/**`, a log or a URL.
- [ ] Every e-Consul response and every extension message is parsed by its contract schema at the adapter.
- [ ] Use cases take narrow `Deps`; nothing is `new`-ed inside them; timers go through `Scheduler`.
- [ ] Slot-algorithm changes come with fixture tests and a matching update to `docs/booking.md`.
- [ ] Extension message changes update `domain/contracts/extension-messages.ts` and `docs/plans/extension-plan.md` §8 together.
- [ ] No adapter imports another adapter; no feature imports another feature.
- [ ] A failing side effect (log, bridge) cannot suppress a "new slots" or "session expired" alert.

## 11. How to answer

- **"Review this module / change"** — read `references/audit.md` and go through
  its passes in order.
- **"Where does this go?"** — name the ring and the path from section 4, and the
  rule from section 3 that decides it.
- **"Port X from slots.html"** — list the files per ring (contract, pure function +
  fixture test, port + adapter if I/O, use-case step, UI), in that order; the
  domain function lands first, with the port check from section 8.
  `references/examples.md` has worked cases.
- **"Add feature X"** — same order; say which ports it needs and whether an
  existing one covers it.

## Reference files

| File | Read when |
|---|---|
| `references/audit.md` | reviewing a module or change for structure |
| `references/examples.md` | porting a function out of `slots.html`, moving logic out of a component, adding a port |
| `references/enforcement.md` | setting up or changing `arch:check`, or it fails |

## Scope

Defer to other skills instead of restating them:

- folder layout of the UI, feature boundaries, `'use client'` placement → `frontend-ui-architecture`
- component and hook correctness → `react-best-practices`; Next.js APIs → `next-best-practices`
- schema authoring → `zod`; type-level tricks → `typescript-expert`
- token handling, `postMessage` and extension permissions → `security`
