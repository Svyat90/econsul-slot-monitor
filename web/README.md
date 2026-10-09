# web — застосунок моніторингу слотів

Новий інтерфейс замість `slots.html`: календар вільних слотів, моніторинг установи, журнали і
налаштування. Vite + React + TypeScript; сторінку й API віддає сервер з модуля `server/`.

> Застосунок віддається на `http://localhost:3000/`. Старий `slots.html` тимчасово на `/old`
> (етап 8 [плану](../docs/plans/web-rewrite-plan.md)).

## Запуск

```sh
pnpm install
pnpm run build                  # web/dist; сервер віддає його на / (після перезапуску сервера)
pnpm dev                        # Vite на :3000, /api → сервер на :3001 (pnpm --dir ../server dev)
```

Одночасно відкривати лише один застосунок (`/` або `/old`): обидва говорять із розширенням.

| Команда | Що робить |
|---|---|
| `pnpm test` | Vitest + Testing Library (jsdom) |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run lint` | ESLint; у `src/domain/` і `src/application/` заборонені `Date.now()`, `Math.random()`, таймери й браузерні глобали |
| `pnpm run arch:check` | dependency-cruiser: кільця й межі ([onion-architecture](../.claude/skills/onion-architecture/SKILL.md)) |

## Файли

| Шлях | Що це |
|---|---|
| `src/main.tsx` | Точка входу: стилі, `AppProviders`, маршрутизатор |
| `src/app/` | Composition root (`providers.tsx`), маршрути (`router.tsx`), макет з меню (`Layout.tsx`), сторінки (`pages/`), стилі й токени (`styles/`) |
| `src/domain/` | Чисті функції (з етапу 3); `__fixtures__/` — записані відповіді e-Consul |
| `public/fonts/` | Локальні шрифти |

## Розділи

| Маршрут | Що там |
|---|---|
| `/slots` | Наступне відкриття, найближчі вільні, календар, панель дня (вільні, зайняті, неробочі, резервування) |
| `/monitoring` | Зведення за день, журнал перевірок, журнал резервувань, зміни розкладу |
| `/settings` | Що шукаємо, сесія, перевірки, бронювання, сповіщення |

Бокове меню на всіх сторінках: стан моніторингу, наступна перевірка, сесія, розширення, кнопки
«Зупинити» / «Перевірити».

## Документація модуля

| Документ | Про що |
|---|---|
| [docs/design/README.md](docs/design/README.md) | Макет, знімки екранів, токени дизайну |
| [docs/fixtures.md](docs/fixtures.md) | Записані відповіді e-Consul для тестів і як записати свіжі |
| `docs/insights.md` | Неочевидна поведінка (з'явиться з першим інсайтом) |
| `plans/` | Плани саме цього модуля; загальний план переписування — [../docs/plans/web-rewrite-plan.md](../docs/plans/web-rewrite-plan.md) |
