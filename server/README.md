# server — локальний сервер і журнали

Віддає застосунок `web/` і API на `http://localhost:3000` та зберігає журнали в Postgres назавжди,
щоб потім аналізувати, як змінюються слоти й розклад. Fastify 5 + Drizzle + Postgres у Docker.
Замінив `main.go`.

> Стан: віддає новий застосунок на `/` і всі журнали. Старий `slots.html` тимчасово на `/old` (з
> ним — `GET /locations.json` і `POST /schedule-log`), до видалення ([план](../docs/plans/web-rewrite-plan.md),
> етап 8, S8.T5). Межі історії — `[from, to)`; база недоступна → `/api`
> відповідає 503.

## Запуск

```sh
pnpm install
pnpm run db:up        # Postgres 17 у Docker на 127.0.0.1:5433, том econsul-pgdata
pnpm run db:migrate   # застосувати міграції (не під час старту сервера)
pnpm start            # http://localhost:3000
```

| Команда | Що робить |
|---|---|
| `pnpm dev` | Сервер на `:3001` з перезапуском — для Vite (`web/`), що на `:3000` пересилає `/api` сюди |
| `pnpm test` | Усі тести; `*.it.test.ts` — проти окремої бази `econsul_test` (створюється сама) |
| `pnpm run typecheck` | `tsc --noEmit` (Node запускає `.ts` напряму, без збірки) |
| `pnpm run db:generate` | Нова міграція зі схеми `src/db/schema/` |
| `pnpm run import:schedule-log [файл]` | Перенести старий `logs/schedule-changes.jsonl` у базу; повторний запуск нічого не дублює |

Змінні середовища: `PORT` (типово 3000), `DATABASE_URL` (типово
`postgres://econsul:econsul@127.0.0.1:5433/econsul`), `TEST_DATABASE_URL`. Том із даними не
видаляти: `docker compose down -v` стирає журнали.

## Що робить

- Віддає зібраний `web/` на `/` (невідомі шляхи поза `/api` → `index.html`; `/next/*` → 301 без `/next`), а тимчасово — старий `slots.html` на `/old`.
- Приймає пачки записів від застосунку й розширення і складає їх у таблиці:

| Таблиця | Що в ній | Пише |
|---|---|---|
| `econsul_requests` | кожен запит до e-Consul: метод, фільтри, статус, тривалість, результат | застосунок, розширення |
| `monitor_checks` | кожна перевірка моніторингу: вид, вільних, нових | застосунок |
| `reservation_events` | слоти, що зарезервували або звільнили між перевірками | застосунок |
| `schedule_changes` | зміни розкладу консулів (зараз — `logs/schedule-changes.jsonl`) | застосунок |
| `extension_events` | події розширення: сесія, чернетка, вибір слота | розширення |

- Віддає історію й зведення для сторінки «Моніторинг».

Сам сервер на e-Consul не ходить і токена не бачить: запити робить браузер, а сюди надходить лише
опис запиту — метод, статус, тривалість.

## API

| Маршрут | Призначення |
|---|---|
| `POST /api/request-log`, `/api/checks`, `/api/reservation-log`, `/api/schedule-log`, `/api/extension-events` | пачки 1–100 записів → 204 |
| `GET /api/checks`, `/api/reservation-log`, `/api/schedule-log`, `/api/request-log` | історія з фільтрами, нові зверху |
| `GET /api/schedule-log.jsonl` | журнал змін розкладу файлом |
| `GET /api/summary?date=` | зведення за день |
| `GET /api/locations` | довідник установ і свят |
| `GET /api/health` | чи живі сервер і база |

## Файли

| Шлях | Що це |
|---|---|
| `src/server.ts` | Запуск: конфігурація, контейнер, `listen`, коректна зупинка |
| `src/app.ts` | `buildApp(deps)`: маршрути, помилки (валідація → 422, база недоступна → 503), статика `web/dist`, тимчасово `slots.html` на `/old` |
| `src/platform/` | `config.ts` (порт, база, шляхи), `container.ts` (пул бази й репозиторії) |
| `src/contracts/` | Zod-схеми API — канонічні, `web/` імпортує їх як `@contracts/*` |
| `src/modules/<m>/` | `routes.ts` → `repository.ts` (Drizzle) |
| `src/db/` | `client.ts`, `schema/` (усі таблиці), `migrations/` (генерує drizzle-kit, руками не правити) |
| `src/test/` | Тестова база й `globalSetup` для інтеграційних тестів |
| `scripts/` | Імпорт старого журналу змін розкладу |
| `data/locations.json` | Довідник установ, послуг і свят (`docs/booking.md` §10) |

## Як пов'язаний з іншими модулями

- **`web/`** — сервер віддає його збірку й API на тому самому origin; `web/` імпортує zod-схеми API
  з `server/src/contracts/`.
- **`extension/`** — розширення надсилає свої запити й події на `http://localhost:3000/api/...`
  (етап 7 плану).

## Документація модуля

| Документ | Про що |
|---|---|
| [../docs/plans/web-rewrite-plan.md](../docs/plans/web-rewrite-plan.md) §5 | Таблиці, маршрути, поведінка без бази |
| [docs/insights.md](docs/insights.md) | Неочевидна поведінка сервера й інструментів |
| `plans/` | Плани саме цього модуля |
