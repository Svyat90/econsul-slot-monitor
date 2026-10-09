# e-Consul Helper — розширення Chrome

Розширення Manifest V3 для локального застосунку моніторингу слотів (`http://localhost:3000`):

- передає застосунку токен сесії e-consul і сповіщає, коли треба увійти (значок `!`, нотифікація,
  звук «розбите скло»);
- підхоплює чернетку заявки з відкритої вкладки `/tasks/{id}/…` і передає посилання застосунку;
- на `app:slots` вибирає найраніший вільний слот у чернетці, підсвічує «Підтвердити» і вмикає сигнал;
  з автобронюванням натискає «Підтвердити» саме;
- пише власні запити до e-Consul (`auth/me`, `tasks/{id}`) і свої події на локальний сервер — навіть коли
  вкладки застосунку немає.

Версія: див. `manifest.json` (зараз 0.4.0).

## Встановлення

`chrome://extensions` → «Режим розробника» → «Завантажити розпаковане» → тека `extension/`.
Після змін у коді — кнопка ⟳ на картці розширення (див. [CLAUDE.md](CLAUDE.md)).

## Файли

| Файл | Де працює | Що робить |
|---|---|---|
| `manifest.json` | — | Права: `storage`, `alarms`, `notifications`, `offscreen`, `tabs`, `scripting`; хости e-consul і `localhost:3000` |
| `background.js` | service worker | Стан (`chrome.storage.session`), будильники, вкладки, нотифікації, значок, маршрутизація повідомлень |
| `telemetry.js` | service worker (`importScripts`) | Журнал: черга запитів і подій у `chrome.storage.local`, пачки на `localhost:3000/api/request-log` і `/api/extension-events` |
| `econsul.js` | `https://e-consul.gov.ua/*` | Токен із `localStorage`, перевірка `auth/me` (час і статус запитів — у журнал), чернетка, запуск вибору слота, банер |
| `picker.js` | `https://e-consul.gov.ua/*` | Кліки в формі кроків 3–4: «Далі», тиждень, «Показати ще», слот, «Підтвердити» |
| `app-bridge.js` | `http://localhost:3000/*` | Міст `window.postMessage` ↔ background |
| `offscreen.html/.js`, `sounds.js` | offscreen document | Звуки без фокуса на сторінці |
| `popup.html/.js/.css` | попап | Статус сесії, чернетки, моніторингу, вибору слота; автобронювання, «Вимкнути звук», «Призупинити» |
| `fonts/`, `icons/` | — | Локальні шрифти й іконки |

## Як це пов'язано

```
застосунок (localhost:3000) ⇄ app-bridge.js ⇄ background.js ⇄ econsul.js + picker.js (вкладка e-consul)
                                                    ├─ offscreen (звуки)
                                                    └─ popup
```

## Документація модуля

| Документ | Про що |
|---|---|
| [docs/how-it-works.md](docs/how-it-works.md) | Поведінка розширення: сесія, чернетка, вибір слота, перевірка без справжніх даних |
| [docs/insights.md](docs/insights.md) | Неочевидна поведінка Chrome, сайту й інструментів тестування |
| [docs/design/README.md](docs/design/README.md) | Дизайн A: макети, токени, як перезібрати сторінку дизайну |
| [plans/extension-plan.md](plans/extension-plan.md) | План: рішення, архітектура, протокол повідомлень, етапи, що лишилось |

Спільне з іншими модулями — у [../docs/](../docs/): як працює сайт і API ([booking.md](../docs/booking.md)),
спільні інсайти ([insights.md](../docs/insights.md)).
