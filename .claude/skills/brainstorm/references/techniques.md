# Comparison techniques

Pick what the decision needs. Do not run all of them on every idea.

## Contents
- Options and do-nothing
- Pros and cons
- Reversibility
- Weighted matrix
- Strongest case against and pre-mortem
- MoSCoW
- Avoiding agreement bias

## Options and do-nothing

Two to four real options. "Do nothing / defer" is always one of them: it exposes
whether the idea is worth its cost at all. Name the decision drivers first
(user value, effort, risk, fit with existing code), then judge options against them.

## Pros and cons

Be concrete: "adds one table and a migration" beats "more complex". Cons must be
as specific as pros. If a side is empty, say what you checked.

## Reversibility

- `two-way`: cheap to undo (a UI tweak, an internal helper). Decide fast.
- `one-way`: costly to undo (public contract, DB schema, data model). Slow down,
  raise the pre-mortem, ask what we lose by waiting.

Applying heavy process to a two-way idea is itself a failure.

## Weighted matrix

Only with 3+ options and 3+ drivers. Weights come from the user, not from you.
Treat it as a discussion aid: scores are guesses, a long list of minor drivers can
outvote a must-have, so check the result against a must-have list first.

## Strongest case against and pre-mortem

For the option the user likes best: the best honest argument against it, then
"it is six months later and this failed; why?" (write 2-3 reasons). Put the
findings in the entry. If you cannot find a real objection, say what you tried.

## MoSCoW

Must / Should / Could / Won't (this time). Give a one-line rationale. MoSCoW does
not rank inside a bucket and "Won't" is ambiguous, so always state deferred or
dropped.

## Avoiding agreement bias

- Do not open with praise.
- Lead with the recommendation and its evidence, not with what the user wants to hear.
- When the user pushes back without new evidence, hold the position and say what
  evidence would change it; when they bring evidence, update openly.
- State confidence; separate what you verified in code or docs from what you infer.
