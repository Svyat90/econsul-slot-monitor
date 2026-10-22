# server — карта для агента

Локальний сервер: Fastify 5 + Drizzle + Postgres у Docker. Віддає застосунок `web/` і API `/api/*`
на `127.0.0.1:3000`, зберігає журнали запитів до e-Consul, перевірок, резервувань, змін розкладу й
подій розширення ([план](../docs/plans/web-rewrite-plan.md)); журнали
працюють з етапу 5, події розширення — з етапу 7. Як запустити й де що лежить — [README.md](README.md).

## Перед відповіддю

Спершу шукайте в `docs/` і `plans/` цього модуля, у [плані](../docs/plans/web-rewrite-plan.md) §5 і
в `docs/insights.md` модуля й кореня. Потім — код.

## Неочевидні правила

- **Сервер ніколи не ходить на e-Consul.** Запити до `my.e-consul.gov.ua` працюють лише з браузера
  й з токеном користувача ([../docs/booking.md](../docs/booking.md) §1, §14). Застосунок і
  розширення лише *звітують* про свої запити в `POST /api/request-log`. Маршрут-проксі до e-Consul —
  помилка дизайну.
- **Жодного токена.** Схеми тіл `POST` — zod `.strict()`: невідомий ключ (`token`, `headers`) — 422,
  а не тихо відкинутий. Pino не логує заголовки (`redact` для `req.headers.token` і
  `req.headers.authorization`). У таблицях немає колонок для токена, заголовків, тіл відповідей і
  даних заявника.
- **Один origin.** `127.0.0.1:3000` віддає `web/dist` (невідомі шляхи поза `/api` → `index.html`) і
  `/api`. CORS-плагіна немає. У розробці Vite на `:3000` пересилає `/api` на Fastify `:3001`.
- **Записи вічні й незмінні.** Без `UPDATE`/`DELETE` і чисток; у кожній таблиці `bigint` identity,
  `client_id uuid UNIQUE` (повторна пачка не дублює рядки — `onConflictDoNothing`), `timestamptz`.
- **Запис не гальмує моніторинг.** `POST` — пачка 1–100 записів, валідація й одна вставка, 204.
  Postgres недоступний — 503; застосунок повторить.
- Drizzle — лише в `src/modules/<m>/repository.ts` і `src/db/**`. Модуль:
  `routes.ts` → `service.ts` (лише коли є логіка) → `repository.ts` (`onion-architecture` §11).
- Zod-схеми API в `src/contracts/` — канонічні; `web/` імпортує їх через alias `@contracts`.
  Zod 4, та сама версія, що в `web/package.json`.
- Міграції — `drizzle-kit generate`, застосовуються командою, не під час старту. Том Postgres у
  `docker-compose.yml` не видаляти. `src/db/migrations/**` руками не правити.
- Інтеграційні тести (`*.it.test.ts`) — лише в базі `econsul_test` через `createTestDb()` з
  `src/test/db.ts`; робочу базу `econsul` тести не чіпають.
- Node запускає `.ts` напряму: імпорти з розширенням `.ts`, без `enum`, `namespace` і parameter
  properties (`erasableSyntaxOnly`).
- Фільтри історії `from`/`to` — завжди `[from, to)`; день для зведення рахує браузер (його північ).
- Маршрут модуля реєструє повний шлях `/api/...` (крім `summary` і `reservation-log`, які
  реєструються з `prefix: '/api'` у `app.ts`) — дивитися в `app.ts`, а не вгадувати.
- `@fastify/static` не можна направляти на корінь репозиторію — віддасть `logs/` і `.git`.
  Довідник (`/api/locations`) віддається окремим маршрутом.

## Читати, коли

- [../docs/plans/web-rewrite-plan.md](../docs/plans/web-rewrite-plan.md) §5 — таблиці, маршрути,
  поведінка без бази; §7 — етапи.
- Скіли `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` — розділ
  «In this project» перед будь-яким кодом сервера; `security` — перед маршрутом, що приймає дані.
- [../extension/plans/extension-plan.md](../extension/plans/extension-plan.md) — що й коли надсилає
  розширення (етап 7 плану).
- `docs/insights.md` — перед нетривіальною роботою; після неї — дописати неочевидне скілом
  `engineering-insights`.
