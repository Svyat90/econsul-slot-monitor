# e-Consul slot monitor

Локальний інструмент для одного користувача: шукає вільні слоти запису на візит на
e-consul.gov.ua, стежить за ними й передає знайдене розширенню Chrome, яке вибирає слот у
чернетці заявки.

## Що де

| Шлях | Що це |
|---|---|
| `slots.html` | Увесь поточний застосунок: інтерфейс, запити до API e-Consul, розрахунок слотів, моніторинг |
| `main.go` | Сервер на `:3000`: віддає `slots.html`, `locations.json`, приймає `POST /schedule-log` |
| `locations.json` | Довідник країн, установ, послуг, тривалостей і свят |
| `extension/` | Розширення Chrome «e-Consul Helper» (MV3) |
| `slots.json`, `slots_not_working.json` | Записані відповіді API — фікстури для тестів алгоритму |
| `docs/booking.md` | Як працює сайт, API, алгоритм вільних слотів і застосунок — **специфікація** |
| `docs/plans/` | Узгоджені плани (розширення) |
| `docs/design/` | Дизайн A розширення |
| `docs/brainstorm/ideas.md` | Чернетка ідей і рішень щодо переписування (скіл `brainstorm`) |
| `docs/insights.md` | Неочевидна поведінка сайту, Chrome, інструментів (скіл `engineering-insights`) |

Застосунок переписується на React + Next.js у гілці `feature/web-app-rewrite`; стек і структура
фіксуються в `docs/brainstorm/ideas.md`.

## Правила

- **Перед будь-якою задачею прочитайте відповідні розділи `docs/insights.md`**, після задачі —
  допишіть туди неочевидне (скіл `engineering-insights`).
- Запити до e-Consul — лише з браузера й лише з токеном користувача; токен не потрапляє на наш
  сервер, у логи чи коміти.
- Алгоритм вільних слотів має збігатися з сайтом (`docs/booking.md` §6–7, §11). Зміна поведінки —
  разом зі зміною `docs/booking.md`.
- Нічого не бронювати й не ставати в чергу очікування під час розробки чи тестів.
- Після змін background чи content scripts розширення — піднімати `version` у
  `extension/manifest.json`.

## Скіли (`.claude/skills/`)

`brainstorm`, `engineering-insights`, `onion-architecture`, `frontend-ui-architecture`,
`react-best-practices`, `next-best-practices`, `typescript-expert`, `zod`, `security`,
`react-testing-library`, `mermaid-diagram`.
