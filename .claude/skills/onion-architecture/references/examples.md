# Worked examples

Before/after shapes for the moves this rewrite makes most often. Names are
illustrative; the paths follow SKILL §2.

## 1. Porting a function out of `slots.html` into the domain

**Before** (`slots.html`, `buildScheduleDays`): reads module globals
(`getNumberWeeks()`, `getHolidaySet()`, `getServiceScheduleRows()`,
`getConsulateOffset()`), defaults `nowMs` to `Date.now()`.

**After** — every input is an argument, the output is plain data:

```ts
// src/domain/slots/schedule-days.ts
import type { ScheduleRow, InstitutionParams } from "../contracts/econsul";

export interface ScheduleDay {
  dateKey: string;          // YYYY-MM-DD, institution wall-clock date
  consulIpnHash: string;
  startMinutes: number;
  endMinutes: number;
}

export function buildScheduleDays(input: {
  rows: ScheduleRow[];               // already filtered to the chosen service
  institution: InstitutionParams;    // timeZone offset, numberWeeks
  holidays: ReadonlySet<string>;
  nowMs: number;
}): ScheduleDay[] { /* body moved verbatim, globals replaced by input */ }
```

Steps:

1. Move the body unchanged; replace each global with a field of `input`.
2. Write a fixture test: recorded schedule + fixed `nowMs` → the day list. Take
   the expected values from the old page (run it with the same `nowMs`), not
   from the new code.
3. Only then refactor inside the function, keeping the test green.
4. If the behaviour must change, update `docs/booking.md` §6 in the same commit.

## 2. Moving the monitoring loop out of a component

**Smell:** a `useEffect` with `setTimeout` that calls `fetch`, computes free slots,
plays a sound and reschedules itself. It restarts on every re-render that changes
a dependency, double-runs in Strict Mode and cannot be tested without waiting.

**After:**

```
src/domain/monitoring/schedule.ts    nextCheckAt(nowMs, bounds, releases, random) → number   (pure)
src/domain/monitoring/slots-diff.ts  diffNewSlots(previous, current, range) → { fresh, outside } (pure)
src/application/run-check.ts         runCheck(deps, state) → CheckResult                      (one check)
src/application/monitor.ts           createMonitor(deps) → { start, stop, checkNow, subscribe, getSnapshot }
src/features/monitoring/useMonitor.ts  useSyncExternalStore(monitor.subscribe, monitor.getSnapshot)
```

`createMonitor` owns the loop through the `Scheduler` port; the component only
renders the snapshot and calls `start()`/`stop()`. A test drives it with a fake
scheduler and a fake clock: "fast window opens at 09:58 → next check in 15–20 s".

## 3. Adding a port method

The draft hint needs the task's `createdAt` (`GET /tasks/{id}`).

1. **Contract:** `TaskSchema` in `src/domain/contracts/econsul.ts` with only the
   fields we use.
2. **Port:** `getTask(taskId: string): Promise<Task>` on `EconsulApi` in
   `src/application/ports.ts` — no `Response`, no headers in the signature.
3. **Adapter:** `src/adapters/econsul-api/` implements it, parses with
   `TaskSchema`, maps 401/403 to `SessionExpiredError`.
4. **Fake:** add it to the test fake of `EconsulApi`.
5. **Use case** calls `deps.econsul.getTask(...)`; the UI never sees the HTTP call.

In this app the extension already reads drafts from the site's own tab, so first
ask whether the app needs this call at all (`extension/plans/extension-plan.md` §4).

## 4. Typing the extension protocol

**Before:** `window.addEventListener('message', e => { if (e.data.type === 'ext:token') token = e.data.token; ... })`
— any script on the page can post `ext:token`.

**After:**

```ts
// src/domain/contracts/extension-messages.ts
export const ExtMessage = z.discriminatedUnion("type", [
  z.object({ source: z.literal("econsul-ext"), type: z.literal("ext:hello"), version: z.string() }),
  z.object({ source: z.literal("econsul-ext"), type: z.literal("ext:token"), token: z.string(), exp: z.number() }),
  // ... one entry per row of extension-plan.md §8
]);
export type ExtMessage = z.infer<typeof ExtMessage>;
```

The `extension-bridge` adapter checks `event.source === window` and
`event.origin === window.location.origin`, `safeParse`s with `ExtMessage`, drops
anything that fails, and hands typed messages to the use case. A new message type
is added to the union and to the table in `extension/plans/extension-plan.md` §8 in one commit.

## 5. Session expiry, end to end

| Ring | Responsibility |
|---|---|
| adapter `econsul-api` | HTTP 401/403 → `throw new SessionExpiredError()` |
| application `run-check` | catches it, stops the monitor with `stoppedBy: 'session'`, calls `alerts.sessionExpired()`, sends `app:auth-failed` |
| application `monitor` | on `ext:token` while `stoppedBy === 'session'` → start again, log `Resumed after login`; stopped by the user → stay stopped |
| presentation | shows the red banner and the "Увійти" link from the snapshot |

Nobody outside the adapter knows the status codes; nobody outside the use case
knows the resume rule.
