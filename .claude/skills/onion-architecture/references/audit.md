# Module audit — order of checks

Use when reviewing a module or a change for structure. Go file by file, and in
each file run the passes in this order. The order matters: the earlier passes find
the problems that make the later ones unfixable (a use case that builds its own
adapter cannot be given a fake, so there is no point asking about its tests).

1. **Imports** — what does this file name?
2. **Construction** — who builds the things it uses?
3. **Ports** — does every outside call go through a port that really has that method?
4. **Time and randomness** — where do `now` and random intervals come from?
5. **Token and messages** — where does the session token travel, and who is trusted?
6. **Effects** — what happens when one step in the middle fails?
7. **Output** — what leaves the module: contract types or loose objects?

## 1. Imports

Compare each import with the ring table in SKILL §2. Type-only imports count.
A `src/domain/**` file that imports React, an adapter or anything from `src/app`
is a finding even if it only uses a type.

## 2. Construction

`new` of an adapter, `new Audio`, `new Notification` or a `fetch` wrapper inside a
use case or a component is a finding. So is a use case that takes the whole deps
bag instead of the few ports it uses. Construction belongs to `src/app/providers.tsx`.

## 3. Ports — the method must exist

A use case may only call a method that is declared on the port it depends on
(`src/application/ports.ts`). If the code calls `econsul.getTask(...)` and
`EconsulApi` has no such method, the code leans on a concrete adapter even when
none is imported (it got it from a cast or a wider type). Check by reading the
port, not the call site.

The fix is three edits in this order: add the method to the port (use-case
shaped, no `Response` or `fetch` types in the signature) → implement it in the
adapter → add it to the fake used by tests.

## 4. Time and randomness

`Date.now()`, `new Date()` without an argument, `performance.now()` or
`Math.random()` anywhere in `src/domain/**` or `src/application/**` is a finding:
it makes the horizon rule, release times and check intervals untestable. The
value comes from the `Clock` / `Random` port (application) or an argument
(domain). Display-only formatting in components is exempt.

## 5. Token and messages

- The JWT goes from the extension (or the input field) into memory and from there
  only into the `token` header of requests to `https://my.e-consul.gov.ua`. Any
  other destination — our server, a log line, the schedule log, a URL, an error
  message, `localStorage` of the app — is a blocker.
- Every `message` listener checks `event.source === window`, `event.origin`, the
  `source` field, and parses with the contract. A listener that trusts `event.data`
  as-is is a blocker.
- Anything that can make the extension press «Підтвердити» (auto-booking) needs an
  explicit user setting on the path; a code path that books without it is a blocker.

## 6. Effects

When a use case does *act → outside call → act*, decide per step which state is
safe to leave behind if the middle fails. Typical cases here: an alert must play
even if the schedule-log write or the extension bridge fails; "new slots" are
compared with the previous *successful* check, so a failed check must not reset the
baseline and re-alert everything; monitoring stopped by the user must not resume on
a fresh token.

## 7. Output

What leaves the domain or a use case is a contract type or a plain serialisable
object with a declared type. A component that receives the raw API response and
digs into `data.data[0].data.receptionCitizensTime` is a finding: map in the
adapter, compute in the domain.

## Reporting

Report findings as `file:line — what — rule`, grouped by the pass above, and say
which are blockers (wrong slots, a lost alert, a token leak, booking without
consent) and which are structure only. End with the ordered fix plan, each step
leaving the app working.
