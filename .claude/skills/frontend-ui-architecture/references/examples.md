# Worked examples

Each example shows the smell, the target shape, and the rule from `SKILL.md`
that decides it. Domain names come from this app (slots, monitoring, locations,
the extension banner); in this project tier 1 is `src/domain/**` and tier 2 is a
use case or adapter behind a port — see `onion-architecture`.

## Contents

1. Logic buried in a component → four tiers
2. A "reusable" util with one consumer
3. Promoting a helper to shared
4. Two features that need each other
5. A god component → split by responsibility
6. `'use client'` on a layout
7. Constants junk drawer

## 1. Logic buried in a component → four tiers

**Before** — the API call, a business rule, formatting and view in one body:

```tsx
export function FreeSlotsPanel({ token, institution }: Props) {
  const [reserved, setReserved] = useState<ReservedSlot[]>([]);
  useEffect(() => {
    fetch("https://my.e-consul.gov.ua/external_reader", { method: "POST", headers: { token }, body: … })
      .then(r => r.json()).then(j => setReserved(j.data.reservedSlots));
  }, [token, institution]);
  const free = computeFree(reserved).filter(s => s.date >= from && s.date <= to);
  return <ul>{free.map(s => <li key={s.key}>{s.date.split("-").reverse().join(".")} {s.time}</li>)}</ul>;
}
```

**After:**

```
src/domain/monitoring/slots-diff.ts      # tier 1 — inDateRange(slot, range)
src/adapters/econsul-api/                # tier 2 — the only caller of external_reader
src/application/monitor.ts               # tier 2/3 — the monitor store
src/features/slots/hooks/useMonitor.ts   # tier 3 — useSyncExternalStore over the store
src/features/slots/components/FreeSlotsPanel/
  FreeSlotsPanel.tsx                     # tier 4 — view
  helpers.ts                             # formatSlotDate (display only)
```

```tsx
// FreeSlotsPanel.tsx
export function FreeSlotsPanel() {
  const { freeSlots, range } = useMonitor();
  const visible = freeSlots.filter(s => inDateRange(s, range));   // derived, not stored
  return <ul>{visible.map(s => <li key={s.key}>{formatSlotDate(s)} {s.time}</li>)}</ul>;
}
```

Rules: section 4 (push logic to tier 1; no `fetch` in components; data has one
source of truth). The token never appears in a component.

## 2. A "reusable" util with one consumer

**Smell:** `src/utils/formatReleaseLine.ts`, imported by the fast-checks hint
only, already grown three optional parameters "for the popup and the log".

**Fix:** move it back into the component's `helpers.ts`, drop the parameters
nobody passes. Principle 2 — duplication is cheaper than the wrong abstraction;
the remedy for a wrong one is to inline it and let the real shared shape emerge.

## 3. Promoting a helper to shared

`formatSlotDate` lives in `features/slots/components/FreeSlotsPanel/helpers.ts`.
The monitoring log (another feature) now needs it too.

1. Move it to a shared, domain-agnostic place: `src/utils/date.ts` if it only
   formats a `YYYY-MM-DD` string, or `src/domain/slots/format.ts` if it knows the
   slot type.
2. Update **every** import site, including the original component.
3. Delete it from the old file. Do not leave
   `export { formatSlotDate } from "…"` behind — a shim hides the new dependency,
   and Next.js dev builds have been seen to fail on exactly this shape.

## 4. Two features that need each other

**Smell:** `features/monitoring/components/StatusLine.tsx` imports
`features/extension/components/ExtensionBadge`.

Options, in order of preference:

1. **Compose at the route.** The page renders
   `<StatusLine badge={<ExtensionBadge … />} />`; neither feature knows the other.
2. **Promote.** If the badge is domain-agnostic enough, move it to `src/components/`.
3. **Extract an entity.** If both features are really about the same data (the
   extension connection state), that state belongs to a lower layer both read —
   here, the monitor snapshot from the application ring.

## 5. A god component → split by responsibility

`SlotsPage.tsx` (the port of `slots.html`) renders the location picker, the token
field, the calendar, the day modal, the booking windows, the monitoring controls,
the log, the schedule-change log and the extension banner, and owns all their state.

- Name each responsibility: location picker (+ selection), calendar (+ visible
  month), day modal (+ open day, driven by `?day=`), booking windows, monitoring
  controls, monitoring log, schedule changes, extension banner.
- Each becomes a component in its feature with **its own state moved into it**.
  State two of them share — the selected institution and service — stays in the
  page view or comes from the monitor store.
- The route `page.tsx` stays a two-liner.

Rule: section 5 — split by job and by who owns which state, not by line count.

## 6. `'use client'` on a layout

**Smell:** `app/layout.tsx` starts with `'use client'` because the extension banner
listens to `postMessage`. Every page under it is now client code.

**Fix:** the layout stays a Server Component; `ExtensionBanner` (or the
`Providers` component that builds the deps) carries the directive and wraps
`{children}`.

## 7. Constants junk drawer

**Smell:** `src/constants.ts`, 300 lines, imported by everything: check-interval
bounds, fast-window offsets, `localStorage` keys, e-Consul URLs, sound
frequencies, message types and UI copy.

**Fix, by kind:**

| Kind | New home |
|---|---|
| fast-window offsets (−2 min … +3 min), default 60–180 s | `src/domain/monitoring/constants.ts` |
| `localStorage` keys | inside `src/adapters/settings-store/` |
| e-Consul base URL, `external_reader` methods | inside `src/adapters/econsul-api/` |
| sound frequencies | inside `src/adapters/alerts/` |
| message `type` strings | `src/domain/contracts/extension-messages.ts` |
| UI copy | i18n catalog / the component that shows it |

Move one kind at a time; delete the drawer when it is empty.
