# e-Consul slot monitor — карта для агента

Локальний інструмент для одного користувача: шукає вільні слоти запису на візит на
e-consul.gov.ua, стежить за ними й передає знайдене розширенню Chrome, яке вибирає слот у
чернетці заявки. Огляд модулів — [README.md](README.md).

## Модулі

| Модуль | Що це |
|---|---|
| `extension/` | Розширення Chrome «e-Consul Helper» (MV3) — [extension/CLAUDE.md](extension/CLAUDE.md) |
| `web/` | Застосунок: Vite + React + TypeScript (SPA) на `localhost:3000/` — [web/CLAUDE.md](web/CLAUDE.md) |
| `server/` | Fastify + Drizzle + Postgres у Docker: віддає `web/` і API `/api/*` на `localhost:3000`; журнали запитів, резервувань, змін розкладу й подій розширення (зберігаються назавжди) — [server/CLAUDE.md](server/CLAUDE.md) |

Рішення щодо переписування — у `docs/brainstorm/ideas.md` (IDEA-001…006), план і журнал виконання — `docs/plans/web-rewrite-plan.md`.

## Структура модуля

Кожен модуль (тека верхнього рівня з власним кодом) має:

| Що | Навіщо |
|---|---|
| `CLAUDE.md` | Карта для агента: неочевидні правила модуля, що не чіпати, що читати й коли — з посиланнями на документацію |
| `README.md` | Для людей: що робить модуль, як запустити, файли, як пов'язаний з іншими, перелік документації |
| `INSIGHTS.md` | Неочевидна поведінка модуля (скіл `engineering-insights`) |
| `docs/` | Документація саме цього модуля |
| `plans/` | Плани робіт саме цього модуля |

Кореневий `INSIGHTS.md` — спільні інсайти. Коренева `docs/` — лише те, що стосується кількох модулів: `booking.md` (сайт, API, алгоритм
слотів, застосунок), `conventions.md` (як скіли плагінів застосовуються тут), `brainstorm/` (ідеї та рішення),
`plans/` (плани на кілька модулів, коли з'являться). Новий модуль створюється одразу з цими
чотирма елементами; правила модуля не повторюються тут.

## Перед відповіддю

- Визначте модуль, якого стосується запит, і прочитайте його `INSIGHTS.md` та кореневий
  `INSIGHTS.md` (скіл `engineering-insights`); одним рядком скажіть, що з них стосується задачі.
- Шукайте відповідь спершу в `docs/` і `plans/` модуля та в кореневій `docs/`, потім у коді.
- Після задачі — допишіть неочевидне в `INSIGHTS.md` модуля або кореневий (той самий скіл).

## Правила для всіх модулів

- Запити до e-Consul — лише з браузера й лише з токеном користувача; токен не потрапляє на наш
  сервер, у базу, у логи чи коміти.
- Алгоритм вільних слотів має збігатися з сайтом (`docs/booking.md` §6–7, §11). Зміна поведінки —
  разом зі зміною `docs/booking.md`.
- Нічого не бронювати й не ставати в чергу очікування під час розробки чи тестів.
- Документація українською. Змінили поведінку модуля — оновіть його `docs/` у тому самому коміті.

## Агенти й скіли

Загальний процес і загальні знання дають плагіни маркетплейсу `dev-digest-ai-marketplace`
(увімкнені в `.claude/settings.json`); знання про цей проєкт — у `CLAUDE.md` модулів, `docs/` і
`.claude/paved-path.json` (пакети, перевірки, що не чіпати, сигнали для рев'ю).

- `sdd-engineering`: агенти `spec-creator` → `implementation-planner` → `implementer` (через скіл
  `run-plan`) → `plan-verifier`; скіл `workflow-retro`. Як план виконується — `docs/plans/README.md`.
- `architecture-review`: агент `architecture-reviewer`. `research-tools`: агент `researcher`.
- `engineering-paved-path`: скіли `react-best-practices`, `react-testing-library`,
  `frontend-ui-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`,
  `postgresql-table-design`, `zod`, `typescript-expert`, `security`, `pr-self-review`, `review-kit`.
  Як вони застосовуються тут — [docs/conventions.md](docs/conventions.md),
  [web/docs/conventions.md](web/docs/conventions.md), [server/docs/conventions.md](server/docs/conventions.md);
  де вони розходяться зі скілом, діють ці файли.
- Локальні скіли (`.claude/skills/`), налаштовані під проєкт і важливіші за однойменні плагінні:
  `onion-architecture` (кільця `web/` і `server/`), `engineering-insights`, `brainstorm`.

Правила для агентів, що пишуть код (додаток до правил вище):

- Інсайти — у `<модуль>/INSIGHTS.md` і кореневому `INSIGHTS.md` (так їх шукають і агенти плагінів).
- Жодного запиту до `e-consul.gov.ua` / `my.e-consul.gov.ua` з коду, тесту, скрипта чи браузера;
  тести — на записаних відповідях (`web/src/domain/__fixtures__/`) і заглушках.
- Токен сесії — ніде: ні в коді, фікстурах, логах, назвах тестів, знімках, базі, журналі запитів.
  Лише адаптер `econsul-api` кладе його в заголовок `token`, і лише до `my.e-consul.gov.ua`.
- Код у `web/src/domain/slots/` і `web/src/domain/monitoring/` відтворює `docs/booking.md` §6–7 і §9;
  зміна поведінки там без явного рішення в плані — дефект плану.
- Агенти не запускають `pnpm install`, `docker`, `db:migrate` і сервери; модуль `extension/` не має
  тестів — перевірка `node --check` і ручні кроки.
