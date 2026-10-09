# Інсайти

Замітки про неочевидну поведінку браузера, сайту й інструментів, яка стосується кількох модулів
або застосунку (`slots.html`). Інсайти окремого модуля — у `<модуль>/docs/insights.md`
(розширення: [extension/docs/insights.md](../extension/docs/insights.md)).
Нові замітки — зверху розділу, з датою. Веде скіл `engineering-insights`.

## Застосунок

### Кеш `slots.html` (2026-10-09)

Після змін `slots.html` звичайне оновлення вкладки може показати стару версію з кешу браузера
(сервер віддає файл без заголовків кешування). Оновлювати з Cmd+Shift+R.

## Тестування

### Claude in Chrome (2026-10-08, оновлено 2026-10-09)

Після `/chrome` інструменти `mcp__claude-in-chrome__*` у вже запущену сесію Claude Code не
з'явилися. 2026-10-09 вони запрацювали, щойно користувач увійшов у розширення Claude у Chrome.
Claude бачить і керує лише вкладками своєї групи, а не вкладками користувача. Тому чернетку
відкривав за адресою з `localStorage` застосунку (`slots.draft`).

## Інструменти

### Системний `python3` без PyYAML — frontmatter перевіряти через Ruby (2026-10-09)

`python3 -c "import yaml"` на цьому Mac падає з `ModuleNotFoundError: No module named 'yaml'`, а
`pip install` змінює системне середовище. Ruby зі стандартною бібліотекою YAML є.

Правило: перевіряти frontmatter скілів і агентів так:
`ruby -ryaml -e 's=File.read(ARGV[0]); YAML.safe_load(s[/\A---\n(.*?)\n---/m,1])' <file>` — для
кожного `.claude/skills/*/SKILL.md` і `.claude/agents/*.md` після правок опису (`description` з
двокрапкою чи лапками легко ламає YAML).
