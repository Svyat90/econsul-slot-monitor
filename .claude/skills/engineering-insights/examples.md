# Insight examples

Shape reference for the `engineering-insights` skill. The good examples restate
entries already in `extension/docs/insights.md`; they show the shape, they are not to be
copied again.

## Vague vs useful

**Bad**

> React на сайті щось ламає.

Nothing to act on. No file, no condition, no rule. The next session re-investigates
from zero.

**Good**

> ### React перезаписує `className` при кожному рендері (2026-10-09)
>
> Клас, доданий скриптом до слота чи кнопки на кроці 4, зникає після наступного
> рендеру сайту.
>
> Правило: ЗАВЖДИ накладати позначки повторно (розширення робить це щосекунди,
> `picker.js`), НІКОЛИ не покладатися на один `classList.add`.

**Bad**

> Після змін не працювало, потім заробило.

**Good**

> ### Після змін у коді розширення треба натиснути ⟳ у `chrome://extensions` (2026-10-08)
>
> Попап бере код з диска щоразу, а background і content scripts — лише після ⟳.
> Перезавантаження вкладок їх не оновлює.
>
> Правило: ЗАВЖДИ піднімати `version` у `manifest.json` при зміні background чи
> content scripts — попап тоді сам попросить натиснути ⟳.

## Shape reference by section

`docs/insights.md` → `## Сайт і API e-Consul`

```markdown
### Останній день календаря залежить від часу доби (YYYY-MM-DD)

День потрапляє в календар, лише коли його час відкриття за `timeZone` установи
раніше, ніж `зараз + numberWeeks тижнів − 1 день`; о 09:29 і о 10:30 CDT Чикаго
показує різний останній день (`docs/booking.md` §6).

Правило: НІКОЛИ не рахувати горизонт від початку доби — лише від `nowMs`.
```

(Here the rule itself lives in `docs/booking.md`; the insight is the trap of
getting it wrong, with a pointer.)

the app's `docs/insights.md` (today `docs/insights.md` → `## Застосунок`)

```markdown
### Подвійний запуск моніторингу в React Strict Mode (YYYY-MM-DD)

У dev-режимі `useEffect` запускається двічі, і цикл перевірок у ефекті робив два
запити підряд (видно в Monitoring log: два `Check #1`).

Правило: цикл живе в `createMonitor` (`src/application/monitor.ts`), компонент лише
підписується на стан.
```

## Supersede

```markdown
### Claude in Chrome (2026-10-08, оновлено 2026-10-09)

…старий текст…
Оновлено 2026-10-09: інструменти з'явилися, щойно користувач увійшов у розширення
Claude у Chrome.
```

## Merge (review mode)

Two entries «Кеш `slots.html`» and «Стара версія сторінки після змін» describe
the same cause (no cache headers from `main.go`). Keep the older heading, fold in
the newer evidence, add «Об'єднано YYYY-MM-DD».
