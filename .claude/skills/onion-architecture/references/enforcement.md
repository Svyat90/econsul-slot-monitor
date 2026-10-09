# Enforcing the rings — dependency-cruiser

Not set up yet: the app is being rewritten. Add it in the same change that
scaffolds the project, while the codebase has no violations — then there is no
baseline to maintain.

| File | Role |
|---|---|
| `.dependency-cruiser.cjs` | the rules (`forbidden`) and resolver options |
| `pnpm arch:check` | `depcruise src extension --config .dependency-cruiser.cjs` |

## The rules

| Rule | From | Forbidden target | Why |
|---|---|---|---|
| `contracts-are-the-core` | `src/domain/contracts/**` | anything but itself and `zod` | innermost ring; also used by the extension |
| `domain-is-pure` | `src/domain/**` | `react`, `next`, `src/application`, `src/adapters`, `src/server`, `src/app`, `src/features` | no framework and no I/O in the domain |
| `application-is-framework-free` | `src/application/**` | `react`, `next`, `src/adapters`, `src/server`, `src/app`, `src/features` | use cases talk to ports only |
| `ui-does-not-touch-adapters` | `src/features/**`, `src/app/**` except `providers.tsx` and `api/**` | `src/adapters/**` | only the composition root picks implementations |
| `server-only-stays-on-server` | anything except `src/app/api/**` and `src/server/**` | `src/server/**` | the schedule-log writer and other Node code never reach the client bundle |
| `adapters-are-leaves` | `src/adapters/<a>/**` | `src/adapters/<b>/**` (except `_shared`), `src/application`, `src/features`, `src/app` | adapters implement ports, they do not orchestrate |
| `no-cross-feature-imports` | `src/features/<a>/**` | `src/features/<b>/**` | see `frontend-ui-architecture` |
| `extension-uses-contracts-only` | `extension/**` | `src/**` except `src/domain/contracts/**` | the extension is a separate client of the protocol |
| `no-circular` | anything | a cycle | a cycle means two rings know each other |

Set `tsPreCompilationDeps: true`: `import type` counts. The dependency rule is
about names, and a type name is a name.

## Rules a linter cannot see

Add an ESLint `no-restricted-globals` / `no-restricted-syntax` override for
`src/domain/**` and `src/application/**`: `Date.now`, `Math.random`, `fetch`,
`localStorage`, `window`, `document`, `chrome`, `Notification`, `setTimeout`,
`setInterval`. That is what keeps the clock and the timers behind ports.

## Workflow

- **New violation** → fix the import. The error names the rule; SKILL §3–4 says
  where the code should live instead.
- **Rule is wrong for a real case** → change the rule with a comment saying why.
  Never add a baseline to make a new violation pass.
- **A rule that never fires may be broken, not satisfied.** When adding a rule,
  prove it with a throwaway file that violates it, then delete the file.
- With pnpm, match packages by the unanchored `node_modules/<pkg>/`: the real path
  is `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/`.
