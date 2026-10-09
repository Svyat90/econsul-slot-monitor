// Popup: session status, draft, morning draft time, monitoring of the app, mute and pause.
// State comes from the background (popup:state) every 2 s; countdowns tick every second.

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_MS = 30 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

let state = null;
const $ = id => document.getElementById(id);

function send(type, extra = {}) {
    return chrome.runtime.sendMessage({ type, ...extra });
}

function pad(n) { return String(n).padStart(2, '0'); }
function hhmm(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function formatLeft(ms) {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h ? `${h} год ${m} хв` : `${m} хв`;
}

// "сьогодні о 08:45", "завтра о 08:45" or "09.10 о 08:45"
function dayAndTime(ms) {
    const day = new Date(ms); day.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    const prefix = diff === 0 ? 'сьогодні' : diff === 1 ? 'завтра' : diff === -1 ? 'вчора' : `${pad(day.getDate())}.${pad(day.getMonth() + 1)}`;
    return `${prefix} о ${hhmm(ms)}`;
}

function setText(id, text) { $(id).textContent = text; }

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// A line with a coloured dot: 'ok' (green), 'muted' (grey) or 'error'
function setNote(id, kind, html) {
    $(id).innerHTML = html ? `<span class="dot${kind === 'ok' ? '' : ' ' + kind}"></span><span>${html}</span>` : '';
}

// Step ids of the application on the site (booking.md, 14.6)
const STEP_NAMES = {
    placeOfVisitInfo: 'крок 2, установа',
    consularServiceInfo: 'крок 3, послуга',
    dateAndTimeVisitInfo: 'крок 4, дата й час'
};

function render() {
    if (!state) return;
    const { auth, app, appConnected, draft, lastSlots, settings } = state;
    const now = Date.now();
    const monitor = appConnected && app ? app.monitor : null;
    const loggedIn = auth.loggedIn === true && !(auth.exp && auth.exp <= now);

    const pill = $('pill');
    if (!loggedIn) { pill.className = 'pill error'; pill.textContent = 'Не увійшли'; }
    else if (settings.paused) { pill.className = 'pill muted'; pill.textContent = 'Пауза'; }
    else { pill.className = 'pill ok'; pill.textContent = 'Активно'; }

    $('loggedOut').hidden = loggedIn;
    $('loggedIn').hidden = !loggedIn;

    if (!loggedIn) {
        const ended = auth.hasToken || auth.reason === 'api';
        setText('outTitle', ended ? 'Сесія на e-consul скінчилась' : 'Ви не увійшли на e-consul');
        let text = 'Після входу токен прийде в застосунок сам.';
        if (monitor && monitor.stoppedBy === 'session') text = 'Моніторинг зупинено. Він запуститься сам, щойно ви увійдете.';
        else if (auth.loggedIn == null && !auth.hasToken) text = 'Відкрийте e-consul.gov.ua і увійдіть, щоб розширення побачило сесію.';
        setText('outText', text);
        return;
    }

    // Session
    const left = auth.exp ? auth.exp - now : null;
    const warn = left != null && left < EXPIRY_WARNING_MS;
    $('tokenLeft').className = 'sub' + (warn ? ' error' : '');
    $('tokenLeft').innerHTML = left == null ? 'Термін дії токена невідомий'
        : `Токен дійсний ще <b>${formatLeft(left)}</b>` + (warn ? ' · увійдіть знову' : '');
    $('tokenBar').className = 'bar' + (warn ? ' error' : '');
    $('tokenBar').firstElementChild.style.width = left == null ? '0%' : `${Math.min(100, Math.max(0, left / TOKEN_LIFETIME_MS * 100)).toFixed(1)}%`;

    // Did the token reach the app?
    const tokenReceived = appConnected && app && app.tokenReceived;
    if (!appConnected) setNote('tokenNote', 'muted', 'Застосунок не відкрито. Токен передасться, щойно відкриєте localhost:3000');
    else if (tokenReceived && tokenReceived.exp === auth.exp) setNote('tokenNote', 'ok', `Токен передано в застосунок ${dayAndTime(tokenReceived.at)}`);
    else setNote('tokenNote', 'muted', 'Передаю токен у застосунок…');

    // Draft: the newest application seen in an e-consul tab. Creating and filling it
    // automatically comes with stage 3 of the plan; until then the user creates it on the site
    const openBtn = $('openDraftBtn'), newBtn = $('newDraftBtn');
    if (draft && draft.url) {
        // Institution and service of the draft are read from its document in stage 3; the
        // app's selection may differ from what was chosen on the site, so it is not shown here
        setText('draftTitle', 'Чернетка заявки');
        const step = STEP_NAMES[draft.step] || (draft.step ? `крок ${draft.step}` : null);
        $('draftText').innerHTML = (draft.createdAt
            ? `Створено ${dayAndTime(draft.createdAt)} · видалиться ${dayAndTime(draft.expiresAt)}`
            : `Знайдено у вкладці ${dayAndTime(draft.foundAt)} · сайт видаляє чернетки через добу`) +
            (step ? ` · ${escapeHtml(step)}` : '');
        const draftReceived = appConnected && app && app.draftReceived && app.draftReceived.url === draft.url;
        setNote('draftNote', draftReceived ? 'ok' : 'muted', draftReceived
            ? 'Посилання передано в застосунок (Draft link)'
            : appConnected ? 'Передаю посилання в застосунок…' : 'Посилання передасться в застосунок, щойно його відкриєте');
        openBtn.hidden = false;
        newBtn.className = 'secondary';
    } else {
        setText('draftTitle', 'Чернетки ще немає');
        setText('draftText', 'Створіть заявку на сайті й пройдіть кроки 1–3. Розширення побачить її у вкладці й передасть посилання в застосунок.');
        setNote('draftNote', 'muted', 'Автоматичне заповнення кроків 1–3 ще в розробці');
        openBtn.hidden = true;
        newBtn.className = 'primary';
    }

    const timeInput = $('draftTime');
    if (document.activeElement !== timeInput) timeInput.value = settings.draftTime;

    // Monitoring in the app
    if (!appConnected) {
        setText('monitorTitle', 'Застосунок не відкрито');
        setText('monitorText', 'Відкрийте http://localhost:3000, щоб застосунок отримував токен сам.');
    } else if (monitor && monitor.running) {
        setText('monitorTitle', 'Моніторинг працює');
        const parts = [];
        if (monitor.nextAt) {
            const seconds = Math.max(0, Math.round((monitor.nextAt - now) / 1000));
            parts.push(`Наступна перевірка за <span class="mono">${seconds} с</span>`);
        } else {
            parts.push('Іде перевірка…');
        }
        if (monitor.nextRelease && monitor.nextRelease.at > now - 3 * 60000) parts.push(`новий день відкриється о ${hhmm(monitor.nextRelease.at)}`);
        $('monitorText').innerHTML = parts.join(' · ');
    } else {
        setText('monitorTitle', 'Моніторинг зупинено');
        setText('monitorText', monitor && monitor.stoppedBy === 'session'
            ? 'Через завершену сесію. Запуститься сам після входу.'
            : 'Запустіть його в застосунку.');
    }

    const slotsText = $('slotsText');
    if (lastSlots && lastSlots.slots.length && now - lastSlots.receivedAt < 24 * 3600000) {
        const first = lastSlots.slots[0];
        const more = lastSlots.slots.length > 1 ? ` (+${lastSlots.slots.length - 1})` : '';
        slotsText.hidden = false;
        // All slots of the last check, grouped by date (they arrive sorted)
        const byDate = new Map();
        for (const slot of lastSlots.slots) {
            if (!byDate.has(slot.date)) byDate.set(slot.date, []);
            byDate.get(slot.date).push(slot.time);
        }
        const list = [...byDate].map(([date, times]) =>
            `<div class="slot-day"><span class="mono">${escapeHtml(date.split('-').reverse().join('.'))}</span> <span class="slot-times mono">${times.map(escapeHtml).join(', ')}</span></div>`
        ).join('');
        slotsText.innerHTML = `${lastSlots.test ? '<b>ТЕСТ.</b> ' : ''}Нові слоти: <span class="mono">${first.date.split('-').reverse().join('.')} ${first.time}</span>${more} · отримано ${dayAndTime(lastSlots.receivedAt)}` +
            `<div class="slot-list">${list}</div>`;
    } else {
        slotsText.hidden = true;
    }

    renderSelection(now);
    if (document.activeElement !== $('autoBook')) $('autoBook').checked = !!settings.autoBook;
    $('pauseBtn').textContent = settings.paused ? 'Відновити' : 'Призупинити';
}

// What happened to the last slots on the site: selecting, selected or why not
function renderSelection(now) {
    const { selection, selectErrors = {} } = state;
    const el = $('selectionText');
    if (!selection || now - (selection.at || 0) > 24 * 3600000) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('error', selection.status === 'failed' || selection.status === 'book-failed');
    const test = selection.test ? '<b>ТЕСТ.</b> ' : '';
    if (selection.status === 'running') {
        el.innerHTML = `${test}Вибираю слот у чернетці… (${Math.round((now - selection.startedAt) / 1000)} с)`;
    } else if (selection.status === 'booking') {
        el.innerHTML = `Бронюю <span class="mono">${escapeHtml(selection.slot.date.split('-').reverse().join('.'))} ${escapeHtml(selection.slot.time)}</span>: натискаю «Підтвердити»…`;
    } else if (selection.status === 'booked') {
        el.innerHTML = `Заброньовано <span class="mono">${escapeHtml(selection.slot.date.split('-').reverse().join('.'))} ${escapeHtml(selection.slot.time)}</span> ${dayAndTime(selection.at)}. Підтвердження прийде на email.`;
    } else if (selection.status === 'book-failed') {
        el.innerHTML = `Не забронювалось <span class="mono">${escapeHtml(selection.slot.date.split('-').reverse().join('.'))} ${escapeHtml(selection.slot.time)}</span>: ${escapeHtml(selectErrors[selection.error] || selection.error)}${selection.text ? ' ' + escapeHtml(selection.text.slice(0, 160)) : ''}`;
    } else if (selection.status === 'selected') {
        const { date, time } = selection.slot;
        el.innerHTML = `${test}Вибрано <span class="mono">${escapeHtml(date.split('-').reverse().join('.'))} ${escapeHtml(time)}</span> ${dayAndTime(selection.at)}. Натисніть «Підтвердити» на сайті.`;
    } else if (selection.status === 'skipped') {
        el.innerHTML = `${test}Слот не вибрано: пауза.`;
    } else {
        el.innerHTML = `${test}Слот не вибрано ${dayAndTime(selection.at)}: ${escapeHtml(selectErrors[selection.error] || selection.error)}`;
    }
}

async function refresh() {
    try {
        state = await send('popup:state');
        render();
    } catch (e) { /* background restarting */ }
}

$('loginBtn').addEventListener('click', () => { send('popup:login'); window.close(); });
$('muteBtn').addEventListener('click', () => send('popup:mute'));
$('pauseBtn').addEventListener('click', async () => {
    await send('popup:settings', { patch: { paused: !state.settings.paused } });
    refresh();
});
$('autoBook').addEventListener('change', async event => {
    await send('popup:settings', { patch: { autoBook: event.target.checked } });
    refresh();
});
$('openDraftBtn').addEventListener('click', () => { send('popup:open-draft'); window.close(); });
$('newDraftBtn').addEventListener('click', () => { send('popup:new-draft'); window.close(); });
$('draftTime').addEventListener('input', event => {
    event.target.classList.toggle('invalid', !TIME_RE.test(event.target.value));
});
$('draftTime').addEventListener('change', async event => {
    const value = event.target.value.trim();
    if (!TIME_RE.test(value)) return;
    await send('popup:settings', { patch: { draftTime: value } });
    refresh();
});

// Unpacked extension: popup files come from disk on every open, the manifest of the running
// extension only from the last reload. A newer version on disk means "press reload"
fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })
    .then(r => r.json())
    .then(onDisk => { $('reloadNote').hidden = onDisk.version === chrome.runtime.getManifest().version; })
    .catch(() => {});

refresh();
setInterval(refresh, 2000);
setInterval(render, 1000);
