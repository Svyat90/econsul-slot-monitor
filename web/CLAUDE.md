# web — карта для агента

Новий застосунок моніторингу слотів: Vite + React + TypeScript (SPA). Замінить `slots.html`.
Будується за [планом](../docs/plans/web-rewrite-plan.md) (виконано етапи 0–2:
каркас, меню, порожні сторінки на `/next/`). Запуск і команди — [README.md](README.md).

## Перед відповіддю

Спершу шукайте в `docs/` і `plans/` цього модуля, у [../docs/booking.md](../docs/booking.md) (сайт,
API, алгоритм слотів) і в `docs/insights.md` модуля й кореня. Потім — код.

## Неочевидні правила

- Запити до e-Consul — лише з браузера, лише через адаптер `econsul-api`; токен не йде на наш сервер.
- Алгоритм вільних слотів і горизонту — копія алгоритму сайту (`docs/booking.md` §6–7). Зміни —
  лише з тестами на записаних відповідях і оновленням `booking.md`.
- Кільця й залежності — скіл `onion-architecture`; розкладка UI — `frontend-ui-architecture`.
- Сторінку й API (`/api/*`) віддає Fastify з модуля `server/` на `localhost:3000`; у розробці Vite на
  `:3000` пересилає `/api` на Fastify `:3001`.
- Інтерфейс — українською, за [дизайном](docs/design/README.md); шрифти лише локальні.
- Кольори — лише змінні з `src/app/styles/tokens.css`; у CSS шрифти й файли з `public/` — шляхом
  `/fonts/...` без `/next/`: Vite сам додає `base`.
- Перед комітом: `pnpm test`, `typecheck`, `lint`, `arch:check`. Правило, що не спрацьовує, доводять
  тимчасовим файлом-порушником (`.claude/skills/onion-architecture/references/enforcement.md`).
- TypeScript 6, не 7: лінтерам потрібен JS API компілятора (`server/docs/insights.md`).

## Читати, коли

- [docs/design/README.md](docs/design/README.md) — перед будь-якою зміною інтерфейсу; знімки — еталон.
- [../docs/plans/web-rewrite-plan.md](../docs/plans/web-rewrite-plan.md) — етапи переписування й
  що вже зроблено.
- [../extension/plans/extension-plan.md](../extension/plans/extension-plan.md) §8 — протокол
  повідомлень із розширенням.
- [docs/fixtures.md](docs/fixtures.md) — перед тестами домену: звідки фікстури й як записати свіжі.
  `scripts/record-econsul-fixtures.js` запускає лише людина у своїй сесії.
