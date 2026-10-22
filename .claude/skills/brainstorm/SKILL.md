---
name: brainstorm
description: "Compares ideas for the e-Consul slot monitor (the web-app rewrite, its stack, design, which features to keep or remove, extension behaviour) and records the outcome in one persistent draft file, docs/brainstorm/ideas.md, so work continues across many chats. Gives options with pros and cons (always including do-nothing), checks every idea for conflicts, overlaps and dependencies against ideas already recorded, argues against the user's favourite, and logs decisions with a status lifecycle. Use whenever the user brainstorms, weighs approaches, asks 'should we', 'what if we', 'pros and cons', 'compare', 'чи варто', 'що краще', 'давай подумаємо', wants to record, check or revisit an idea, or says 'continue brainstorming' / 'продовжимо брейншторм'. Not for writing plans or code (docs/plans/ is written as a separate step) and not for what was learned (engineering-insights)."
---

# Brainstorm

Turns loose ideas into comparable, recorded options. One draft file carries them
across chats: `docs/brainstorm/ideas.md`. It is a **draft**, never a source of
truth. Canonical descriptions live in `docs/booking.md` (how the site and the app
work), `docs/plans/` (agreed cross-module plans) and each module's `docs/` and
`plans/`.

## Hard rules

- The file is a draft. Never cite it as a requirement, never copy its content into
  a `plans/` or `docs/` folder on your own. When an idea is ready, offer a
  plan as a separate step and wait for the user.
- Never write to any `INSIGHTS.md`. That belongs to `engineering-insights`.
- Read `docs/brainstorm/ideas.md` before comparing anything. No file read, no
  comparison.
- Write to the file only in `record` mode, after the user confirms the outcome.
- IDs come from `next_id` in the file header, are allocated once, and are never
  reused. Do not renumber.
- File prose is Ukrainian, like the rest of `docs/`. Keep in English: IDs
  (`IDEA-007`), statuses, priorities, reversibility tags, field names (`Status`,
  `Depends on`, ...), code, paths and API names — the validator reads them.
- Do not agree to please. A recommendation needs evidence; say how confident it is.
- Nothing here may lead to a real booking or a queue entry on e-consul.gov.ua as a
  way of "checking an idea". Exploration of the live site follows
  `extension/plans/extension-plan.md` §12.

## Modes

| Mode | Trigger | Outcome |
|---|---|---|
| `start` | first brainstorm message in a chat | read banner, header, Current focus and Index only; one-line recap |
| `compare` | a new or changed idea | options, pros/cons, consistency check, recommendation. File untouched |
| `record` | user confirms a decision | file updated, changelog entry, validator run |
| `review` | user asks to prune or audit | stale items flagged, closed items archived |

If `docs/brainstorm/ideas.md` does not exist, create it from
[templates/ideas.md](templates/ideas.md) in `record` mode, not before.

## Mode: start

1. Read `docs/brainstorm/ideas.md` down to the end of the Index; open full entries
   only when needed. If it does not exist yet, say so in one line.
2. Recap **in chat, in the user's language**: how many ideas per status, what
   Current focus says, open questions.
3. Ask what to explore, or continue from Current focus.

## Mode: compare

Copy this checklist and work through it:

```
Compare:
- [ ] 1. Read ideas.md, then search what already exists (order below)
- [ ] 2. Frame: problem, drivers, assumptions, open questions
- [ ] 3. Options (2-4) including "do nothing / defer"
- [ ] 4. Pros and cons per option, reversibility tag
- [ ] 5. Consistency check against recorded ideas
- [ ] 6. Strongest case against the favourite
- [ ] 7. Recommendation with confidence
```

**1. Search order.** Look in this order and stop when you have enough to compare:

1. `INSIGHTS.md` (root) and the touched module's `INSIGHTS.md`
   (`extension/INSIGHTS.md`) — traps already paid for;
2. `docs/plans/` (cross-module) and the module's `plans/`
   (`extension/plans/extension-plan.md`) — what is agreed and what is left;
3. `docs/booking.md` (the site, the API, the algorithm, the app's features) and
   the module's `docs/` (`extension/docs/how-it-works.md`, `extension/docs/design/`);
4. the code: `web/`, `server/`, `extension/`, `server/data/locations.json`.

Curated sources come first because they may already answer the question; the
code settles what they leave open. Keep the search proportional: this is a
brainstorm, not an audit. In the framing, state in a line or two what already
exists (`file:line` or doc section) that overlaps or constrains the idea, or that
you found nothing. Never invent a match. A raw idea with no repo footprint needs
no search.

Constraints that bind every option in this project — name the one that applies
instead of rediscovering it:

- e-Consul requests work only from a browser (Cloudflare) and need the user's
  token; a server-side fetcher is not an option (`docs/booking.md` §1, §14).
- The free-slot algorithm must stay identical to the site's (§6–7, §11).
- The extension, not the app, acts on the site; booking only with the explicit
  auto-booking setting.
- It is a single-user local tool (`localhost:3000`): no accounts, no hosting
  unless an idea is explicitly about that.

**3-4.** Each option gets pros, cons and a reversibility tag: `two-way` (cheap to
undo) or `one-way` (costly to undo). Give one-way options more scrutiny; keep
two-way ones fast. A weighted matrix only with 3+ options, labelled a discussion
aid, weights confirmed by the user. Techniques:
[references/techniques.md](references/techniques.md).

**5. Consistency check.** Always output this block, every field filled, even
`none found`:

```
Consistency check vs ideas.md
- Conflicts:   IDEA-004 (reason) | none found
- Overlaps:    IDEA-011 (what is shared) | none found
- Depends on:  IDEA-002 | none found
- Supersedes:  IDEA-006 | none found
```

Silence on a field is a defect. What exists in the repo is covered by the search
in step 1, not by an extra field.

**6.** Write the strongest honest argument against the option the user prefers,
and a one-line pre-mortem: "через пів року це не спрацювало, бо...".

**7.** Recommend one option, give confidence (low/medium/high) and what would
change your mind. Then stop and wait for the user.

## Mode: record

1. Confirm what is being recorded: new idea, status change or a decision.
2. Re-read the file (it may have changed since `start`).
3. Allocate the ID from `next_id` and bump it. Fill the entry from the template.
4. Update Index and Current focus. Add a dated changelog line (append-only).
5. Run `bash .claude/skills/brainstorm/scripts/validate.sh` and fix what it reports.
6. Report in two lines what was written.

Rejected ideas stay with a reason, so they are not proposed again. A real
reversal is a new entry that supersedes the old one; the old body is never
rewritten, only given a dated note and the status `superseded-by-IDEA-NNN`.
`promoted` means the idea became a real plan — in `<module>/plans/`, or in
`docs/plans/` when it spans modules: record the link,
and from then on that document is the source of truth.

Decisions that change how the code is organised (stack, root folder, layout) are
also what `onion-architecture` §2 and `frontend-ui-architecture` §0 depend on:
when such an idea is promoted, say that those two skills need the paths updated.

## Mode: review

Only on request. Flag items whose `last_reviewed` is older than 60 days, move
`rejected`, `superseded` and `promoted` entries to `docs/brainstorm/archive.md`
(keeping their Index line), and report the active size. Keep the active part under
about 200 lines.

## Statuses

`proposed` -> `exploring` -> `rejected` | `deferred` | `superseded-by-IDEA-NNN` |
`promoted`. Priority (optional): MoSCoW. "Won't" must say whether it is deferred
or dropped.

## Session end

Update Current focus (in progress, open questions, next steps) so the next chat
can resume cold. Do not capture insights here; that is `engineering-insights`'s
job at task end.
