# Інсайти web/

Неочевидна поведінка застосунку, його інструментів і тестів. Нові замітки — зверху розділу, з датою.
Веде скіл `engineering-insights`. Спільне для кількох модулів — у [../../docs/insights.md](../../docs/insights.md).

## Збірка й стилі

### Шляхи до `public/` у CSS — без `base` (2026-10-09)

Vite дописує `base` до `url(/fonts/x.woff2)` лише для файлів із `public/`. Літерал з `base`
(`/next/fonts/...`) Vite не переписує, і після зміни `base` шрифти зламались би. Правило: у CSS —
`/fonts/...`; `base` — лише у `vite.config.ts`.

## Тести

### Нове обов'язкове поле в `AppServices` ламає чужі тести (2026-10-09)

`AppServices` (`src/hooks/use-app-services.ts`) збирають і `providers.tsx`, і тести. Тест, що
будує сервіси вручну, і тест, що рендерить справжні сторінки через маршрутизатор, падають, щойно
з'являється нове поле (`history`, `openBooking`) чи потрібен новий провайдер (`QueryClientProvider`).
Правило: компонентні тести беруть `createFakeServices()` з `src/test/fake-services.tsx` (там і
`QueryClientProvider`); нове поле — одразу у фейк, у тому самому коміті.

### Бейдж у `NavLink` змінює доступне ім'я посилання (2026-10-09)

Без явного пробілу (`{' '}`) між текстом і бейджем ім'я посилання стає «Моніторинг2 нові», і
`getByRole('link', { name: 'Моніторинг' })` його не знаходить (`src/app/Layout.tsx`).

## Типи

### `renotify`, `AudioContext` і `Notification` у типах DOM (2026-10-09)

`renotify` немає в `NotificationOptions` TypeScript, а `Window` не має властивостей `AudioContext` і
`Notification`. Адаптер `alerts`, що бере `win: Window`, приводить типи явно
(`src/adapters/alerts/`).

## Архітектура

### Адаптер не може взяти типову реалізацію з іншого адаптера (2026-10-09)

Правило `adapters-are-leaves` забороняє `server-api` імпортувати `browser-runtime` навіть заради
типового `Scheduler`. Правило: залежність передає composition root (`providers.tsx`); якщо потрібна
типова — своя локальна копія в адаптері.
