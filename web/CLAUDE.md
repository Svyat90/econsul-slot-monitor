# web — карта для агента

Застосунок моніторингу слотів: Vite + React + TypeScript (SPA) на `localhost:3000/`. Замінив
старий `slots.html` ([web-rewrite-plan.md](../docs/plans/web-rewrite-plan.md)).
Запуск, команди й файли — [README.md](README.md). Як працює (сторінки, моніторинг, журнали) —
[../docs/booking.md](../docs/booking.md) §9.

## Перед відповіддю

Спершу шукайте в `docs/` і `plans/` цього модуля, у [../docs/booking.md](../docs/booking.md) (сайт,
API, алгоритм слотів) і в `INSIGHTS.md` модуля й кореня. Потім — код.

## Неочевидні правила

- Запити до e-Consul — лише з браузера, лише через адаптер `econsul-api`; токен не йде на наш сервер.
- Алгоритм вільних слотів і горизонту — копія алгоритму сайту (`docs/booking.md` §6–7). Зміни —
  лише з тестами на записаних відповідях і оновленням `booking.md`.
- Кільця й залежності — [../docs/architecture/onion.md](../docs/architecture/onion.md) поверх скіла `onion-architecture`; розкладка UI — `frontend-ui-architecture`.
- Сторінку й API (`/api/*`) віддає Fastify з модуля `server/` на `localhost:3000`; у розробці Vite на
  `:3000` пересилає `/api` на Fastify `:3001`.
- Інтерфейс — українською, за [дизайном](docs/design/README.md); шрифти лише локальні.
- Кольори — лише змінні з `src/app/styles/tokens.css`; у CSS шрифти й файли з `public/` — шляхом
  `/fonts/...`: Vite сам додає `base` (`/`).
- Перед комітом: `pnpm test`, `typecheck`, `lint`, `arch:check`. Правило, що не спрацьовує, доводять
  тимчасовим файлом-порушником (`docs/architecture/references/enforcement.md`).
- TypeScript 6, не 7: лінтерам потрібен JS API компілятора (`server/INSIGHTS.md`).

## Читати, коли

- [docs/conventions.md](docs/conventions.md) — перед кодом компонентів, хуків, сховищ: як скіли
  `react-best-practices` і `frontend-ui-architecture` застосовуються тут (Vite без Next.js, сховище
  моніторингу, таймери поза React, де константи).
- [docs/design/README.md](docs/design/README.md) — перед будь-якою зміною інтерфейсу; знімки — еталон.
- [../docs/plans/web-rewrite-plan.md](../docs/plans/web-rewrite-plan.md) — етапи переписування й
  що вже зроблено.
- [../extension/plans/extension-plan.md](../extension/plans/extension-plan.md) §8 — протокол
  повідомлень із розширенням.
- [docs/fixtures.md](docs/fixtures.md) — перед тестами домену: звідки фікстури й як записати свіжі.
  `scripts/record-econsul-fixtures.js` запускає лише людина у своїй сесії.
