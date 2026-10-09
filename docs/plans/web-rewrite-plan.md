# План: переписування застосунку на Vite + React з сервером Fastify

Статус: **погоджено 2026-10-09**, етап 0 виконано 2026-10-09 (гілка `feature/web-app-rewrite`).
Рішення, на яких стоїть план, — [брейншторм](../brainstorm/ideas.md), IDEA-001…006. Дизайн —
[web/docs/design](../../web/docs/design/README.md). Як працює сайт і поточний застосунок —
[booking.md](../booking.md).

## Зміст

1. [Мета і межі](#1-мета-і-межі)
2. [Ухвалені рішення](#2-ухвалені-рішення)
3. [Структура репозиторію](#3-структура-репозиторію)
4. [Застосунок web/](#4-застосунок-web)
5. [Сервер server/](#5-сервер-server)
6. [Зміни в розширенні](#6-зміни-в-розширенні)
7. [Етапи](#7-етапи)
8. [Як перевіряти, нічого не забронювавши](#8-як-перевіряти-нічого-не-забронювавши)
9. [Ризики](#9-ризики)
10. [Поза межами плану](#10-поза-межами-плану)
11. [Відкриті питання](#11-відкриті-питання)
12. [Етап 0 — задачі](#етап-0--задачі)
13. [Журнал виконання](#журнал-виконання)

---

## 1. Мета і межі

Замінити `slots.html` (2 500 рядків в одному файлі) і `main.go` на:

- **`web/`** — застосунок на Vite + React + TypeScript з трьома розділами й боковим меню за
  узгодженим макетом;
- **`server/`** — Fastify + Drizzle + Postgres у Docker: віддає застосунок і API на
  `localhost:3000` і зберігає журнали назавжди для подальшого аналізу.

Поведінка, яку треба зберегти без змін:

- алгоритм вільних слотів, горизонт, свята, моменти відкриття нових днів (`booking.md` §6–7, §9);
- моніторинг: випадковий інтервал, розклад раз на 30 хв, часті перевірки навколо відкриття,
  сповіщення лише про нові слоти, зупинка на 401/403 і відновлення після входу;
- протокол повідомлень із розширенням (`extension/plans/extension-plan.md` §8) — розширення не
  повинно помітити, що застосунок переписано;
- збережені в браузері налаштування (`localStorage` того самого origin `localhost:3000`).

Що прибираємо (IDEA-002): завантаження JSON-файлів, три кнопки Fetch (лишається «Перевірити»),
тестові кнопки на головному екрані (переїжджають у «Налаштування»).

## 2. Ухвалені рішення

| Рішення | Звідки |
|---|---|
| Бокове меню з блоком стану й пунктами «Слоти», «Моніторинг», «Налаштування»; глобальні банери (сесія, нові слоти); маршрут у адресі; порожній стан | IDEA-001 |
| Зайняті й неробочі слоти лишаються: смужка в клітинці календаря, плитки в панелі дня, лічильники | IDEA-002 |
| Стиль дизайну A розширення, увесь інтерфейс українською | IDEA-003 |
| Лог резервувань і звільнень слотів — у базі | IDEA-004 |
| Журнал усіх запитів до e-Consul (застосунок і розширення) і подій розширення; Fastify + Postgres у Docker; записи назавжди | IDEA-005 |
| Vite + React SPA; Fastify віддає застосунок і `/api/*` на одному origin `localhost:3000` | IDEA-006 |

## 3. Структура репозиторію

Кожен модуль має `CLAUDE.md`, `README.md`, `docs/`, `plans/` (див. кореневий `CLAUDE.md`).

```
web/
  CLAUDE.md  README.md  docs/  plans/
  index.html  vite.config.ts  tsconfig.json  package.json
  public/fonts/                 Manrope, IBM Plex Mono (локально)
  src/
    main.tsx                    маршрутизатор
    app/                        composition root: providers.tsx (залежності), Layout.tsx
                                (бокове меню, банери), сторінки маршрутів
    domain/                     чисті функції, без React, годинника й мережі
      contracts/                zod: відповіді e-Consul, locations, протокол розширення
      slots/                    час і часові пояси, дні календаря й горизонт, вільні слоти
      monitoring/               відкриття днів, вікно частих перевірок, наступна перевірка,
                                нові слоти, діапазон дат, зміни зайнятих слотів, зміни розкладу
      __fixtures__/             записані відповіді API
    application/                ports.ts, monitor.ts (стан + цикл), run-check.ts
    adapters/                   econsul-api, request-log, server-api, extension-bridge,
                                alerts (нотифікації + звуки), settings-store
    features/                   status, slots, monitoring, settings, locations, extension
server/
  CLAUDE.md  README.md  docs/  plans/
  package.json  tsconfig.json  drizzle.config.ts  docker-compose.yml
  data/locations.json           довідник (переїжджає з кореня)
  src/
    server.ts  app.ts           запуск; плагіни, статика web/dist, /api
    platform/                   config.ts, container.ts, errors.ts
    contracts/                  zod-схеми API — канонічні; web імпортує їх через alias @contracts
    db/                         client.ts, schema/, migrations/ (генерує drizzle-kit)
    modules/                    request-log, extension-events, checks, reservation-log,
                                schedule-log, summary, locations — routes.ts → repository.ts
```

- Два незалежні пакети (pnpm), без workspace; спільні контракти — через path
  alias. **Zod 4** (`zod@^4`) в обох `package.json`, одна й та сама версія.
- Кільця й правила імпорту — скіл `onion-architecture`; enforcement (`dependency-cruiser` +
  ESLint `no-restricted-globals` для `domain/` і `application/`) вмикається на етапі 2, поки код
  порожній.

## 4. Застосунок web/

### Порти (`application/ports.ts`)

| Порт | Що робить | Адаптер |
|---|---|---|
| `EconsulApi` | `getSchedule(institutionCode)`, `getReservedSlots(consulHashes)`; помилки — `SessionExpiredError`, `EconsulUnavailableError`, `EconsulSchemaError` | `econsul-api` (браузерний `fetch` з токеном), обгорнутий `request-log` |
| `ServerApi` | записати перевірку, резервування, зміни розкладу; прочитати журнали й зведення | `server-api` (`/api/*`, пачками, у фоні) |
| `ExtensionBridge` | надіслати й отримати `app:*` / `ext:*` | `extension-bridge` (`postMessage`, перевірка origin і `source`, розбір контрактом) |
| `Alerts` | нові слоти, сесія скінчилась; дозволи | `alerts` (Notification, Web Audio — ті самі звуки, що зараз) |
| `SettingsStore` | вибір установи й послуги, інтервал, діапазон дат, чернетка, прапорці | `settings-store` (`localStorage`, ті самі ключі, що в `slots.html`) |
| `Clock`, `Random`, `Scheduler` | час, випадковість, таймери | браузерні реалізації; у тестах — фейки |

### Відповідність функцій `slots.html` (`booking.md` §9, «Ключові функції»)

| Зараз | Буде |
|---|---|
| `buildScheduleDays()`, `getHolidaySet()`, `getConsulateOffset()` | `domain/slots/schedule-days.ts` (усе — аргументами, `nowMs` ззовні) |
| `calculateBookableWindows()` | `domain/slots/free-slots.ts` |
| `getUpcomingReleases()`, `getFastWindow()`, `scheduleNextCheck()` (рішення) | `domain/monitoring/releases.ts`, `schedule.ts` |
| `getFreeSlotKeys()`, `inDateRange()`, `formatSlotLines()` | `domain/monitoring/slots-diff.ts` |
| `recordScheduleSnapshot()`, `diffSnapshots()` | `domain/monitoring/schedule-changes.ts` |
| — (нове, IDEA-004) | `domain/monitoring/reserved-diff.ts`: зарезервовано / звільнено між двома перевірками |
| `runCheck()`, `startMonitoring()`, `stopMonitoring()`, `checkNow()` | `application/run-check.ts`, `monitor.ts` |
| `callExternalReader()` | `adapters/econsul-api` |
| `postToExt()`, `onExt*()`, `sendSlotsToExtension()` | `adapters/extension-bridge` + `monitor.ts` |
| `alertSlots()`, `alertSession()`, `glassCrash()` | `adapters/alerts` |
| `render*()`, календар, модальне вікно | `features/*` |

### Сторінки (знімки — [web/docs/design](../../web/docs/design/README.md))

- **Слоти:** «Наступне відкриття» (момент, дні, відлік, часті перевірки), «Найближчі вільні» в
  діапазоні дат, календар (кількість вільних, смужка зайнятих і неробочих, приглушені дні поза
  діапазоном, межа горизонту, ще не відкриті дні), панель дня (плитки, неробочий час, нещодавні
  резервування, «Відкрити чернетку»).
- **Моніторинг:** зведення за день (перевірки, нові вільні, резервування, скасування), журнал
  перевірок із фільтрами, журнал резервувань, зміни розкладу із завантаженням JSONL. Дані — з
  сервера (історія) плюс поточна сесія з монітора.
- **Налаштування:** що шукаємо, сесія (токен від розширення, ручне введення), перевірки,
  бронювання (чернетка, автобронювання), сповіщення (дозволи, мітка вкладки, тестові кнопки).
- **Бокове меню:** блок стану (стан, наступна перевірка, сесія зі смужкою, розширення ✓/✗,
  «Зупинити»/«Запустити», «Перевірити»), пункти меню з бейджами.

## 5. Сервер server/

Fastify слухає `127.0.0.1:3000`, віддає `web/dist` (усі невідомі шляхи поза `/api` → `index.html`)
і API. Без CORS. Postgres — `docker-compose.yml` у `server/`, том із даними не видаляється.
Міграції — `drizzle-kit generate`, застосовуються командою, не під час старту. Деталі —
скіли `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` («In this project»).

### Таблиці

| Таблиця | Що в ній | Пише |
|---|---|---|
| `econsul_requests` | кожен запит до e-Consul: метод, фільтри, установа, статус, тривалість, результат, `source` (`app` / `extension`), сесія вкладки | застосунок, розширення |
| `monitor_checks` | кожна перевірка: час, вид (`scheduled` / `fast` / `manual`), установа й послуга, вільних, нових, поза діапазоном, нові слоти (jsonb), результат | застосунок |
| `reservation_events` | зарезервовано / звільнено: слот, консул, між якими перевірками | застосунок |
| `schedule_changes` | `baseline` / `changed` зі списком змін (як зараз у JSONL) | застосунок |
| `extension_events` | події розширення: тип, час, `job_id` для воронки вибору слота, `payload` (jsonb) | розширення |

Спільне для всіх: `bigint` identity-ключ, `client_id uuid UNIQUE` для повторних відправок без
дублів, `timestamptz`, записи не змінюються й не видаляються. Жодних токенів, заголовків, тіл
відповідей, даних заявника.

### API

| Маршрут | Призначення |
|---|---|
| `POST /api/request-log`, `/api/checks`, `/api/reservation-log`, `/api/schedule-log`, `/api/extension-events` | пачки 1–100 записів → 204; строгі zod-схеми |
| `GET /api/checks`, `/api/reservation-log`, `/api/schedule-log`, `/api/request-log` | історія з фільтрами, курсор за `id`, нові зверху |
| `GET /api/schedule-log.jsonl` | завантаження журналу змін розкладу |
| `GET /api/summary?date=` | зведення для «Моніторингу» |
| `GET /api/locations` | довідник установ і свят |
| `GET /api/health` | живий сервер і база |

Якщо Postgres недоступний, `POST` повертає 503, а застосунок тримає записи в пам'яті й
повторює; моніторинг від цього не зупиняється.

## 6. Зміни в розширенні

- `background.js` записує власні запити (`auth/me`, `GET /tasks/{id}`) і події: сесія (з'явилась,
  скінчилась і чому), чернетка (знайдено, надіслано, видалено), воронка вибору слота з причинами й
  тривалістю етапів, автобронювання, дії користувача (звук, пауза, автобронювання).
- Записи спершу йдуть у `chrome.storage.local` (service worker засинає), відправка пачками на
  `http://localhost:3000/api/...` за будильником і після кожної події. Нових дозволів не треба.
- Протокол із застосунком не змінюється. Піднімається `version` у `manifest.json`;
  оновлюються `extension/docs/how-it-works.md` і `extension/plans/extension-plan.md`.

## 7. Етапи

Кожен етап — окремі коміти; після кожного застосунок працює. Перед етапом його розбивають на
задачі (`## Етап N — задачі`, формат — [README.md](README.md)); виконують агенти `implementer`,
перевіряють `plan-verifier` і `architecture-reviewer` (`.claude/agents/`). Поки новий застосунок не готовий,
на `/` лишається `slots.html`, а новий відкривається за `/next/` (Vite `base`). **Одночасно
відкривати лише один із них**: обидва говорять із розширенням.

| # | Етап | Результат | Перевірка |
|---|---|---|---|
| 0 | Погодження | План погоджено; IDEA-001…006 → `promoted` з посиланням сюди; `server/` отримує `CLAUDE.md`, `README.md`, `docs/`, `plans/` | — |
| 1 | Сервер замість `main.go` | `server/`: Fastify, Postgres у Docker, Drizzle, міграції всіх таблиць. Віддає `slots.html`, `locations.json`, приймає старий `POST /schedule-log` у таблицю; `logs/schedule-changes.jsonl` імпортовано | `slots.html` працює з `localhost:3000` як раніше; зміни розкладу з'являються в базі; тести репозиторіїв на справжньому Postgres |
| 2 | Каркас `web/` | Vite + React + TS + маршрутизатор, локальні шрифти, токени дизайну, бокове меню й порожні сторінки за `/next/`; vitest + RTL; `dependency-cruiser` і ESLint-обмеження | `pnpm build` + Fastify віддає `/next/`; правила архітектури доведено файлом-порушником |
| 3 | Домен | Функції з таблиці §4 перенесені в `domain/` з тестами на записаних відповідях і фіксованому `nowMs`; контракти e-Consul і протоколу розширення | **Звірка з `slots.html`:** ті самі вхідні дані й `nowMs` → ті самі дні, вільні слоти, моменти відкриття (скрипт у браузері через puppeteer). Фікстури — [web/docs/fixtures.md](../../web/docs/fixtures.md) |
| 4 | Монітор і адаптери | `monitor.ts`, `run-check.ts`, `econsul-api`, `extension-bridge`, `alerts`, `settings-store` (старі ключі `localStorage`); блок стану в меню | Тести монітора з фейковим часом (вікно частих перевірок, 401 → зупинка → `ext:token` → `Resumed after login`, Stop не відновлюється). Вручну: моніторинг на `/next/` знаходить ті самі слоти, що `slots.html` |
| 5 | Журнали | Модулі сервера для `checks`, `reservation-log`, `request-log`, `schedule-log`, `summary`; адаптери `request-log` (обгортка `EconsulApi`) і `server-api`; сторінка «Моніторинг» | Записи з'являються в таблицях; сервер вимкнено → моніторинг триває, записи доходять після ввімкнення; у базі немає токена (`grep` по дампу) |
| 6 | «Слоти» й «Налаштування» | Сторінки за знімками, глобальні банери, порожній стан, тестові кнопки | Порівняння з `slots.png`, `settings.png`; RTL-тести на ключові стани; сценарії зі знімка «Tweaks» (сесія, нові слоти, без установи) |
| 7 | Логування розширення | §6; нова `version` у `manifest.json` | Події й запити розширення в базі, у тому числі коли вкладка застосунку закрита; тестові `app:slots` позначені `test` |
| 8 | Перемикання й прибирання | Новий застосунок на `/`; видалено `slots.html`, `main.go`, `go.mod`, старий маршрут `/schedule-log`; `slots.json`, `slots_not_working.json` → фікстури; `booking.md` §9 (лишається в корені) описує новий застосунок; оновлено `CLAUDE.md`, `README.md`, скіли | Повний день моніторингу на новому застосунку без розбіжностей зі старим; розширення працює без змін протоколу |

## 8. Як перевіряти, нічого не забронювавши

- Як і для розширення (`extension/plans/extension-plan.md` §12): «Підтвердити», «Підтверджую» і
  «Записатись в чергу очікування» в тестах не натискаються; автобронювання під час розробки
  вимкнене; тестові слоти мають `test: true`.
- e-Consul у тестах — заглушки (записані відповіді); живий API — лише читання розкладу й зайнятих
  слотів з власною сесією користувача, з тими самими інтервалами, що й моніторинг.
- Звірку алгоритму робити на записаних відповідях, а не частими запитами до живого API.

## 9. Ризики

| Ризик | Що робимо |
|---|---|
| Алгоритм у новому коді розходиться з сайтом | Етап 3: перенос дослівно, потім рефакторинг; звірка зі старою сторінкою на однакових даних |
| Часові пояси й перехід на зимовий час | Тести з датами до й після переходу (Чикаго 01.11.2026) |
| Дві відкриті сторінки (стара й нова) плутають розширення | На час переходу відкривати одну; після етапу 8 стара зникає |
| База або Docker не запущені | Застосунок і моніторинг працюють, журнали чекають у пам'яті з обмеженням; статус бази в меню |
| Fastify впав — немає й сторінки | Як і з `main.go` зараз; запуск однією командою, у README |
| Service worker розширення засинає й губить події | Буфер у `chrome.storage.local`, відправка за будильником |
| Вічні журнали ростуть | ~2–3 тис. записів на день; індекси за часом; переглянути, коли буде виміряно |

## 10. Поза межами плану

- Автозаповнення кроків 1–3 і ранкова чернетка — етап 3 плану розширення.
- Аналітика й графіки над журналами — окремо, коли накопичаться дані.
- Хостинг, кілька користувачів, акаунти.

## 11. Відкриті питання

Закриті 2026-10-09:

1. ~~Версія zod~~ — Zod 4 в обох модулях. `fastify-type-provider-zod` для Zod 4 — від v5;
   версію сумісного пакета перевірити під час встановлення на етапі 1.
2. ~~Фікстури~~ — записуються скриптом [web/scripts/record-econsul-fixtures.js](../../web/scripts/record-econsul-fixtures.js)
   (Чикаго, Г'юстон, Нью-Йорк), опис — [web/docs/fixtures.md](../../web/docs/fixtures.md).
3. ~~Опис застосунку з `booking.md` §9~~ — лишається в кореневому `booking.md`: він описує і сайт,
   і застосунок; на етапі 8 оновлюється під новий застосунок.

Відкритих питань немає.

## Етап 0 — задачі

Погодження плану (2026-10-09) і `promoted` для IDEA-001…006 (коміт 26c270d) вже зроблено; лишився
каркас документації `server/`. Задача лише з документації, без коду й тестів, — її виконала основна
сесія, без агента `implementer`.

### Wave 1

#### S0.T1 — каркас документації модуля `server/`
- Module: server
- Depends on: —
- Files (exclusive):
  - `server/CLAUDE.md` (new)
  - `server/README.md` (new)
  - `server/docs/.gitkeep` (new)
  - `server/plans/.gitkeep` (new)
  - `CLAUDE.md` (рядок `server/` у таблиці модулів)
- Rules:
  - Модуль має `CLAUDE.md`, `README.md`, `docs/`, `plans/` — кореневий `CLAUDE.md`, «Структура модуля»
  - `CLAUDE.md` — неочевидні правила, що читати й коли; `README.md` — для людей: що робить, файли,
    зв'язок з іншими модулями, документація
  - Правила сервера — з §5 плану й розділів «In this project» скілів `fastify-best-practices`,
    `drizzle-orm-patterns`, `postgresql-table-design`, `security`; нічого нового не вигадувати
  - Документація українською
- Acceptance criteria:
  - `server/` має чотири елементи; кореневий `CLAUDE.md` посилається на `server/CLAUDE.md`
  - `server/CLAUDE.md` каже, що сервер не ходить на e-Consul і не приймає токен
- Verify:
  - `ls -a server server/docs server/plans`

### Ownership

| Файл | Задача |
|---|---|
| `server/CLAUDE.md`, `server/README.md`, `server/docs/.gitkeep`, `server/plans/.gitkeep`, `CLAUDE.md` | S0.T1 |

## Журнал виконання

- 2026-10-09 · Етап 0 · S0.T1 виконано.
- 2026-10-09 · Етап 0 закрито: `plan-verifier` — VERIFIED (7/7 MET), `architecture-reviewer` — PASS, без знахідок.
- 2026-10-09 · Етап 1 · S1.T0–S1.T4 виконано; `logs/schedule-changes.jsonl` імпортовано (5 записів, повторно — 0).
- 2026-10-09 · Етап 1 закрито: `architecture-reviewer` — PASS; `plan-verifier` — 13 MET, без знахідок у коді; невідмічене (ручна перевірка на `:3000`) зроблено основною сесією: старий `main.go` зупинено, `pnpm --dir server start` на `:3000`, `slots.html` завантажує довідник, `/api/health` → `ok`. Запис зміни розкладу з браузера з'явиться з першою справжньою зміною (маршрут покрито тестами).
- 2026-10-09 · Етап 2 · S2.T0–S2.T5 виконано: `/next/slots` у браузері — меню й сторінка; усі правила `web/.dependency-cruiser.cjs` і ESLint доведено файлами-порушниками (видалено). Відхилення від макета на етап 6: активний пункт меню підсвічено `--color-fast-bg` (фіолетовий), у макеті — світло-синій.
- 2026-10-09 · Етап 2 закрито: `architecture-reviewer` — PASS (зауваження: правило `application-is-framework-free` без винятку `@contracts` — виправлено разом із `enforcement.md`); `plan-verifier` — 8 MET, решта — лише те, що він не може перевірити сам (знімок у браузері, файли-порушники); обидва зроблено основною сесією.
- 2026-10-09 · Етап 3 · S3.T1–S3.T11 виконано; `pnpm --dir web run reconcile` — 54 порівняння (3 фікстури × 3 варіанти зайнятих × 6 моментів), усі збіглися зі `slots.html`. Записані фікстури мають 0 вільних слотів — тому варіанти з частиною зайнятих прибраною. Протокол §8 `extension-plan.md` виправлено: `app:selection` і `ext:draft` мають вкладені `selection` / `draft`.
- 2026-10-09 · Етап 3 закрито: `architecture-reviewer` — PASS, без знахідок; `plan-verifier` — 16 MET, 0 NOT MET (UNVERIFIABLE: червоний прогін S3.T3 і S3.T9 — агенти написали код раніше тесту; вільні слоти на живих даних — у фікстурах їх немає).
- 2026-10-09 · Етап 4 · S4.T0–S4.T7 виконано. S4.T6 знайшов розбіжність контракту: `app:monitor.nextRelease.opening` — рядок ('09:00'), як у `slots.html`, а не boolean (виправлено, §8 `extension-plan.md` доповнено). Тест маршрутів після S4.T7 переведено на `src/test/fake-services.tsx`. S4.T8: headless Chrome — `/next/slots` з блоком стану, без помилок консолі, запити лише на `localhost:3000`.
- 2026-10-09 · Етап 4 · раунд перевірки 1: `architecture-reviewer` — PASS (MINOR: контекст сервісів у фічі `status`); `plan-verifier` — 24 MET, 2 PARTIAL, 2 UNVERIFIABLE (жива перевірка з розширенням). Виправлення (основна сесія):
  - F1.1 — `AppServicesContext` і хуки монітора перенесено в `src/hooks/use-app-services.ts` (спільне для всіх фіч).
  - F1.2 — порожній розклад запитується знову на наступній перевірці (`!scheduleRows.length` у `slots.html`), з тестом.
  - F1.3 — клік по сповіщенню відкриває чернетку або нову заявку (`domain/booking/booking-url.ts`, як `openBookingPage()`).
  - F1.4 — клік будь-де на сторінці розблоковує звук і повідомляє розширенню `audioReady` (`extensionLink.userGesture()`).
  - Назву тесту порядку ефектів узгоджено з кодом (журнал — перед сповіщенням, як у `runCheck()`).
- 2026-10-09 · Етап 4 закрито основною сесією після F1.x (усі тести, typecheck, lint, arch:check). Відкрите: жива перевірка моніторингу на `/next/` з розширенням користувача — потребує Chrome користувача (Claude in Chrome відключено в цій сесії).
- 2026-10-09 · Етап 5 · S5.T0–S5.T10 виконано. Межі історії уніфіковано до `[from, to)` (S5.T9 + основна сесія для `request-log`). Тести після S5.T10: спільний фейк сервісів дає `QueryClientProvider`. S5.T11: збірка, сервер перезапущено; усі `/api/*` відповідають, запис із `token` → 422; сторінка «Моніторинг» у headless Chrome — без помилок, лише запити до `/api`; `pg_dump` робочої бази — 0 збігів токена. Записи з живого моніторингу — після запуску користувачем на `/next/`.
- 2026-10-09 · Етап 5 · раунд перевірки 1: `architecture-reviewer` — PASS; `plan-verifier` — 15 MET, 3 PARTIAL, 3 UNVERIFIABLE (живий моніторинг з розширенням, вимкнення сервера під час моніторингу, `pg_dump` після живої сесії). Виправлення (основна сесія):
  - F2.1 — журнали на «Моніторингу» оновлюються ще й кожні 15 с: записи перевірки доходять на сервер після неї й після відправки черги (до 5 с).
  - F2.2 — `appVersion` з `web/package.json` `version` через `define` у `vite.config.ts`.
  - F2.3 — у журналі резервувань показано консула (`консул 556940f3`), як на знімку.
  - Не виправлялось: рядки подій розширення в журналі перевірок («Розширення вибрало слот») — з'являться з подіями розширення на етапі 7; примітка «9 — новий день за 38 с» на картці резервувань — даних для неї в контракті зведення немає.
- 2026-10-09 · Етап 5 закрито основною сесією після F2.x. Відкрите разом із етапом 4: жива перевірка на `/next/` з розширенням користувача (записи в таблицях, вимкнення сервера, `pg_dump`).
- 2026-10-09 · Етап 6 · S6.T0–S6.T5 виконано; інтеграція основною сесією (фікстура маршрутів з повною установою, `openBooking`/`tabTitleMarks` у тестах). S6.T6: headless Chrome — «Налаштування» без даних і «Слоти» на фікстурі Чикаго (усі запити до e-Consul перехоплені й підмінені фікстурою, `POST /api/*` перехоплені, до сайту й у робочу базу — нічого): календар, панель дня, наступне відкриття, найближчі вільні збігаються зі `slots.png`. Знайдено й виправлено: банер нових слотів показував усі 931 слот — тепер ≤ 4 днів і «…і ще N дн.» (як сповіщення `slots.html`); підказка чернетки посилалась на стару кнопку «Забронювати на e-consul».
- 2026-10-09 · Етап 6 · раунд перевірки 1: `architecture-reviewer` — PASS (2 MINOR); `plan-verifier` — 11 MET, 2 PARTIAL, 1 UNVERIFIABLE (знімки — зроблено основною сесією в S6.T6). Виправлення (основна сесія):
  - F3.1 — запит журналу резервувань — один хук `src/hooks/use-reservations.ts` для «Слотів» і «Моніторингу» (один ключ і форма кешу).
  - F3.2 — `dayTitle` перенесено з компонента в `features/slots/model/day-tiles.ts`, з тестом.
  - F3.3 — підписи як на `settings.png`: «Кожні [60] – [180]», «Дати слотів: не раніше / не пізніше».
- 2026-10-09 · Етап 6 закрито після F3.x (302 тести, typecheck, lint, arch:check).
- 2026-10-09 · Етап 7 · S7.T0–S7.T3 виконано; ключі `payload` вибору слота узгоджено (`date`, `time` — як пише розширення). Сервер перезапущено, `GET /api/extension-events` і `/api/request-log?source=extension` відповідають; `pg_dump` робочої бази — 0 збігів токена.
- 2026-10-09 · Етап 7 закрито: `architecture-reviewer` — PASS, без знахідок; `plan-verifier` — 13 MET, 1 PARTIAL (`selection.stage` — лише `tab-ready`: `econsul:slot-result` приносить тільки підсумок, а підсумок уже пишеться як `selection.selected` / `selection.failed`; проміжні етапи вибору розширення не повідомляє — свідоме відхилення), 3 UNVERIFIABLE (записи після ⟳ розширення 0.4.0, зокрема з закритою вкладкою застосунку — користувач).

## Етап 1 — задачі

### Wave 0 — основна сесія (спільний стан: встановлення, Docker, міграції)

#### S1.T0 — каркас `server/`
- Module: server
- Files (exclusive): `server/package.json`, `server/pnpm-lock.yaml`, `server/pnpm-workspace.yaml`
  (лише `allowBuilds: esbuild`), `server/tsconfig.json`, `server/.gitignore`,
  `server/docker-compose.yml`, `server/drizzle.config.ts`, `server/vitest.config.ts`,
  `server/src/db/**` (схема всіх п'яти таблиць, `client.ts`, міграція `0000_*`),
  `server/src/platform/config.ts`, `server/src/test/**` (окрема база `econsul_test`),
  `server/data/locations.json` (перенесено з кореня), `main.go` (шлях до довідника)
- Результат: `pnpm --dir server run typecheck` чистий; `db:up` + `db:migrate` створюють 5 таблиць.
  Порт Postgres — `127.0.0.1:5433`. Інтеграційні тести (`*.it.test.ts`) пишуть лише в `econsul_test`
  (`createTestDb()` з `src/test/db.ts`, `truncate(...)` у `beforeEach`).

### Wave 1

#### S1.T1 — модуль `schedule-log`: контракт, репозиторій, старий маршрут `POST /schedule-log`
- Module: server
- Depends on: S1.T0
- Files (exclusive):
  - `server/src/contracts/schedule-log.ts` (new)
  - `server/src/modules/schedule-log/client-id.ts`, `client-id.test.ts` (new)
  - `server/src/modules/schedule-log/repository.ts`, `repository.it.test.ts` (new)
  - `server/src/modules/schedule-log/routes.ts`, `routes.test.ts` (new)
- Rules:
  - Сервер ніколи не ходить на e-Consul і не приймає токен; тіло — zod `.strict()`, невідомий ключ відхиляється — security «In this project», fastify «In this project»
  - CRUD-модуль: `routes.ts` → `repository.ts`, без `service.ts`; Drizzle лише в `repository.ts`; маршрут валідує, викликає один метод, повертає 204 — onion-architecture §11
  - Пачка — одна вставка `insert(...).values(rows).onConflictDoNothing({ target: scheduleChanges.clientId })`; кількість вставлених — з `.returning({ id })` — drizzle-orm-patterns «In this project»
  - Репозиторій приймає й повертає типи контракту, не рядки таблиці; дати — `Date` для `timestamptz` — drizzle-orm-patterns «In this project»
  - Записи не змінюються й не видаляються: лише INSERT — postgresql-table-design «In this project»
  - Імпорти з розширенням `.ts` (Node type stripping, `erasableSyntaxOnly`): без `enum`, `namespace`, parameter properties — fastify rules/typescript.md
  - Маршрут — плагін з `FastifyPluginAsyncZod` (`fastify-type-provider-zod` v7), схема в `schema: { body }`; компілятори валідації реєструє `app.ts` (S1.T2), у тестах маршруту — сам тест — fastify rules/schemas.md
  - Тест маршруту — `app.inject()` з фейковим репозиторієм; тест репозиторію — `*.it.test.ts` проти `econsul_test` — onion-architecture §11
- Interface:
  - `scheduleLogEntrySchema` (zod, `.strict()`) і `type ScheduleLogEntry` — exported from `contracts/schedule-log.ts`. Поля — рядок старого `logs/schedule-changes.jsonl`: `time` (ISO), `institutionCode`, `institution`, `type: 'baseline' | 'changed'`, `previousCheckAt?` (ISO), `changes: string[]`
  - `scheduleLogClientId(entry: ScheduleLogEntry): string` — UUID з SHA-256 канонічного JSON запису (ті самі поля в фіксованому порядку → той самий UUID)
  - `interface ScheduleLogRepository { insertMany(entries: ScheduleLogEntry[]): Promise<number> }` і `createScheduleLogRepository(db: Db): ScheduleLogRepository` — повертає кількість реально вставлених
  - `scheduleLogLegacyRoutes: FastifyPluginAsyncZod<{ repository: ScheduleLogRepository }>` — `POST /schedule-log`, тіло — один `ScheduleLogEntry` → 204
- Steps:
  1. Тест: однаковий запис → однаковий UUID; інший `time` → інший UUID; формат UUID.
  2. Тест репозиторію: вставка двох записів → 2; повторна вставка тих самих → 0; `changed` з `previousCheckAt` зберігається.
  3. Тест маршруту: валідне тіло → 204 і виклик репозиторію; зайвий ключ `token` → 4xx і репозиторій не викликано.
- Acceptance criteria:
  - `slots.html` може надсилати той самий `POST /schedule-log`, що й до `main.go`; запис потрапляє в `schedule_changes`
  - повторне надсилання того самого запису не створює дубля
- Verify:
  - `pnpm --dir server exec vitest run src/modules/schedule-log`
  - `pnpm --dir server run typecheck`
- Constraints:
  - Тіло старого запиту (`slots.html`, `saveScheduleLogEntry`): `{ time, institutionCode, institution, type, changes }` плюс `previousCheckAt` для `changed`; `main.go` приймав до 1 МБ

### Wave 2 — паралельно

#### S1.T2 — застосунок Fastify: `app.ts`, `server.ts`, контейнер
- Module: server
- Depends on: S1.T1
- Files (exclusive):
  - `server/src/app.ts`, `server/src/app.test.ts` (new)
  - `server/src/server.ts` (new)
  - `server/src/platform/container.ts` (new)
- Rules:
  - Слухає лише `127.0.0.1` (з `Config`); CORS-плагіна немає — fastify «In this project»
  - Pino `redact: ['req.headers.token', 'req.headers.authorization']` — fastify «In this project»
  - `setValidatorCompiler`/`setSerializerCompiler` з `fastify-type-provider-zod`; помилка валідації тіла → 422 `{ error, issues }`; інша помилка → 500 без стеку й деталей — fastify rules/error-handling.md
  - `bodyLimit` 1 МБ (як `main.go`) — security «In this project» (schedule-log endpoint)
  - Залежності передаються в `buildApp` ззовні; `app.ts` не створює пул бази — composition root у `server.ts` + `platform/container.ts` — onion-architecture §11
  - `server.ts`: graceful shutdown на SIGINT/SIGTERM (закрити app, потім пул) — fastify rules/deployment.md
  - Імпорти з `.ts`, без `enum` — fastify rules/typescript.md
- Interface:
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>`, `interface AppDeps { config: Config; scheduleLog: ScheduleLogRepository; pingDb: () => Promise<void>; logger?: boolean }`
  - `createContainer(config: Config): { scheduleLog: ScheduleLogRepository; pingDb: () => Promise<void>; close: () => Promise<void> }`
- Steps:
  1. Тести `app.inject()` з фейками: `GET /` → `slots.html` (text/html); `GET /locations.json` → JSON довідника; `GET /будь-що-інше` (не `/api`) → `slots.html`, як у `main.go`; `GET /api/health` → 200 `{ status: 'ok', db: 'ok' }`, а коли `pingDb` кидає → 503 `{ status: 'degraded', db: 'down' }`; `POST /schedule-log` з невідомим ключем → 422; невідомий `/api/...` → 404 JSON.
  2. Реалізація; `server.ts` — `loadConfig()`, `createContainer`, `buildApp`, `listen`.
- Acceptance criteria:
  - `pnpm --dir server start` віддає на `http://localhost:3000` те саме, що `main.go`: `slots.html`, `/locations.json`, `POST /schedule-log`
  - Postgres вимкнено → сторінка однаково відкривається, `/api/health` каже `db: 'down'`
- Verify:
  - `pnpm --dir server exec vitest run src/app.test.ts`
  - `pnpm --dir server run typecheck`
- Constraints:
  - `main.go`: `/locations.json` → файл довідника, `POST /schedule-log` → журнал, будь-який інший шлях → `slots.html` — `docs/booking.md` §9
  - Шляхи: `config.repoRoot` (корінь репозиторію, там `slots.html`), `config.locationsPath`

#### S1.T3 — імпорт `logs/schedule-changes.jsonl`
- Module: server
- Depends on: S1.T1
- Files (exclusive):
  - `server/scripts/schedule-log-jsonl.ts`, `server/scripts/schedule-log-jsonl.test.ts` (new)
  - `server/scripts/import-schedule-log.ts` (new)
- Rules:
  - Скрипт — composition root: `loadConfig()`, `createDb`, `createScheduleLogRepository`; розбір — чиста функція без файлів і бази — onion-architecture §11
  - Кожен рядок перевіряється `scheduleLogEntrySchema`; поганий рядок не зупиняє імпорт, а потрапляє у звіт з номером рядка — zod
  - Повторний запуск нічого не дублює (той самий `client_id`) — drizzle-orm-patterns «In this project»
  - Імпорти з `.ts`, без `enum` — fastify rules/typescript.md
- Interface:
  - `parseScheduleLogJsonl(text: string): { entries: ScheduleLogEntry[]; errors: { line: number; message: string }[] }`
- Steps:
  1. Тест розбору: порожні рядки пропускаються; невалідний JSON і запис із зайвим ключем → `errors` з номером рядка; валідні → `entries`.
  2. `import-schedule-log.ts [шлях]` (типово `<repoRoot>/logs/schedule-changes.jsonl`): друкує «прочитано / вставлено / вже було / помилки».
- Acceptance criteria:
  - `pnpm --dir server run import:schedule-log` переносить усі рядки файлу в `schedule_changes`; другий запуск вставляє 0
- Verify:
  - `pnpm --dir server exec vitest run scripts`
  - `pnpm --dir server run typecheck`
- Constraints:
  - Сам імпорт у робочу базу запускає основна сесія, не агент (спільний стан)

### Wave 3 — основна сесія

#### S1.T4 — документація й запуск
- Files: `docs/booking.md` §9, `README.md`, `server/README.md`, `server/CLAUDE.md`, `slots.html`
  (лише підказка «go run main.go» → нова команда), `docs/plans/web-rewrite-plan.md`
- Ручна перевірка: `slots.html` з `localhost:3000` працює як раніше; зміна розкладу з'являється в
  `schedule_changes`.

### Ownership

| Файл | Задача |
|---|---|
| каркас (див. S1.T0) | S1.T0 |
| `server/src/contracts/schedule-log.ts`, `server/src/modules/schedule-log/**` | S1.T1 |
| `server/src/app.ts`, `app.test.ts`, `server.ts`, `platform/container.ts` | S1.T2 |
| `server/scripts/**` | S1.T3 |
| документація, `slots.html` | S1.T4 |

## Етап 2 — задачі

### Wave 0 — основна сесія

#### S2.T0 — каркас `web/` та інструменти
- Module: web (і `server/package.json` — лише dev-залежності)
- Files (exclusive): `web/package.json`, `web/pnpm-lock.yaml`, `web/pnpm-workspace.yaml`,
  `web/tsconfig.json`, `web/vite.config.ts` (`base: '/next/'`, alias `@/` і `@contracts/`, проксі
  `/api` → `:3001`, vitest + jsdom), `web/eslint.config.js` (`no-restricted-globals` /
  `no-restricted-syntax` для `src/domain/**` і `src/application/**`), `web/.dependency-cruiser.cjs`,
  `web/index.html`, `web/src/test/setup.ts`, `web/public/fonts/**` (копії `extension/fonts/`),
  `web/.gitignore`; `server/package.json` (dev: `typescript@^6`, `dependency-cruiser`)
- Рішення: TypeScript 6 в обох модулях — `typescript-eslint` і `dependency-cruiser` ще не працюють з
  TypeScript 7 (немає JS API). Правило `web-does-not-import-server` має виняток для
  `server/src/contracts/` (план §3: `@contracts`).

### Wave 1 — паралельно

#### S2.T1 — токени дизайну й глобальні стилі
- Module: web
- Depends on: S2.T0
- Files (exclusive):
  - `web/src/app/styles/tokens.css` (new)
  - `web/src/app/styles/global.css` (new)
- Rules:
  - Шрифти лише локальні: `@font-face` на `/next/fonts/*.woff2` (Vite `base`) з тими самими `unicode-range`, що в `extension/popup.css` — security «In this project» (third-party code)
  - Кольори, радіуси, тіні — CSS custom properties на `:root`, назви `--color-*`, `--radius-*`, `--shadow-*`, `--font-*`; жодних кольорів-літералів поза `tokens.css` — frontend-ui-architecture §3 (constants)
  - Значення — таблиця «Токени» з `web/docs/design/README.md` дослівно
- Interface (S2.T2 вживає ці змінні):
  - `--color-bg` `#EEF2F7`, `--color-surface` `#FFFFFF`, `--color-text` `#0B1B2B`, `--color-text-muted` `#3E4C5B`, `--color-label` `#4A5868`, `--color-accent` `#0057B8`, `--color-border` `#C5CFDB`, `--color-divider` `#E3E8EF`, `--color-success` / `--color-success-bg`, `--color-danger` / `--color-danger-bg`, `--color-fast` / `--color-fast-bg`, `--color-reserved` `#7D8A99`, `--color-nonworking` `#C9D1DB`, `--radius-card` `12px`, `--shadow-card`, `--font-sans` (Manrope), `--font-mono` (IBM Plex Mono)
- Designs: `web/docs/design/README.md` (Токени), `web/docs/design/slots.png`
- Steps: 1. `tokens.css`; 2. `global.css`: `@font-face`, `body` (тло, шрифт, колір), підпис розділу `.section-label` (капс, 12 px, `letter-spacing .06em`)
- Acceptance criteria: `pnpm --dir web build` збирає шрифти в `dist/fonts`; немає запитів на сторонні домени
- Verify: `pnpm --dir web run build`

#### S2.T2 — маршрутизатор, макет з боковим меню, порожні сторінки
- Module: web
- Depends on: S2.T0 (змінні S2.T1 — за Interface, файл імпортується в `main.tsx`)
- Files (exclusive):
  - `web/src/main.tsx`
  - `web/src/app/router.tsx`, `web/src/app/router.test.tsx` (new)
  - `web/src/app/Layout.tsx`, `web/src/app/Layout.module.css` (new)
  - `web/src/app/providers.tsx` (new — порожній composition root: `AppProviders` з `children`)
  - `web/src/app/pages/SlotsPage.tsx`, `MonitoringPage.tsx`, `SettingsPage.tsx` (new)
- Rules:
  - `react-router` v8, `createBrowserRouter` з `basename: import.meta.env.BASE_URL` (`/next/`); `/` → перенаправлення на `/slots`; невідомий шлях → `/slots` — frontend-ui-architecture «In this project» (routes)
  - Сторінки маршрутів і макет живуть у `src/app/`; фіч ще немає — не створювати `src/features/` — frontend-ui-architecture §2
  - Меню: `NavLink` з активним станом, іконки — inline SVG у компоненті (без бібліотек іконок) — security «In this project» (third-party code)
  - Блок стану в меню на цьому етапі — статичний заглушковий вміст «Моніторинг зупинено» без кнопок дій; справжній блок — етап 4
  - Увесь текст інтерфейсу українською; стилі — CSS-модулі на змінних S2.T1, без кольорів-літералів — web/CLAUDE.md
  - Компоненти — функції, без `React.FC`; без `useEffect` для похідних даних — react-best-practices
  - Тести RTL: запити за роллю (`getByRole('link', { name: 'Слоти' })`, `getByRole('heading')`), `userEvent` для кліків, `createMemoryRouter` з тими самими маршрутами — react-testing-library
- Interface:
  - `routes: RouteObject[]` — exported from `router.tsx` (тести будують на них `createMemoryRouter`)
  - `AppProviders({ children }: { children: ReactNode })` — exported from `providers.tsx`
- Designs: `web/docs/design/slots.png`, `monitoring.png`, `settings.png` (бокове меню: логотип «Монітор слотів», блок стану, пункти «Слоти», «Моніторинг», «Налаштування»)
- Steps:
  1. Тест: `/` → заголовок «Слоти»; клік «Моніторинг» → заголовок «Моніторинг», пункт меню активний (`aria-current="page"`); `/settings` → «Налаштування»; невідомий шлях → «Слоти».
  2. Реалізація.
- Acceptance criteria: `pnpm --dir web build` і в браузері на `/next/` — меню й три порожні сторінки за макетом
- Verify:
  - `pnpm --dir web exec vitest run src/app`
  - `pnpm --dir web run typecheck`, `pnpm --dir web run lint`, `pnpm --dir web run arch:check`

#### S2.T3 — сервер віддає `web/dist` на `/next/`
- Module: server
- Depends on: S2.T0
- Files (exclusive):
  - `server/src/app.ts`, `server/src/app.test.ts`
  - `server/src/platform/config.ts`
- Rules:
  - `@fastify/static` з `root: config.webDistPath` (`<repoRoot>/web/dist`) і `prefix: '/next/'` — лише тека збірки, ніколи корінь репозиторію — server/CLAUDE.md
  - SPA: `GET /next/<шлях без крапки>` → `web/dist/index.html`; відсутній файл з розширенням → 404; `/` і решта шляхів, як і досі, → `slots.html` — fastify «In this project» (one origin)
  - Немає `web/dist` → `/next/` відповідає 404 з підказкою зібрати `web/`, сервер не падає під час старту
  - Імпорти з `.ts`, без `enum` — fastify rules/typescript.md
- Interface: `Config.webDistPath: string`
- Steps: 1. Тест `app.inject()` з тимчасовою текою `dist` (`index.html` + `assets/a.js`): `/next/` і `/next/slots` → `index.html`; `/next/assets/a.js` → файл; `/next/missing.js` → 404; без теки → 404, `/` → `slots.html`. 2. Реалізація.
- Acceptance criteria: після `pnpm --dir web build` сервер віддає новий застосунок на `/next/`, старий — на `/`
- Verify: `pnpm --dir server exec vitest run src/app.test.ts`, `pnpm --dir server run typecheck`

#### S2.T4 — правила архітектури сервера
- Module: server
- Depends on: S2.T0
- Files (exclusive): `server/.dependency-cruiser.cjs` (new), `server/package.json` (лише скрипт `arch:check`)
- Rules (onion-architecture references/enforcement.md, §11):
  - `server-routes-do-not-touch-the-db`: `src/modules/*/routes.ts` ↛ `src/db/**`, `drizzle-orm`
  - `server-services-do-not-know-the-orm`: `src/modules/*/service.ts` ↛ `src/db/**`, `drizzle-orm`
  - `contracts-are-the-core`: `src/contracts/**` ↛ усе, крім себе й `zod`
  - `server-never-calls-econsul`: жоден модуль `src/**` не імпортує HTTP-клієнтів (`undici`, `node-fetch`, `axios`) — і ESLint тут немає, тож у звіті перелічити `grep -rn "e-consul.gov.ua\|fetch(" server/src` як ручну перевірку
  - `no-circular`; `tsPreCompilationDeps: true`; pnpm-шляхи пакетів — `node_modules/<pkg>/` без якоря
- Steps: правила; `pnpm --dir server run arch:check` — чисто; кожне правило доведено тимчасовим файлом-порушником (створити, побачити помилку, видалити) — enforcement.md «Workflow»
- Verify: `pnpm --dir server run arch:check`

### Wave 2 — основна сесія

#### S2.T5 — перевірка етапу
- `pnpm --dir web build`, сервер на вільному порту віддає `/next/` і `/`; знімок `/next/slots` у браузері.
- Правила `web/.dependency-cruiser.cjs` і ESLint доведено файлами-порушниками в `src/domain/`,
  `src/application/`, `src/features/`; файли видалено.
- `web/README.md`, `web/CLAUDE.md` — запуск і команди.

### Ownership

| Файл | Задача |
|---|---|
| каркас (див. S2.T0) | S2.T0 |
| `web/src/app/styles/**` | S2.T1 |
| `web/src/main.tsx`, `web/src/app/{router,Layout,providers}*`, `web/src/app/pages/**` | S2.T2 |
| `server/src/app.ts`, `app.test.ts`, `platform/config.ts` | S2.T3 |
| `server/.dependency-cruiser.cjs`, `server/package.json` (скрипт) | S2.T4 |

## Етап 3 — задачі

Загальне для всіх задач етапу (Module: web):

- **Перенос дослівно.** Тіло функції з `slots.html` переноситься без зміни поведінки; глобальні змінні
  й DOM стають аргументами. Рефакторинг — лише такий, що не змінює результату. Розбіжність з
  `slots.html` — дефект (окрім явно названих тут).
- **Час.** Домен не викликає `Date.now()`, `new Date()` без аргументу, `Math.random()`, таймери.
  Момент — `nowMs: number`; «сьогодні» за часовим поясом браузера — через аргумент
  `localDateKey: (ms: number) => string` (у `slots.html` це `getDateKey(new Date(ms))`); у тестах —
  фіксована функція зі зсувом, напр. `utcOffsetDateKey(-5 * 60)` з `src/domain/slots/time.ts`.
- **Фікстури** — `src/domain/__fixtures__/econsul/*.json` (формат — `web/docs/fixtures.md`;
  `recordedAtMs` — `nowMs`), параметри установ — `../server/data/locations.json` (імпорт JSON у тесті).
  Фікстури не змінювати.
- **Rules для всіх задач:**
  - Домен — чисті функції без React, `fetch`, `window`, `localStorage`, годинника й випадковості; імпорт лише `domain/**` і `zod` — onion-architecture §2, §5 «Domain»
  - Тест на записаних відповідях і фіксованому `nowMs`, один щасливий шлях і межовий випадок — onion-architecture §8
  - Типи з `z.infer`, без `any`; `readonly`-масиви на вході — typescript-expert
  - Імпорти всередині домену — відносні з `.ts`; між кільцями — `@/`
  - Код і коментарі англійською, у стилі `slots.html` (коментар пояснює «чому», як у джерелі)
- **Verify для всіх:** `pnpm --dir web exec vitest run <свої тести>`, `pnpm --dir web run typecheck`,
  `pnpm --dir web run lint`, `pnpm --dir web run arch:check`.
- **Constraints для всіх:** алгоритм — `docs/booking.md` §6–7 дослівно; «Слот `[t, t+i)` зайнятий, якщо
  `t + i > from` і `t < to` для будь-якого блокування»; «Слоти різних консулів незалежні»; горизонт —
  «час відкриття цього дня за `timeZone` установи раніше, ніж `зараз + numberWeeks тижнів − 1 день`».

### Wave 1 — паралельно

#### S3.T1 — контракти e-Consul і довідника
- Files: `web/src/domain/contracts/econsul.ts`, `econsul.test.ts`, `locations.ts`, `locations.test.ts` (new)
- Rules (додатково): схеми відповідей e-Consul — «вільні»: невідомі поля дозволені (`z.looseObject`), бо сайт додає поля без попередження; обов'язкові лише поля, які читає алгоритм — zod; помилки розбору не кидаються з домену — `safeParse` у викликача (етап 4)
- Interface:
  - `scheduleRowSchema`, `type ScheduleRow` — поля: `consulIpnHash: string`, `admissionSchedulePeriodDate?: string | null`, `receptionCitizensTime?: { workingDays: string; workingHoursFrom: string; workingHoursTo: string }[]`, `nonWorkingTime?: { notWorkingDateAndHoursFrom: string; notWorkingDateAndHoursTo: string }[]`, `consularInstitutionService?: { code: string | number }[]`
  - `scheduleResponseSchema` (`{ data: { data: ScheduleRow | null }[] }`), `type ScheduleResponse`
  - `reservedSlotSchema`, `type ReservedSlot` (`consulIpnHash`, `receptionDateAndTimeFrom`, `receptionDateAndTimeTo`); `reservedResponseSchema` (`{ data: { status?: string; reservedSlots: ReservedSlot[] } }`), `type ReservedResponse`
  - `locationsSchema`, `type Locations`, `type Institution` (`code`, `name`, `countryCode`, `country`, `timeZone`, `numberWeeks`, `serviceMinutes: Record<string, number>`), `holidays: { all: string[]; byService: Record<string, string[]> }`, `services: Record<string, string>`
- Steps: тести — три фікстури й `server/data/locations.json` розбираються; рядок без `consulIpnHash` — помилка; зайве поле — не помилка.
- Acceptance: усі записані відповіді й довідник проходять схеми.

#### S3.T2 — час і дати (`time.ts`)
- Files: `web/src/domain/slots/time.ts`, `time.test.ts` (new)
- Interface:
  - `type DateKey = string` ('YYYY-MM-DD'); `addDays(dateKey, days): DateKey`; `minutesToTime(minutes): string`; `parseTimeFromISO(iso): { hours; minutes; totalMinutes }`; `parseDateFromISO(iso): DateKey`
  - `ukrainianDayMap: Readonly<Record<string, number>>`; `dayOfWeek(dateKey): number` (як `new Date(dateKey + 'T12:00:00Z').getUTCDay()`)
  - `utcOffsetDateKey(offsetMinutes: number): (ms: number) => DateKey` — для тестів і для `localDateKey` у фейковому годиннику
  - `consulateOffset(timeZone: string | undefined, sampleIsos: readonly string[], browserOffsetMinutes: number): string` — дослівно `getConsulateOffset()`: `GMT±HH:MM` установи; інакше зсув з першого ISO; інакше зсув браузера
- Steps: тести — перехід через кінець місяця/року в `addDays`; `parseTimeFromISO('2026-10-16T10:30:00.00-06:00')` → 630; `consulateOffset('GMT-06:00', …)` → `-06:00`, без `timeZone` — з ISO, без ISO — з `browserOffsetMinutes`.

#### S3.T3 — контракт протоколу розширення
- Files: `web/src/domain/contracts/extension-messages.ts`, `extension-messages.test.ts` (new)
- Rules (додатково): дискримінований союз за `type` (`z.discriminatedUnion`); дві схеми — вхідні `ext:*` (`source: 'econsul-ext'`) і вихідні `app:*` (`source: 'econsul-app'`); невідомий `type` — помилка розбору (приймач відкидає) — security «In this project» (App ↔ extension messages)
- Interface: `extMessageSchema`, `type ExtMessage`, `appMessageSchema`, `type AppMessage`, `type AppSlot = { date: string; time: string; consulIpnHash?: string }`
- Constraints: усі типи й поля — `extension/plans/extension-plan.md` §8 (усі три таблиці; `ext:booking` замінено на етапі 4 — не включати). Поля, яких таблиця не описує як обов'язкові, — `optional`. Перевірити по `slots.html` (`postToExt`, `onExt*`), які поля реально надсилаються.
- Steps: тести — кожен тип з §8 розбирається; `ext:token` без `token` — помилка; `source: 'econsul-app'` у вхідних — помилка; невідомий тип — помилка.

#### S3.T4 — діапазон дат і нові слоти (`slots-diff.ts`)
- Files: `web/src/domain/monitoring/slots-diff.ts`, `slots-diff.test.ts` (new)
- Interface:
  - `type SlotKey = string` ('YYYY-MM-DD HH:MM'); `type DateRange = { from: string | null; to: string | null }`
  - `inDateRange(slotKey, range): boolean` — `inDateRange()`
  - `diffFreeSlots(input: { free: readonly SlotKey[]; knownFree: ReadonlySet<SlotKey> | null; range: DateRange }): { inRange: SlotKey[]; fresh: SlotKey[]; outside: number; known: Set<SlotKey> }` — блок з `runCheck()` між `getFreeSlotKeys()` і `monitor.knownFree = …` дослівно (`known` — новий `knownFree`, з усіх вільних, не лише в діапазоні)
  - `formatSlotLines(slotKeys): string[]` — дослівно
- Steps: тести — перша перевірка (`knownFree: null`) → усі в діапазоні нові; слот поза діапазоном не стає новим після розширення діапазону (`booking.md` §9 «Моніторинг», п. 6); зник і з'явився — знову новий.

### Wave 2 — паралельно

#### S3.T5 — дні календаря (`schedule-days.ts`)
- Depends on: S3.T1, S3.T2
- Files: `web/src/domain/slots/schedule-days.ts`, `schedule-days.test.ts` (new)
- Interface:
  - `holidaySet(holidays: Locations['holidays'], serviceCode: string): Set<DateKey>` — `getHolidaySet()`
  - `serviceScheduleRows(rows: readonly ScheduleRow[], serviceCode: string): ScheduleRow[]` — `getServiceScheduleRows()`; `serviceConsulHashes(rows, serviceCode): string[]` — `getServiceConsulHashes()`
  - `type ScheduleDay = { dateKey: DateKey; consulIpnHash: string; startMinutes: number; endMinutes: number; display: string }`
  - `type ScheduleInput = { rows: readonly ScheduleRow[]; serviceCode: string; numberWeeks: number; offset: string; holidays: ReadonlySet<DateKey>; localDateKey: (ms: number) => DateKey }`
  - `buildScheduleDays(input: ScheduleInput, nowMs: number): ScheduleDay[]` — дослівно `buildScheduleDays(nowMs)`
- Steps: тести на фікстурі Чикаго з `recordedAtMs`: перший день — завтра; кількість днів і останній день; межа горизонту залежить від часу доби (той самий день з `nowMs` за хвилину до й після часу відкриття — `booking.md` §6 п. 3); свято пропущено; Нью-Йорк — два проміжки на день; послуга, якої консул не надає, — днів немає.

#### S3.T6 — зміни розкладу (`schedule-changes.ts`)
- Depends on: S3.T1
- Files: `web/src/domain/monitoring/schedule-changes.ts`, `schedule-changes.test.ts` (new)
- Interface:
  - `type SnapshotRow = { consul: string; period: string | null; services: string[]; hours: string[]; nonWorking: string[] }`
  - `scheduleSnapshot(rows: readonly ScheduleRow[]): SnapshotRow[]` (вхід — уже розгорнуті `data`, а не вся відповідь)
  - `diffSnapshots(prev: readonly SnapshotRow[], next: readonly SnapshotRow[], todayKey: DateKey): string[]` — дослівно, тексти змін англійською як у `slots.html` (їх читає журнал і база)
- Steps: тести — однакові знімки → `[]`; додано/прибрано рядок розкладу; змінились години; послуги `+`/`-`; минулий неробочий період, що зник, не рахується.

#### S3.T7 — зарезервовані й звільнені слоти (`reserved-diff.ts`, нове — IDEA-004)
- Depends on: S3.T1
- Files: `web/src/domain/monitoring/reserved-diff.ts`, `reserved-diff.test.ts` (new)
- Interface: `diffReserved(prev: readonly ReservedSlot[] | null, next: readonly ReservedSlot[]): { reserved: ReservedSlot[]; released: ReservedSlot[] }` — ключ слота: `consulIpnHash|from|to`; `prev === null` (перша перевірка) → обидва порожні; дублі в одній відповіді враховуються один раз
- Steps: тести на фікстурі (перша відповідь мінус один слот і плюс вигаданий).

#### S3.T8 — інтервал і вікно частих перевірок (`schedule.ts`)
- Depends on: —
- Files: `web/src/domain/monitoring/schedule.ts`, `schedule.test.ts` (new)
- Interface:
  - `FAST_CHECKS = { beforeMs: 120000, afterMs: 180000, minSeconds: 15, maxSeconds: 20 } as const`; `MIN_INTERVAL_SECONDS = 10`; `SCHEDULE_REFRESH_MS = 1800000`; `RELEASE_LOOKAHEAD_DAYS = 8`
  - `type Release = { at: number; opening: string; days: { dateKey: string; display: string }[] }`
  - `clampIntervalBounds(min: number | undefined, max: number | undefined): { min: number; max: number }` — `readIntervalBounds()` без DOM (типово 60–180)
  - `fastWindow(releases: readonly Release[], nowMs: number): { active: Release | null; next: Release | null }` — `getFastWindow()`
  - `planNextCheck(input: { nowMs: number; bounds: { min: number; max: number }; fastChecks: boolean; releases: readonly Release[]; random: () => number }): { delayMs: number; kind: 'scheduled' | 'fast' }` — рішення з `scheduleNextCheck()` дослівно; `random` — порт випадковості (у тесті — фіксовані значення)
- Steps: тести — звичайна затримка в межах; усередині вікна — 15–20 с і `fast`; затримка, що зайшла б за початок вікна, обрізається до `next.at − 2 хв` (не менше 1 с); `fastChecks: false` → завжди звичайна.

### Wave 3 — паралельно

#### S3.T9 — вільні слоти (`free-slots.ts`)
- Depends on: S3.T5
- Files: `web/src/domain/slots/free-slots.ts`, `free-slots.test.ts` (new)
- Interface:
  - `type Blocking = { consulIpnHash: string; from: string; to: string }` (ISO)
  - `collectNonWorking(rows: readonly ScheduleRow[], serviceCode: string): Blocking[]` — `collectNonWorkingSlots()`
  - `type FreeSlots = { byDate: Record<DateKey, { workingHours: string; windows: { from: string; to: string; durationMinutes: number }[] }>; slotConsuls: Record<SlotKey, string[]>; keys: SlotKey[] }`
  - `calculateFreeSlots(input: { days: readonly ScheduleDay[]; nonWorking: readonly Blocking[]; reserved: readonly ReservedSlot[]; slotMinutes: number }): FreeSlots` — `calculateBookableWindows()` + `getFreeSlotKeys()` дослівно (`keys` — у порядку `getFreeSlotKeys()`)
- Steps: тести на трьох фікстурах з `recordedAtMs`: кількість вільних слотів (порахувати один раз і зафіксувати в тесті, перевіривши кілька днів вручну за `booking.md` §7); слот, що перетинає блокування на хвилину, — зайнятий; слот, що не вміщується до кінця прийому, — не вільний; вільний в одного з двох консулів — вільний.

#### S3.T10 — моменти відкриття днів (`releases.ts`)
- Depends on: S3.T5, S3.T8
- Files: `web/src/domain/monitoring/releases.ts`, `releases.test.ts` (new)
- Interface: `upcomingReleases(input: ScheduleInput, nowMs: number): Release[]` — `getUpcomingReleases()` без кешу (кеш — справа застосунку, етап 4): `buildScheduleDays(input, nowMs + RELEASE_LOOKAHEAD_DAYS днів)`, `at = Date.parse(dateKey + 'T' + opening + ':00' + offset) − (numberWeeks × 7 − 1) днів`, відкинуті ті, у кого `at + FAST_CHECKS.afterMs <= nowMs`, згруповані за `at`, без дублів днів
- Steps: тести на фікстурі Чикаго: перший момент — о годині відкриття за `GMT-06:00`, відкривається день через `numberWeeks × 7 − 1` днів (`booking.md` §9 «Відкриття нових днів»: субота 10.10.2026 10:00 CDT відкриває п'ятницю 02.04.2027, якщо фікстура це покриває); у неділю й понеділок моментів немає; Нью-Йорк — два моменти на день.

### Wave 4 — основна сесія

#### S3.T11 — звірка з `slots.html`
- Files: `web/scripts/reconcile-with-slots-html.ts` (new), `web/package.json` (`puppeteer-core`, скрипт `reconcile`)
- Скрипт відкриває `slots.html` з робочого сервера в Chrome користувача (`puppeteer-core`, без
  завантаження браузера), підставляє фікстуру й `Date.now = () => recordedAtMs`, викликає
  `buildScheduleDays`, `calculateBookableWindows`, `getFreeSlotKeys`, `getUpcomingReleases` і
  порівнює з новим доменом на тих самих даних. Запитів до e-Consul немає.
- Результат: для всіх трьох фікстур — однакові дні, вільні слоти й моменти відкриття.

### Ownership

| Файли | Задача |
|---|---|
| `web/src/domain/contracts/econsul*`, `locations*` | S3.T1 |
| `web/src/domain/slots/time*` | S3.T2 |
| `web/src/domain/contracts/extension-messages*` | S3.T3 |
| `web/src/domain/monitoring/slots-diff*` | S3.T4 |
| `web/src/domain/slots/schedule-days*` | S3.T5 |
| `web/src/domain/monitoring/schedule-changes*` | S3.T6 |
| `web/src/domain/monitoring/reserved-diff*` | S3.T7 |
| `web/src/domain/monitoring/schedule.ts`, `schedule.test.ts` | S3.T8 |
| `web/src/domain/slots/free-slots*` | S3.T9 |
| `web/src/domain/monitoring/releases*` | S3.T10 |
| `web/scripts/reconcile-with-slots-html.ts`, `web/package.json` | S3.T11 |

## Етап 4 — задачі

Загальне (Module: web). Поведінка — `slots.html` (`booking.md` §9 «Моніторинг», «Розширення
e-Consul Helper»), перенесена дослівно; тексти журналу й сповіщень — українською (інтерфейс
українською), сенс той самий. Тести не ходять на e-Consul і не бронюють: фейкові порти, фікстури
`src/domain/__fixtures__/econsul/`.

- **Rules для всіх:**
  - Use case бачить лише порти (`src/application/ports.ts`), домен і контракти; жодних браузерних глобалів, `react`, адаптерів — onion-architecture §2, §5 «Application»
  - Адаптер реалізує один порт, не імпортує інших адаптерів, use cases, фіч; спільне — `src/adapters/_shared/` — onion-architecture §5 «Infrastructure»
  - Токен живе лише в пам'яті монітора; адаптер `econsul-api` кладе його в заголовок `token` лише до `https://my.e-consul.gov.ua`; токен не потрапляє в журнал, `console`, помилки, URL, `localStorage`, тести-знімки — security «In this project»
  - `postMessage` — лише з цільовим `window.location.origin`; приймач перевіряє `event.source === window`, `event.origin`, `source: 'econsul-ext'` і розбирає контрактом — security «In this project»
  - Порядок ефектів у перевірці — як у `runCheck()`: запит → розрахунок → новий стан → сповіщення → розширення → журнал → наступна перевірка — onion-architecture §6
  - Тести use cases — фейкові порти й фейковий `Scheduler`/`Clock`/`Random`; тести адаптерів — jsdom і фейковий `fetch`; компоненти — RTL над фейковим монітором — onion-architecture §8, react-testing-library
  - Імпорти між кільцями — `@/…`, усередині кільця — відносні з `.ts`
- **Verify для всіх:** свої тести + `pnpm --dir web run typecheck`, `lint`, `arch:check`.

### Wave 0 — основна сесія

#### S4.T0 — порти й помилки
- Files: `web/src/application/ports.ts`, `web/src/domain/contracts/errors.ts` (готово)
- `EconsulApi`, `ServerApi` (етап 4 — лише `recordScheduleChange`), `LocationsSource`,
  `ExtensionBridge`, `Alerts`, `SettingsStore`, `Clock`, `Random`, `Scheduler`;
  `SessionExpiredError`, `EconsulUnavailableError`, `EconsulSchemaError`.

### Wave 1 — паралельно

#### S4.T1 — адаптер `econsul-api`
- Files: `web/src/adapters/econsul-api/econsul-api.ts`, `econsul-api.test.ts` (new)
- Interface: `createEconsulApi(fetchFn?: typeof fetch): EconsulApi`
- Тіло запиту, заголовки й URL — дослівно `callExternalReader()` (`service: 'e-queue-register'`, методи й фільтри — як у `runCheck()`, `status: [1, 2, 4, 5]`). 401/403 → `SessionExpiredError`; інший не-2xx → `EconsulUnavailableError(status)`; мережа → `EconsulUnavailableError(null)`; відповідь не проходить `scheduleResponseSchema` / `reservedResponseSchema` → `EconsulSchemaError`. Текст помилки не містить токена.
- Steps: тести з фейковим `fetch`: тіло й заголовок; 401 і 403; 500; мережа; кривий JSON; токен не в `message` жодної помилки.

#### S4.T2 — адаптер `extension-bridge`
- Files: `web/src/adapters/extension-bridge/extension-bridge.ts`, `extension-bridge.test.ts` (new)
- Interface: `createExtensionBridge(win?: Window): ExtensionBridge`
- `send` → `win.postMessage({ ...message, source: 'econsul-app' }, win.location.origin)`. `subscribe` — слухач `message` з перевірками (див. Rules) і `extMessageSchema.safeParse`; невалідне — мовчки відкидається.
- Steps: тести jsdom: `ext:hello` доходить; інший `origin`, інше `event.source`, `source: 'econsul-app'`, невідомий `type` — не доходять; `send` ставить `source` і origin; відписка працює.

#### S4.T3 — адаптер `alerts`
- Files: `web/src/adapters/alerts/alerts.ts`, `alerts.test.ts`, `web/src/adapters/alerts/sounds.ts` (new)
- Interface: `createAlerts(win?: Window): Alerts`
- Звуки — дослівно `playTones`, `playSlotSound`, `playSessionSound`, `glassCrash`, `glassTone` (`sounds.ts`, Web Audio, без файлів; «тримати в синхроні з `extension/sounds.js`»). Нотифікації — `showNotification()`: `requireInteraction: true`, `renotify`, `tag` (`slots-found`, `session-expired`), клік → `onClick` або `focus`. `openUrl` — `window.open(url, '_blank', 'noopener')`.
- Steps: тести з фейковими `Notification` і `AudioContext` у jsdom: дозвіл `unsupported`/`denied`/`granted`; без дозволу нотифікація не створюється, але звук грає; `sessionExpired({ notify: false })` — без нотифікації.

#### S4.T4 — адаптери `settings-store`, `browser-runtime`, `locations-source`, `server-api`
- Files: `web/src/adapters/settings-store/settings-store.ts`, `settings-store.test.ts`; `web/src/adapters/browser-runtime/browser-runtime.ts`, `browser-runtime.test.ts`; `web/src/adapters/locations-source/locations-source.ts`, `locations-source.test.ts`; `web/src/adapters/server-api/server-api.ts`, `server-api.test.ts` (new)
- Interface: `createSettingsStore(storage?: Storage): SettingsStore`; `browserClock: Clock`, `browserRandom: Random`, `browserScheduler: Scheduler`; `createLocationsSource(fetchFn?): LocationsSource` (`GET /locations.json`, `locationsSchema`); `createServerApi(fetchFn?): ServerApi` (етап 4: `recordScheduleChange` → `POST /schedule-log`, тіло — `ScheduleLogEntry`, помилки ковтаються)
- Ключі `localStorage` — ті самі, що в `slots.html` (`slots.selection`, `slots.interval`, `slots.dateRange`, `slots.draft`, `slots.schedule.<code>`), формат — той самий JSON; кожне читання й запис — у `try/catch` (сховище недоступне → типові значення). `browserClock.localDateKey` — як `getDateKey(new Date(ms))`.
- Steps: тести: значення, записані у форматі `slots.html`, читаються; кривий JSON → типове; `Storage`, що кидає, не ламає; `server-api` не кидає, коли `fetch` падає.

#### S4.T5 — use cases `run-check.ts` і `monitor.ts`
- Files: `web/src/application/run-check.ts`, `run-check.test.ts`, `web/src/application/monitor.ts`, `monitor.test.ts` (new)
- Джерело: `runCheck()`, `scheduleNextCheck()`, `checkNow()`, `startMonitoring()`, `stopMonitoring()`, `resetMonitorState()`, `recordScheduleSnapshot()`, `getUpcomingReleases()` (кеш — переобчислення після кожного оновлення розкладу), `alertSlots()`, `alertSession()`, `inDateRange()`; тексти журналу — українською з тим самим змістом (`Перевірка #12 (часта)`, `Відновлено після входу`, `Зупинено: …`).
- Interface (exported from `monitor.ts`; S4.T6 і S4.T7 будують на ньому):
  ```ts
  export type StopCause = 'user' | 'session' | 'other';
  export type CheckKind = 'scheduled' | 'fast' | 'manual';
  export type MonitorLogEntry = { at: number; message: string; kind: 'info' | 'found' | 'warn' | 'error' };
  export type MonitorState = {
      locations: Locations | null;
      selection: { institution: Institution; serviceCode: string } | null;
      hasToken: boolean;
      running: boolean; checking: boolean; checks: number;
      nextAt: number; nextKind: 'scheduled' | 'fast';
      lastResult: string; stoppedBy: StopCause | null;
      interval: { min: number; max: number }; fastChecks: boolean; dateRange: DateRange;
      schedule: { rows: ScheduleRow[]; fetchedAt: number } | null;
      reserved: ReservedSlot[] | null;
      free: FreeSlots | null;
      releases: Release[];
      outOfRange: { dropped: number; total: number; at: number } | null;
      lastFresh: SlotKey[];
      log: MonitorLogEntry[]; // newest first, at most 100
  };
  export type MonitorEvents = {
      newSlots: (fresh: SlotKey[], free: FreeSlots) => void;   // after the alert, for app:slots
      authFailed: (status: number, token: string) => void;      // for app:auth-failed
      changed: () => void;                                       // after every state change
  };
  export interface Monitor {
      getState(): MonitorState;
      subscribe(listener: () => void): () => void;              // useSyncExternalStore
      on<K extends keyof MonitorEvents>(event: K, listener: MonitorEvents[K]): () => void;
      init(): Promise<void>;                                    // loads locations and saved settings
      start(options?: { resumed?: boolean }): Promise<void>;
      stop(reason: string, cause: StopCause): void;
      checkNow(): Promise<void>;
      setToken(token: string, source: 'extension' | 'manual'): void; // resumes after 'session' stop
      sessionLost(reason: string): void;                        // ext:auth loggedIn: false
      setSelection(institutionCode: string, serviceCode: string): void;
      setInterval(bounds: { min: number; max: number }): void;
      setFastChecks(enabled: boolean): void;
      setDateRange(range: DateRange): void;
      log(message: string, kind?: MonitorLogEntry['kind']): void;
      dispose(): void;
  }
  export function createMonitor(deps: {
      econsul: EconsulApi; server: ServerApi; locations: LocationsSource; settings: SettingsStore;
      alerts: Alerts; clock: Clock; random: Random; scheduler: Scheduler;
      extensionConnected: () => boolean;   // alertSession(): notification only without the extension
      openBooking: () => void;             // click on the new-slots notification
  }): Monitor;
  ```
  `run-check.ts` — одна перевірка як функція над станом і портами (`runCheck(context, kind)`), без таймерів; `monitor.ts` — стан, таймери через `Scheduler`, планування через `planNextCheck`, події.
- Steps (тести з фейковим часом і фейковим `EconsulApi` на фікстурах):
  1. Перша перевірка: розклад + зайняті; далі розклад — раз на 30 хв (`SCHEDULE_REFRESH_MS`), між ними — лише зайняті.
  2. Нові слоти: перша перевірка — усі в діапазоні нові; наступна — лише нові; сповіщення й `newSlots` лише коли є нові; поза діапазоном — не нові.
  3. Вікно частих перевірок: усередині — затримка 15–20 с і `kind: 'fast'`; затримка, що зайшла б у вікно, обрізається.
  4. 401 → зупинка з `stoppedBy: 'session'`, `sessionExpired`, `authFailed(401, token)`; `setToken` → `Відновлено після входу`, наступна перевірка йде, `knownFree` збережено.
  5. Зупинка кнопкою (`'user'`) → `setToken` не відновлює.
  6. 500 → запис у журнал, моніторинг триває.
  7. Зміна установи → стан скинуто, наступна перевірка знову бере розклад.
  8. Зміна розкладу → `recordScheduleChange` з `baseline`, потім `changed`; знімок у `SettingsStore`.

### Wave 2 — паралельно

#### S4.T6 — use case `extension-link.ts`
- Depends on: S4.T5
- Files: `web/src/application/extension-link.ts`, `extension-link.test.ts` (new)
- Interface: `type ExtensionState = { connected: boolean; version: string | null; auth: { loggedIn: boolean | null; exp: number | null; reason: string | null } | null; autoBook: boolean; draft: Draft | null }`; `createExtensionLink(deps: { bridge: ExtensionBridge; monitor: Monitor; settings: SettingsStore; alerts: Alerts; clock: Clock; scheduler: Scheduler }): { getState(): ExtensionState; subscribe(l: () => void): () => void; start(): void; dispose(): void; login(): void; setAutoBook(on: boolean): void; testSound(kind: 'selected' | 'mute' | 'slots'): void }`
- Джерело: `extHello()` (кожні 15 с, тайм-аут 3 с), `reportMonitor()`, `reportSelection()`, `sendSlotsToExtension()` (на `monitor.on('newSlots')`, `consulIpnHash` — перший з `slotConsuls`, без поля, якщо немає), `onExtAuth()`, `onExtToken()` (+ `app:received`), `onExtDraft()` (+ `app:received`, `SettingsStore.saveDraft`), `ext:settings`, `ext:slot-*` → `monitor.log`, `app:auth-failed` на `monitor.on('authFailed')` (`soundPlayed: true`), `app:login`, `testExtension()`.
- Steps: тести з фейковим мостом і фейковим монітором: перший `ext:hello` → `connected`, `app:hello` + `app:selection` + `app:monitor`; немає відповіді 3 с → `connected: false`; `ext:token` після зупинки через сесію → `monitor.setToken`; `ext:auth { loggedIn: false }` → `monitor.sessionLost`; нові слоти → `app:slots` з діапазоном.

#### S4.T7 — блок стану в меню й composition root
- Depends on: S4.T5 (S4.T6 — за Interface)
- Files: `web/src/features/status/StatusBlock.tsx`, `StatusBlock.module.css`, `StatusBlock.test.tsx`, `web/src/features/status/use-monitor.ts`, `web/src/features/status/index.ts` (new); `web/src/app/providers.tsx`, `web/src/app/Layout.tsx`, `web/src/app/Layout.module.css`
- Rules (додатково):
  - `useSyncExternalStore` над `monitor.subscribe` / `getState` і так само для `extensionLink`; жодної копії стану в `useState` — frontend-ui-architecture «In this project», react-best-practices
  - Залежності — через React context з `providers.tsx`; фіча отримує монітор з контексту, не імпортує адаптери — onion-architecture §2 (composition root)
  - `providers.tsx` — єдине місце, що створює адаптери й use cases, викликає `monitor.init()` і `extensionLink.start()` (один раз, не в `StrictMode`-подвоєнні) — onion-architecture §5 «Composition root»
  - Відлік до наступної перевірки — тік раз на секунду через `useSyncExternalStore` над годинником, а не `setInterval` у `useEffect` з копією стану — react-best-practices
  - Стилі — змінні токенів; активний пункт меню — світло-синій за макетом (новий токен `--color-accent-bg` у `Layout.module.css` через `color-mix` від `--color-accent`, без нового літерала)
- Designs: `web/docs/design/slots.png` (блок стану: «Моніторинг працює», «Наступна перевірка за 0:42», «Сесія до 08:41 завтра» зі смужкою, «✓ Розширення підключено», кнопки «Зупинити» / «Перевірити»; у зупиненому стані — «Запустити»)
- Steps: RTL з фейковим монітором: зупинено → «Запустити»; клік → `start`; працює → «Зупинити», відлік; перевірка йде → «Перевірити» неактивна; розширення ✓/✗; без установи — підказка «Виберіть установу в налаштуваннях».
- Acceptance: на `/next/` моніторинг запускається з меню й працює з токеном від розширення.

### Wave 3 — основна сесія

#### S4.T8 — ручна перевірка
- `pnpm --dir web build`, перезапуск сервера. Вкладку `slots.html` закрити (одночасно — лише один
  застосунок). На `/next/` з токеном від розширення — моніторинг вибраної установи; результат
  першої перевірки порівняти з тим, що показує `slots.html` на тих самих даних (через `reconcile`
  або другою перевіркою на `/`). Запитів — як у звичайного моніторингу.

### Ownership

| Файли | Задача |
|---|---|
| `web/src/application/ports.ts`, `web/src/domain/contracts/errors.ts` | S4.T0 |
| `web/src/adapters/econsul-api/**` | S4.T1 |
| `web/src/adapters/extension-bridge/**` | S4.T2 |
| `web/src/adapters/alerts/**` | S4.T3 |
| `web/src/adapters/{settings-store,browser-runtime,locations-source,server-api}/**` | S4.T4 |
| `web/src/application/{run-check,monitor}*` | S4.T5 |
| `web/src/application/extension-link*` | S4.T6 |
| `web/src/features/status/**`, `web/src/app/{providers.tsx,Layout.tsx,Layout.module.css}` | S4.T7 |

## Етап 5 — задачі

Загальне. Контракти API (`server/src/contracts/{common,request-log,checks,reservation-log,schedule-log,summary}.ts`)
і порти `web` (`ServerApi` з `recordRequest` / `recordCheck` / `recordReservations`, `LogHistory`,
`Ids`, `AppSession`, `RequestMeta` у `EconsulApi`) — готові (S5.T0); задачі будують на них і не
змінюють їх. Таблиці вже є (етап 1); тип `monitor_checks.new_slots` — `{ date, time, consulIpnHash }[]`
(лише тип jsonb, без міграції).

- **Rules для задач `server`:**
  - Модуль CRUD: `routes.ts` → `repository.ts`, без `service.ts`; Drizzle лише в `repository.ts`; маршрут — плагін `FastifyPluginAsyncZod<{ repository }>`, схеми з контрактів — onion-architecture §11
  - `POST` — пачка з контракту (`batchOf`, `.strict()`), одна вставка `insert(...).values(rows).onConflictDoNothing({ target: <table>.clientId })`, 204 — drizzle-orm-patterns «In this project»
  - `GET` — фільтри з контракту, нові зверху (`ORDER BY id DESC`), `before` → `id < before`, `limit`; `nextCursor` — найменший `id` сторінки, якщо сторінка повна, інакше `null`; відповідь — контрактний тип (дати — ISO-рядки, не `Date`) — fastify «In this project»
  - Лише INSERT і SELECT; без колонок і полів для токена, заголовків, тіл відповідей — postgresql-table-design «In this project», security
  - Тести: репозиторій — `*.it.test.ts` проти `econsul_test` (`createTestDb()`, `truncate` у `beforeEach`); маршрут — `app.inject()` з фейковим репозиторієм (компілятори zod у тесті); зайвий ключ `token` → 4xx — onion-architecture §11
  - Імпорти з `.ts`, без `enum` — fastify rules/typescript.md
- **Rules для задач `web`:** як у етапі 4 («Загальне»); запис у журнали ніколи не кидає й не гальмує моніторинг; токен не потрапляє в жоден запис.
- **Verify:** свої тести + typecheck, lint (web), arch:check свого модуля.

### Wave 0 — основна сесія

#### S5.T0 — контракти API, порти, залежності
- Files: `server/src/contracts/**`, `server/src/db/schema/monitor-checks.ts` (тип jsonb), `web/src/application/ports.ts`, `web/package.json` (`@tanstack/react-query`)

### Wave 1 — паралельно

#### S5.T1 — модуль `request-log`
- Module: server · Files: `server/src/modules/request-log/{repository.ts,repository.it.test.ts,routes.ts,routes.test.ts}` (new)
- Interface: `createRequestLogRepository(db: Db): RequestLogRepository` (`insertMany(entries: RequestLogEntry[]): Promise<number>`, `list(query: RequestLogQuery): Promise<Page<StoredRequestLogEntry>>`); `requestLogRoutes: FastifyPluginAsyncZod<{ repository: RequestLogRepository }>` — `POST /api/request-log`, `GET /api/request-log`
- Steps: тести — вставка й повтор (0); фільтри `method`, `outcome`, `source`, `from`/`to`, курсор; `network_error` з `httpStatus: null` зберігається (CHECK у таблиці).

#### S5.T2 — модуль `checks`
- Module: server · Files: `server/src/modules/checks/{repository.ts,repository.it.test.ts,routes.ts,routes.test.ts}` (new)
- Interface: `createChecksRepository(db)` (`insertMany(entries: CheckEntry[])`, `list(query: CheckQuery)`); `checksRoutes` — `POST /api/checks`, `GET /api/checks` (`kind`, `outcome`, `onlyNew` → `new_count > 0`)
- Steps: тести — вставка/повтор; фільтри; `onlyNew`.

#### S5.T3 — модуль `reservation-log`
- Module: server · Files: `server/src/modules/reservation-log/{repository.ts,repository.it.test.ts,routes.ts,routes.test.ts}` (new)
- Interface: `createReservationLogRepository(db)` (`insertMany(events: ReservationEvent[])`, `list(query: ReservationQuery)`); `reservationLogRoutes` — `POST /api/reservation-log`, `GET /api/reservation-log`

#### S5.T4 — `schedule-log`: API-маршрути й JSONL
- Module: server · Files: `server/src/modules/schedule-log/{repository.ts,repository.it.test.ts,routes.ts,routes.test.ts}`
- Interface (додатково до наявного): `ScheduleLogRepository.list(query: HistoryQuery): Promise<Page<StoredScheduleLogEntry>>`, `listAll(): AsyncIterable<ScheduleLogEntry>` або `Promise<ScheduleLogEntry[]>` (за зростанням `checked_at`); `scheduleLogApiRoutes: FastifyPluginAsyncZod<{ repository }>` — `POST /api/schedule-log` (пачка), `GET /api/schedule-log`, `GET /api/schedule-log.jsonl` (`application/x-ndjson`, по рядку на запис у форматі старого `logs/schedule-changes.jsonl`, `Content-Disposition: attachment; filename="schedule-changes.jsonl"`). Старий `scheduleLogLegacyRoutes` лишається до етапу 8.

#### S5.T5 — модуль `summary`
- Module: server · Files: `server/src/modules/summary/{repository.ts,repository.it.test.ts,routes.ts,routes.test.ts}` (new)
- Interface: `createSummaryRepository(db): { summary(query: SummaryQuery): Promise<Summary> }`; `summaryRoutes` — `GET /api/summary?from&to[&institutionCode]`
- Підрахунок — SQL (`count(*) FILTER (WHERE …)`, `sum(new_count)`, `max(started_at) FILTER (WHERE new_count > 0)`) над `monitor_checks` і `reservation_events` у межах `[from, to)`; без читання рядків у JS.

#### S5.T6 — адаптери `server-api` (пачки) і `log-history`, `browserIds`
- Module: web · Files: `web/src/adapters/server-api/{server-api.ts,server-api.test.ts}`, `web/src/adapters/log-history/{log-history.ts,log-history.test.ts}` (new), `web/src/adapters/browser-runtime/{browser-runtime.ts,browser-runtime.test.ts}`
- Interface: `createServerApi(deps?: { fetchFn?; scheduler?: Scheduler; flushMs?: number; maxQueued?: number }): ServerApi & { flush(): Promise<void> }`; `createLogHistory(fetchFn?): LogHistory`; `browserIds: Ids` (`crypto.randomUUID()`)
- Черга на кожен журнал; відправка пачками ≤ 100 на `POST /api/<журнал>` кожні `flushMs` (типово 5 с) і одразу, коли назбиралось 20; 204 → прибрати; 503/мережа → лишити й повторити пізніше (подвоєння інтервалу до 60 с); 4xx (не 503) → викинути пачку й `console.warn` без вмісту; межа черги `maxQueued` (типово 2000 на журнал) — найстаріші відкидаються. `recordScheduleChange` → `POST /api/schedule-log` (пачка), більше не `/schedule-log`.
- Steps: тести з фейковим `fetch` і фейковим `Scheduler`: пачкування; повтор після 503 і після помилки мережі; межа черги; 422 не повторюється; жоден запис не містить `token`.

#### S5.T7 — адаптер `request-log` (обгортка `EconsulApi`)
- Module: web · Files: `web/src/adapters/request-log/{request-log.ts,request-log.test.ts}` (new)
- Interface: `withRequestLog(api: EconsulApi, deps: { server: ServerApi; clock: Clock; ids: Ids; session: AppSession }): EconsulApi`
- Кожен виклик → `server.recordRequest`: `service: 'e-queue-register'`, `method`, `institutionCode`, `filters` (без токена: `{ institutionCode }` або `{ institutionCode, status, consulIpnHash }`), `startedAt`, `durationMs` (з `clock`), `httpStatus` (успіх → 200; `SessionExpiredError` / `EconsulUnavailableError` → їхній `status`; мережа → `null`), `outcome` (`ok`, `session_expired`, `unavailable`, `schema_error`, `network_error`), `itemsCount` (рядків розкладу / зайнятих слотів), `responseBytes: null`, `checkKind` / `checkSeq` з `meta`, `source: 'app'`, `errorMessage` (≤ 500 символів, без токена). Результат і помилка проходять далі без змін. Обгортка імпортує лише порт `EconsulApi`, не адаптер `econsul-api` — onion-architecture §2 (виняток `request-log`).
- Steps: тести — успіх; 401; 500; мережа; схема; токен не в записі.

#### S5.T8 — монітор пише перевірки й резервування
- Module: web · Files: `web/src/application/{run-check.ts,run-check.test.ts,monitor.ts,monitor.test.ts}`
- Interface: `createMonitor` deps — додатково `ids: Ids; session: AppSession`; виклики `EconsulApi` — з `meta: { checkKind, checkSeq }`
- Кожна перевірка → `server.recordCheck` (успіх і помилка; `newSlots` — `{ date, time, consulIpnHash }` з `slotConsuls`; `outOfRangeCount`; `durationMs` з `clock`). Зайняті слоти між двома перевірками однієї установи → `diffReserved` → `server.recordReservations` (`previousCheckAt` — час попередньої перевірки, `detectedAt` — поточної); зміна установи скидає попередні.
- Steps: тести — запис перевірки (успіх, 500, 401); резервування на другій перевірці; перша перевірка — без резервувань; зміна установи — без хибних резервувань.

### Wave 2

#### S5.T9 — підключення модулів сервера
- Module: server · Depends on: S5.T1–S5.T5 · Files: `server/src/app.ts`, `server/src/app.test.ts`, `server/src/platform/container.ts`
- `AppDeps` — репозиторії всіх модулів; реєстрація маршрутів; `GET /api/locations` (файл довідника); помилка підключення до бази (`ECONNREFUSED`, `57P01`, `08*`) у будь-якому `/api` → 503 `{ error: 'Database unavailable' }`. Тести — `app.inject()` з фейками: маршрути відповідають; база недоступна → 503.

#### S5.T10 — сторінка «Моніторинг» і composition root
- Module: web · Depends on: S5.T6–S5.T8 · Files: `web/src/features/monitoring/**` (new), `web/src/app/pages/MonitoringPage.tsx`, `web/src/app/providers.tsx`, `web/src/hooks/use-app-services.ts`, `web/src/test/fake-services.tsx`
- Rules (додатково): дані сервера — TanStack Query (`QueryClientProvider` у `providers.tsx`), ключі за фільтрами й лічильником перевірок монітора (`checks`), щоб нова перевірка оновлювала журнали; не копіювати в `useState` — frontend-ui-architecture «In this project»; `LogHistory` — у `AppServices`; помилка сервера — повідомлення в картці, сторінка працює
- Designs: `web/docs/design/monitoring.png` (зведення за день: перевірок / нових вільних / резервувань / скасувань; журнал перевірок з фільтрами «Усі», «Нові слоти», «Помилки», «Часті»; журнал резервувань; зміни розкладу з «Завантажити JSONL»)
- Composition: `withRequestLog(createEconsulApi(), …)`, `createServerApi({ scheduler })`, `browserIds`, `session` (`tabSessionId` — `browserIds.uuid()` раз на вкладку, `appVersion` — `import.meta.env` / `package.json` `version`)
- Steps: RTL з фейковим `LogHistory`: картки зведення; фільтр «Нові слоти» → запит з `onlyNew`; помилка сервера → повідомлення; посилання JSONL.

### Wave 3 — основна сесія

#### S5.T11 — перевірка
- Збірка, перезапуск сервера; записи з'являються в таблицях після моніторингу на `/next/`
  (потребує токена від розширення — разом із користувачем); сервер зупинено → моніторинг триває,
  записи доходять після запуску; `pg_dump` робочої бази без рядка токена.

### Ownership

| Файли | Задача |
|---|---|
| `server/src/contracts/**`, `web/src/application/ports.ts` | S5.T0 |
| `server/src/modules/request-log/**` | S5.T1 |
| `server/src/modules/checks/**` | S5.T2 |
| `server/src/modules/reservation-log/**` | S5.T3 |
| `server/src/modules/schedule-log/**` | S5.T4 |
| `server/src/modules/summary/**` | S5.T5 |
| `web/src/adapters/{server-api,log-history,browser-runtime}/**` | S5.T6 |
| `web/src/adapters/request-log/**` | S5.T7 |
| `web/src/application/{run-check,monitor}*` | S5.T8 |
| `server/src/app.ts`, `app.test.ts`, `platform/container.ts` | S5.T9 |
| `web/src/features/monitoring/**`, `MonitoringPage.tsx`, `providers.tsx`, `hooks/use-app-services.ts`, `test/fake-services.tsx` | S5.T10 |

## Етап 6 — задачі

Загальне (Module: web). Сторінки — за знімками `web/docs/design/{slots,settings}.png` і
`Main.dc.html` (там же сценарії «Tweaks»: звичайний, сесія скінчилась, нові слоти, установу не
вибрано; розширення підключене чи ні). Дані — зі стану монітора й розширення (`useMonitorState`,
`useExtensionState` з `src/hooks/use-app-services.ts`) і з `LogHistory` (TanStack Query, як на
сторінці «Моніторинг»). Фічі не імпортують одна одну; спільне — `src/hooks/`, `src/components/`
(нове, для дрібних спільних елементів: картка, підпис розділу, кнопка).

- **Rules для всіх:**
  - Розрахунки для показу (сітка місяця, плитки дня, «найближчі вільні», текст підказки чернетки) — чисті функції в `features/<f>/model/*.ts` з тестами; компоненти лише показують — frontend-ui-architecture §4
  - Компоненти — функції без `React.FC`; без `useEffect` для похідних даних; стан фільтрів і вибраного дня — `useState` у компоненті, дані — лише з монітора/запитів — react-best-practices
  - Стилі — CSS-модулі на змінних `tokens.css`, без кольорів-літералів; тексти — українською як на знімках — web/CLAUDE.md
  - Тести RTL — запити за роллю/текстом, `userEvent`, фейкові сервіси (`src/test/fake-services.tsx`) — react-testing-library
  - Дії, що змінюють налаштування, йдуть через методи монітора / зв'язку з розширенням (порти), а не в `localStorage` напряму — onion-architecture §2
- **Verify:** свої тести + typecheck, lint, arch:check.

### Wave 0 — основна сесія

#### S6.T0 — порт налаштувань: мітка заголовка вкладки
- Files: `web/src/application/ports.ts` (`SettingsStore.loadTabTitleMarks(): boolean` (типово `true`) / `saveTabTitleMarks(on)`, ключ `slots.tabTitleMarks`)

### Wave 1 — паралельно

#### S6.T1 — use cases для налаштувань
- Files: `web/src/application/{monitor.ts,monitor.test.ts,run-check.ts,run-check.test.ts,extension-link.ts,extension-link.test.ts}`, `web/src/adapters/settings-store/{settings-store.ts,settings-store.test.ts}`
- Interface (додатково; S6.T4 будує на ньому):
  - `MonitorState.tabTitleMarks: boolean`; `Monitor.setTabTitleMarks(on: boolean): void` — збережено в `SettingsStore`; коли вимкнено — заголовок вкладки не змінюється (`run-check`, `extension-link`, `start`)
  - `Monitor.notificationPermission(): NotificationPermissionState`, `Monitor.requestNotifications(): Promise<NotificationPermissionState>`, `Monitor.audioReady(): boolean`
  - `Monitor.testAlert(kind: 'slots' | 'session'): Promise<void>` — дослівно `testAlert()` (`unlockAudio`, запит дозволу, `alertSlots` з двома вигаданими слотами `2027-03-31 09:50`, `10:10` / `alertSession`, повернення заголовка через 5 с)
  - `ExtensionLink.setDraftUrl(url: string): void` — дослівно `saveDraftUrl()` (порожнє → видалити; новий URL → `{ url, savedAt: now }`), оновлює `ExtensionState.draft`; `ExtensionState.draft` при старті — з `SettingsStore`
- Steps: тести — `setTabTitleMarks(false)` → нові слоти не змінюють заголовок; `testAlert('slots')` → сповіщення з двома слотами; `setDraftUrl` — збереження й очищення.

#### S6.T2 — «Слоти»: наступне відкриття й найближчі вільні
- Files: `web/src/features/slots/{NextOpening.tsx,NextOpening.module.css,NextOpening.test.tsx,NearestFree.tsx,NearestFree.module.css,NearestFree.test.tsx}`, `web/src/features/slots/model/{releases-view.ts,releases-view.test.ts,nearest-free.ts,nearest-free.test.ts}` (new)
- «Наступне відкриття»: момент (день тижня, дата, час браузера), час консульства з `GMT±`, який день відкривається і скільки слотів, відлік (`useNowSeconds`), «Часті перевірки HH:MM–HH:MM» (вікно `FAST_CHECKS`), «Далі: …» (ще 2 моменти); дані — `state.releases` + `fastWindow`. «Найближчі вільні»: до 4 днів із вільними слотами в діапазоні дат (`inDateRange`), час — моно, «у діапазоні DD.MM–DD.MM», кнопка «Відкрити чернетку» → `openBooking()` з `AppServices` (поле додає S6.T3)
- Interface: `AppServices.openBooking: () => void` (додає S6.T3)
- Порожні стани: розклад ще не завантажено; немає вільних у діапазоні.

#### S6.T3 — «Слоти»: календар, панель дня, сторінка
- Files: `web/src/features/slots/{Calendar.tsx,Calendar.module.css,Calendar.test.tsx,DayPanel.tsx,DayPanel.module.css,DayPanel.test.tsx,SlotsView.tsx,SlotsView.module.css,index.ts}`, `web/src/features/slots/model/{month-grid.ts,month-grid.test.ts,day-tiles.ts,day-tiles.test.ts}` (new), `web/src/app/pages/SlotsPage.tsx`, `web/src/hooks/use-app-services.ts`, `web/src/app/providers.tsx`, `web/src/test/fake-services.tsx`
- Календар місяця (пн–нд): у клітинці — число вільних (синій кружок) або «немає», смужка зайнятих/неробочих (частка від усіх слотів дня), приглушені дні поза діапазоном дат, дні за межею горизонту — «ще не відкрито» (пунктир), вихідні без прийому — без клітинки-картки; навігація місяцями; легенда; підсумок «Вільних у діапазоні: N · поза діапазоном: N · зайнятих: N · неробочих проміжків: N · відкриті дні DD.MM.YYYY–DD.MM.YYYY». Панель дня: заголовок дати, «Прийом HH:MM–HH:MM · N вільних · N зайнятих · N неробочих», плитки слотів (вільний — синя рамка, зайнятий — сірий закреслений, неробочий — пунктир), «Неробочий час: …», «Нещодавні резервування» (з `LogHistory.reservations` для установи, слоти цього дня), «Відкрити чернетку», підказка про чернетку з `ExtensionState.draft`.
- `model/day-tiles.ts` — плитки дня з тих самих даних, що й розрахунок вільних (`buildScheduleDays`, `collectNonWorking`, зайняті з `state.reserved`, перетин — як у `calculateFreeSlots`).
- Interface: `AppServices.openBooking: () => void` (у `providers.tsx` — `alerts.openUrl(bookingUrl(settings.loadDraft()?.url ?? null))`, як `openBooking` монітора)

#### S6.T4 — «Налаштування»
- Depends on: S6.T1 (за Interface)
- Files: `web/src/features/settings/**` (new), `web/src/app/pages/SettingsPage.tsx`
- Секції за знімком: «Що шукаємо» (країна → установа → послуга з `state.locations`, як `fillCountries/fillInstitutions/fillServices`; рядок параметрів як `renderLocationParams`; дати «не раніше / не пізніше» + «Очистити»; підказка про діапазон як `renderDateRangeHint`), «Сесія» (стан входу й «токен ще N год M хв» зі смужкою; «Ввести вручну» → поле токена → `monitor.setToken(token, 'manual')`; поле `type="password"`, значення не показується після введення), «Перевірки» (межі інтервалу, мін. 10 с; «Часті перевірки…»), «Бронювання» (посилання на чернетку → `extensionLink.setDraftUrl`; підказка як `renderDraftHint`; «Бронювати автоматично» → `extensionLink.setAutoBook`, неактивне без розширення), «Сповіщення» (дозвіл браузера, звук на вкладці, мітка заголовка, тестові кнопки → `monitor.testAlert`, `extensionLink.testSound`; підпис «Тестові слоти розширення ніколи не бронює»).
- Steps: RTL: зміна установи → `setSelection`; інтервал → `setInterval` з обмеженням ≥ 10; дати → `setDateRange`; «Очистити»; ручний токен; чернетка; автобронювання вимкнене без розширення.

#### S6.T5 — глобальні банери, порожній стан, бейдж меню
- Files: `web/src/features/banners/**` (new), `web/src/app/Layout.tsx`, `web/src/app/Layout.module.css`, `web/src/app/router.test.tsx`
- Банери над сторінкою (як у `renderExtStatus` і сценаріях «Tweaks»): «Увійдіть на e-consul. Моніторинг продовжиться сам.» / «… Токен прийде сюди сам.» з «Увійти» (`extensionLink.login()`); «Сесія скінчиться о HH:MM…» (менше 30 хв); «Нові слоти: …» з «Відкрити чернетку» (`openBooking`) і закриттям. Порожній стан на «Слотах» і «Моніторингу», коли установу не вибрано: «Виберіть установу в налаштуваннях» з посиланням. Бейдж «N нові» біля «Моніторинг» — кількість `state.lastFresh`.
- Steps: RTL-тести на кожен сценарій «Tweaks» (звичайний, сесія скінчилась, нові слоти, установу не вибрано; розширення є/немає).

### Wave 2 — основна сесія

#### S6.T6 — порівняння зі знімками
- Збірка, headless Chrome: `/next/slots` і `/next/settings` на фікстурі (через фейковий стан неможливо в
  робочій збірці — тому на живому стані без токена плюс RTL-сценарії); знімки екрана порівняти зі
  `slots.png`, `settings.png`; відхилення — задачі F.

### Ownership

| Файли | Задача |
|---|---|
| `web/src/application/ports.ts` | S6.T0 |
| `web/src/application/{monitor,run-check,extension-link}*`, `web/src/adapters/settings-store/**` | S6.T1 |
| `web/src/features/slots/{NextOpening,NearestFree}*`, `features/slots/model/{releases-view,nearest-free}*` | S6.T2 |
| решта `web/src/features/slots/**`, `SlotsPage.tsx`, `hooks/use-app-services.ts`, `providers.tsx`, `test/fake-services.tsx` | S6.T3 |
| `web/src/features/settings/**`, `SettingsPage.tsx` | S6.T4 |
| `web/src/features/banners/**`, `Layout.tsx`, `Layout.module.css`, `router.test.tsx` | S6.T5 |

## Етап 7 — задачі

Загальне. Контракт подій — `server/src/contracts/extension-events.ts` (S7.T0): тип події з
переліку `extensionEventTypes`, `jobId` для воронки вибору слота, пласкі `payload` без ключів,
схожих на секрет, `test` для тестових `app:slots`. Запити розширення до e-Consul (`GET auth/me`,
`GET tasks/{id}` з `econsul.js`) пишуться в той самий `POST /api/request-log` з `source: 'extension'`,
`service: 'auth'` / `'tasks'`, `method: 'GET auth/me'` / `'GET tasks/:id'` (без id), `filters: {}`,
`institutionCode: null`, `tabSessionId` — UUID запуску service worker, `appVersion` — версія розширення.

### Wave 0 — основна сесія

#### S7.T0 — контракт подій розширення; порт історії
- Files: `server/src/contracts/extension-events.ts` (new), `web/src/application/ports.ts` (`LogHistory.extensionEvents(query): Promise<Page<StoredExtensionEvent>>`)

### Wave 1 — паралельно

#### S7.T1 — модуль `extension-events` і підключення
- Module: server · Files: `server/src/modules/extension-events/{repository.ts,repository.it.test.ts,routes.ts,routes.test.ts}` (new), `server/src/app.ts`, `server/src/app.test.ts`, `server/src/platform/container.ts`
- Rules: як «Rules для задач `server`» етапу 5 (CRUD, одна вставка з `onConflictDoNothing`, `[from, to)`, повні шляхи `/api/extension-events`, зайвий ключ і ключ `token` у `payload` → 422)
- Interface: `createExtensionEventsRepository(db)` (`insertMany(events: ExtensionEvent[])`, `list(query: ExtensionEventQuery)`); `extensionEventsRoutes` — `POST /api/extension-events`, `GET /api/extension-events` (`type`, `jobId`, `from`, `to`, курсор)
- Steps: тести репозиторію (вставка/повтор, фільтри) і маршрутів (204; `payload.token` → 422; невідомий `type` → 422); `app.test.ts` — маршрут зареєстровано.

#### S7.T2 — розширення пише свої запити й події
- Module: extension · Files: `extension/telemetry.js` (new), `extension/background.js`, `extension/econsul.js`, `extension/manifest.json` (`version` 0.3.3 → 0.4.0), `extension/docs/how-it-works.md`, `extension/plans/extension-plan.md` (§6 «Журнал»), `extension/README.md`
- Rules:
  - Service worker засинає: черга записів — у `chrome.storage.local` (`telemetryQueue`, ≤ 2000, найстаріші відкидаються), відправка пачками ≤ 100 після кожної події й за будильником `tick` (уже щохвилини); 204 → прибрати; мережа/5xx → лишити; 4xx → викинути пачку — extension/CLAUDE.md («усе відкладене — через `chrome.alarms`»), security
  - Нових дозволів не треба: `http://localhost:3000/*` уже в `host_permissions` — security «In this project» (Extension permissions)
  - Токен, URL з токеном, дані заявника — ніколи в записі; `taskId` — не в `method`, лише як `payload.taskId`, якщо треба; тексти помилок — коди з `SELECT_ERRORS`, а не тексти сторінки — security
  - Протокол із застосунком не змінюється (§8); `importScripts('telemetry.js')` у `background.js` (service worker не модуль)
  - Після змін `background.js`/content scripts — `version` у `manifest.json` — extension/CLAUDE.md
- Події (точки в `background.js`): вхід/вихід (`updateAuth`, `onLoggedOut` з `reason`), чернетка (`onSiteTask` → `draft.found` з `step`; `openDraft` → `draft.opened`; минула доба → `draft.gone`), воронка (`startSelection` → `selection.started` з `jobId`, кількістю слотів, `test`; етапи з `econsul:slot-result` → `selection.stage`/`selection.selected`/`selection.failed` з кодом помилки й тривалістю), автобронювання (`econsul:confirm-clicked` → `booking.confirm-clicked`; `onBookResult` → `booking.booked`/`booking.failed`), `app:slots` → `app.slots-received` (`count`, `test`), дії користувача (`user.mute`, `user.pause`, `user.auto-book`, `user.test-sound`). Запити: `econsul.js` вимірює `GET auth/me` і `GET tasks/{id}` (статус, тривалість, результат) і надсилає фону повідомлення `econsul:request` без токена; фон кладе запис у чергу.
- Verify: `node --check extension/*.js`; вручну (користувач): ⟳ розширення в `chrome://extensions`, відкрити e-consul — у `GET /api/request-log?source=extension` і `GET /api/extension-events` з'являються записи; з закритою вкладкою застосунку — теж.

#### S7.T3 — події розширення на сторінці «Моніторинг»
- Module: web · Files: `web/src/adapters/log-history/{log-history.ts,log-history.test.ts}`, `web/src/features/monitoring/**`, `web/src/test/fake-services.tsx`
- Журнал перевірок показує й події розширення поруч із перевірками за часом (як «Розширення вибрало слот» на `monitoring.png`): `selection.selected` → «Розширення вибрало слот · <дата> о <час> у чернетці — натисніть «Підтвердити»», `selection.failed`, `booking.booked`, `session.logged-out`; фільтри «Усі» — разом, решта — лише перевірки; тестові події — з позначкою «тест».
- Steps: RTL — злиття за часом; фільтр «Нові слоти» ховає події; тестова подія позначена.

### Wave 2 — основна сесія

#### S7.T4 — перевірка
- Збірка, перезапуск сервера; `POST /api/extension-events` з ключем `token` у `payload` → 422 (`app.inject` у тестах, не в робочу базу); після ⟳ розширення в користувача — записи в `extension_events` і `econsul_requests` (`source = 'extension'`), зокрема з закритою вкладкою застосунку; `pg_dump` без токена.

### Ownership

| Файли | Задача |
|---|---|
| `server/src/contracts/extension-events.ts`, `web/src/application/ports.ts` | S7.T0 |
| `server/src/modules/extension-events/**`, `server/src/app.ts`, `app.test.ts`, `platform/container.ts` | S7.T1 |
| `extension/**` (перелічені файли) | S7.T2 |
| `web/src/adapters/log-history/**`, `web/src/features/monitoring/**`, `web/src/test/fake-services.tsx` | S7.T3 |

## Етап 8 — задачі

Рішення користувача 2026-10-09: етап іде у два кроки. Спершу все оборотне — новий застосунок на
`/`, старий `slots.html` тимчасово на `/old`, документація й скіли. Видалення `slots.html`,
`main.go`, `go.mod`, старого маршруту `POST /schedule-log` і `/old` — окремою задачею S8.T5, лише
після підтвердження користувача, що день моніторингу на новому застосунку пройшов без розбіжностей.

### Wave 1 — паралельно

#### S8.T1 — сервер: новий застосунок на `/`, старий на `/old`
- Module: server · Files: `server/src/app.ts`, `server/src/app.test.ts`, `server/src/platform/config.ts`
- `@fastify/static` на `web/dist` з `prefix: '/'`; невідомі шляхи без розширення поза `/api` → `web/dist/index.html`; `/next` і `/next/*` → 301 на той самий шлях без `/next`; `GET /old` → `slots.html` (без кінцевої скісної: відносні `locations.json` і `schedule-log` у `slots.html` ведуть на корінь — їхні маршрути лишаються), `/old/` → 301 на `/old`. Немає `web/dist` → `/` відповідає 503 з підказкою зібрати `web/`.
- Rules: як етап 2 S2.T3 (статика лише на `web/dist`; без кореня репозиторію) і етап 5 (`/api` — JSON 404).
- Steps: тести `app.inject()` з тимчасовою `dist`: `/`, `/slots`, `/settings` → `index.html`; `/assets/a.js` → файл; `/missing.js` → 404; `/next/slots` → 301 `/slots`; `/old` → `slots.html`; `/api/nope` → 404 JSON; `POST /schedule-log` і `GET /locations.json` — як раніше.

#### S8.T2 — `web/` на корені
- Module: web · Files: `web/vite.config.ts` (`base: '/'`), `web/scripts/reconcile-with-slots-html.ts` (`slots.html` тепер на `/old`), `web/README.md`, `web/CLAUDE.md`, `web/docs/fixtures.md`, `web/src/domain/__fixtures__/legacy/` (`slots.json`, `slots_not_working.json` з кореня — `git mv`, без змін вмісту; `README.md` — що це: відповіді лютого 2026 без моменту запису, лише для ручних порівнянь)
- Steps: `pnpm --dir web build`; `reconcile` проти `/old` — 54 ✓.

### Wave 2 — основна сесія

#### S8.T3 — документація й скіли
- `docs/booking.md` §9 — описує новий застосунок (`web/`, маршрути, моніторинг, журнали) замість
  `slots.html`; ключові функції — посилання на модулі `web/src/domain` і `application`.
- Кореневі `CLAUDE.md`, `README.md`; `server/README.md`, `server/CLAUDE.md`; `extension/CLAUDE.md`
  (протокол — `web/src/domain/contracts/extension-messages.ts` і `web/src/application/extension-link.ts`
  замість `slots.html`); скіли (`onion-architecture`, `frontend-ui-architecture`, `security`,
  `fastify-best-practices`, `brainstorm`, `engineering-insights`) — розділи «In this project» без
  «переписування», агенти (`.claude/agents/*.md`).
- `docs/brainstorm/ideas.md` — Current focus: план виконано.

#### S8.T4 — перевірка
- Сервер перезапущено; `/` — новий застосунок, `/old` — старий; headless Chrome без помилок;
  розширення працює з `/` (міст на `localhost:3000/*` не змінювався). Повний день моніторингу на
  новому застосунку — користувач.

### Wave 3 — після підтвердження користувача

#### S8.T5 — видалення старого
- `git rm slots.html main.go go.mod`; прибрати `GET /old`, `scheduleLogLegacyRoutes`
  (`POST /schedule-log`) і `GET /locations.json` з `server/` (застосунок бере довідник з
  `/api/locations`); `reconcile` — архівувати або видалити разом зі `slots.html`; документація —
  без згадок про старий застосунок.
