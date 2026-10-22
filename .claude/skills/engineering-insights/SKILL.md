---
name: engineering-insights
description: "Reads and maintains this repo's insights files — <module>/docs/insights.md per module (extension/docs/insights.md, web/docs/insights.md, server/docs/insights.md) and docs/insights.md for cross-module findings — non-obvious behaviour of e-consul.gov.ua, Chrome, the extension, the web app, the server and the tools. Use at the start of any task that touches the web app (web/), extension/, server/ or testing in Chrome — read the module's file and the root one before answering — and again when a task ends, to add non-obvious findings (traps, dead ends, site quirks, tool quirks) as dated entries. Also use when the user mentions insights, інсайти, learnings, wrap-up or retrospective, asks what was learned, or asks to prune the file."
---

# Engineering Insights

What one session learns is lost unless the next session reads it. This skill owns
both halves of that loop: read the insights files before working, add to them after.

## Modes

| Mode | Trigger | Outcome |
|---|---|---|
| `read` | first step of any task on this repo | the relevant sections are read and summarized before any code is read |
| `capture` | a task or session ends | qualifying findings are added; nothing is written when nothing qualifies |
| `review` | the user asks to prune, merge or audit entries | duplicates merged, stale entries superseded |

`capture` covers the current task by default. Widen it to the whole session only
when the user asks for a session wrap-up or a retrospective.

## The files

Every module keeps its own file at `<module>/docs/insights.md`; the root
`docs/insights.md` holds what concerns several modules. All are in Ukrainian like the rest of the
docs. Each is split into `##` sections by area; each entry is a `###` heading with
the date in parentheses, followed by short prose, bullets or a table.

| Work touched | File → section |
|---|---|
| `extension/**`, behaviour of e-consul.gov.ua pages under the extension | `extension/docs/insights.md` → `## Розширення Chrome` |
| testing the extension (puppeteer, stubs, ports) | `extension/docs/insights.md` → `## Тестування` |
| the web app (`web/**`), UI, monitoring | `web/docs/insights.md` (create it with the first entry) |
| `server/**`: Fastify, Drizzle, Postgres, the request log | `server/docs/insights.md` (create it with the module) |
| e-Consul API responses, the slot algorithm, time zones, day releases | `docs/insights.md` → `## Сайт і API e-Consul` (create on first entry) |
| the app ↔ extension protocol, app ↔ server contracts | `docs/insights.md` → `## Між модулями` (create on first entry) |
| Claude in Chrome, tools used across modules | `docs/insights.md` → `## Тестування` / `## Інструменти` |

A new file starts with a `#` title, one paragraph saying what belongs there and a
link back to `docs/insights.md`. A new section is added only when no existing one
fits; never rename or remove one. An entry goes into exactly one file — never
paste it twice; when it spans modules, it goes to the root file.

## Mode: read

1. Pick the module(s) the request touches, using the table above.
2. Read that module's `docs/insights.md` and the root `docs/insights.md` in full
   (they are small).
3. State in one line what was read and which entries bear on this task — or that
   none do.

Do this before reading code and before answering. The one-line confirmation is
not a courtesy: it forces the file to be processed rather than skimmed, and it
shows the user the loop is actually running.

## Mode: capture

Copy this checklist and work through it:

```
Capture:
- [ ] 1. List candidates
- [ ] 2. Drop anything unverified
- [ ] 3. Run each candidate through the quality gate
- [ ] 4. Re-read the target file
- [ ] 5. Add survivors, or state that nothing qualified
```

**1. List candidates.** What cost time, what behaved differently than expected,
what decision was made and why.

**2. Drop anything unverified.** A fix no test or run has confirmed is a guess.
Guesses do not go in the file. A behaviour of the live site seen once is written
with «спостерігалось один раз» and how to re-check it.

**3. Quality gate.** An entry is written only if every line below is true:

- Actionable cold: an agent reading it knows what to do without re-investigating.
- Backed by evidence: `file.js:42`, a command, the literal error or console text,
  or the site step where it was seen.
- Transferable: a rule that fires again, not the story of one fix.
- Specific to this repo, this site or this machine, not general knowledge about
  the language or browser.
- Not obvious: if anyone reading the code would see it, do not write it.
- Not already stated in `docs/booking.md`, a `CLAUDE.md`, `README.md`, or a
  module's `docs/` and `plans/` — those are the canonical descriptions; a copy here
  is noise. A finding that changes how something *works* belongs in that module's
  `docs/` (or `docs/booking.md` for the site and API), with at most a one-line
  pointer here.
- Free of secrets: no JWT, no task IDs tied to a person, no personal data from
  the user's application. This file is committed.

**4. Re-read the target file.** If the insight is already there, write nothing
and say so. If an existing entry is now wrong, add a dated note to it
(«Оновлено YYYY-MM-DD: …») or a new entry that names the one it supersedes; do not
silently rewrite history.

**5. Add.** Newest entry at the top of its section. When nothing survives the
gate, write nothing and say so in one line. Running the capture step is not
optional; writing an entry is.

## Mode: review

Only on explicit request. Merge duplicate entries into one, mark superseded
entries, and trim a file that has grown past roughly 30 entries. Report what
changed. Section headings stay intact.

## Entry format

```markdown
### Коротко, що саме неочевидне (YYYY-MM-DD)

Що відбувається і за яких умов — одне-два речення з доказом (`econsul.js:120`,
текст помилки, крок сайту).

Правило: що робити (ЗАВЖДИ / НІКОЛИ ...).
```

- The heading states the trap, not the task («`hidden` не ховає елемент із власним
  `display`», not «Виправлення банера»).
- One insight per entry. Several related bullets are fine when they share one
  cause (see «Календар кроку 4 і кліки зі скрипта»).
- A closing «Що зроблено:» line is welcome when the code now guards against the
  trap, so nobody removes the guard.

## Reliability

A skill runs when the model judges it relevant; only a lifecycle hook runs because
an event happened. That is why the read step is also written into the root and
module `CLAUDE.md` files instead of living here alone.

## Examples

Good and bad entries and a supersede example: see [examples.md](examples.md).
