# e-Consul slot monitor

Шукає вільні слоти запису на візит на [e-consul.gov.ua](https://e-consul.gov.ua) так само, як їх
рахує сам сайт, стежить за вибраною установою й послугою, сповіщає про нові слоти, а розширення
Chrome вибирає знайдений слот у чернетці заявки.

## Модулі

| Модуль | Що це | Документація |
|---|---|---|
| Застосунок (`slots.html`) | Сторінка моніторингу на `http://localhost:3000` | [docs/booking.md](docs/booking.md) §9 |
| [`server/`](server/README.md) | Сервер Fastify + Postgres: віддає сторінку, довідник і зберігає журнали | [server/README.md](server/README.md) |
| [`extension/`](extension/README.md) | Розширення Chrome «e-Consul Helper» | [extension/README.md](extension/README.md) |
| [`web/`](web/README.md) | Заплановано: новий застосунок на Vite + React | [план](docs/plans/web-rewrite-plan.md), [дизайн](web/docs/design/README.md) |

Застосунок переписується на Vite + React з сервером Fastify (гілка `feature/web-app-rewrite`).

## Запуск

```sh
pnpm --dir server install
pnpm --dir server run db:up       # Postgres у Docker
pnpm --dir server run db:migrate  # один раз і після нових міграцій
pnpm --dir server start
```

Відкрити `http://localhost:3000`, встановити розширення з теки `extension/`
([інструкція](extension/README.md#встановлення)).

## Спільна документація (`docs/`)

| Документ | Про що |
|---|---|
| [booking.md](docs/booking.md) | Як працює запис на сайті, API, алгоритм вільних слотів, застосунок, бронювання |
| [insights.md](docs/insights.md) | Неочевидна поведінка, що стосується кількох модулів |
| [brainstorm/ideas.md](docs/brainstorm/ideas.md) | Чернетка ідей і рішень щодо переписування |
| [plans/web-rewrite-plan.md](docs/plans/web-rewrite-plan.md) | План переписування застосунку (`web/`, `server/`, розширення) |

Кожен модуль має власні `CLAUDE.md`, `README.md`, `docs/` і `plans/` — див. [CLAUDE.md](CLAUDE.md).
