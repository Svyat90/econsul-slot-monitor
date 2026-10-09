# onion-architecture

Onion (clean / hexagonal, ports-and-adapters) architecture for the e-Consul slot
monitor web app. This README is for people maintaining the skill; the agent reads
[`SKILL.md`](SKILL.md).

## Version

| Version | Date | Change |
|---|---|---|
| **1.1.0** | 2026-10-09 | Server module `server/` (Fastify + Drizzle + Postgres) as its own small onion (§11); request log as a decorator over the e-Consul port with background batching; schedule-change log moves to the server; paths updated after module docs moved into `extension/`. |
| **1.0.0** | 2026-10-09 | Adapted for this project: ring map for the rewrite of `slots.html` (contracts, pure slot and monitoring domain, use cases with ports, browser adapters, server-only schedule log, composition root), the browser-only e-Consul rule, clock/randomness/timers behind ports, the extension protocol as a contract, testing against recorded responses, proposed dependency-cruiser rules. |

Keep `metadata.version` in `SKILL.md` in sync. Semver: **major** when a rule
changes meaning or is removed, **minor** when a rule or reference file is added,
**patch** for wording and link fixes.

## Decisions baked in (2026-10-09)

| Question | Decision | Why |
|---|---|---|
| Where are e-Consul requests made? | Browser only, never via our server | Cloudflare blocks non-browser requests; the user's JWT must not reach our server (`docs/booking.md` §1, §14) |
| Clock and randomness in the domain? | Never; passed in | the horizon rule and release times depend on the time of day; tests need a fixed `nowMs` |
| Timers | behind a `Scheduler` port, owned by the monitor use case | the loop must not live in `useEffect`; tests advance time |
| Use cases take the whole deps bag or narrow deps? | Narrow `Deps` | explicit dependencies, trivial fakes |
| Extension protocol | zod discriminated union in `domain/contracts` | two clients (app, extension) must not drift |
| Thin modules | picker, settings, test buttons: UI + adapter, no use case | Seemann's *Ports and fat adapters* |
| Request log | Decorator over `EconsulApi` in the composition root, batches to `server/`; logging never blocks or changes a check | use cases stay unaware of logging; a down server costs entries, not checks |
| Enforcement | dependency-cruiser + ESLint restricted globals, added with the scaffold | no baseline needed when introduced on an empty codebase |

The layout in SKILL §2 is a proposal pending the stack decision in
`docs/brainstorm/ideas.md`. When that decision is recorded, update §2 and §4 paths
and bump the minor version.

## Sources

### Onion, clean and hexagonal architecture

- [The Onion Architecture : part 1 — Jeffrey Palermo](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — the original tenets; "not appropriate for small websites".
- [Onion Architecture — Herberto Graça](https://herbertograca.com/2017/09/21/onion-architecture/)
- [The Clean Architecture — Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — the Dependency Rule.
- [Hexagonal Architecture — Alistair Cockburn](https://alistair.cockburn.us/hexagonal-architecture) — ports and adapters.
- [Functional architecture is Ports and Adapters — Mark Seemann](https://blog.ploeh.dk/2016/03/18/functional-architecture-is-ports-and-adapters/) — pure core, I/O at the edges.
- [Ports and fat adapters — Mark Seemann](https://blog.ploeh.dk/2025/04/01/ports-and-fat-adapters/) — against forwarding-only use-case layers.
- [Functional Core, Imperative Shell — Gary Bernhardt](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)
- [Parse, don't validate — Alexis King](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
- [Anemic domain model — Wikipedia](https://en.wikipedia.org/wiki/Anemic_domain_model)

### TypeScript / frontend

- [Better Software Design with Application Layer Use Cases — Khalil Stemmler](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/)
- [Domain-Driven Hexagon — Sairyss](https://github.com/Sairyss/domain-driven-hexagon) — warns it is ill-suited for simple CRUD.
- [useSyncExternalStore — react.dev](https://react.dev/reference/react/useSyncExternalStore) — reading an external store (the monitor) from React.

### Enforcement

- [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
