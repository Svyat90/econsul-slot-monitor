// Popup: session status, draft, morning draft time, monitoring of the app, mute and pause.
// State comes from the background (popup:state) every 2 s; countdowns tick every second.

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_MS = 30 * 60 * 1000;

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

// Formats follow the time zone: the user's own time (checks, draft expiry) is Ukrainian, 24 h;
// the consulate's time (slots) is American, "10/23 9:00 AM".

// "сьогодні 08:55", "завтра 08:55" or "09.10 08:55"
function dayAndTime(ms) {
    const day = new Date(ms); day.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    const prefix = diff === 0 ? 'сьогодні' : diff === 1 ? 'завтра' : diff === -1 ? 'вчора' : `${pad(day.getDate())}.${pad(day.getMonth() + 1)}`;
    return `${prefix} ${hhmm(ms)}`;
}

// "45 с", "1 хв", "1 хв 30 с"
function formatSeconds(seconds) {
    if (seconds < 60) return `${seconds} с`;
    const m = Math.floor(seconds / 60), s = seconds % 60;
    return s ? `${m} хв ${s} с` : `${m} хв`;
}

function setText(id, text) { $(id).textContent = text; }

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// "HH:MM" of a consulate slot → { clock: "9:00", suffix: "AM" }
function usClock(time) {
    const [h, m] = time.split(':').map(Number);
    return { clock: `${h % 12 || 12}:${pad(m)}`, suffix: h < 12 ? 'AM' : 'PM' };
}

// [{date, time}] → "10/23 9:00 · 11:30 AM · 10/24 1:10 PM"; AM/PM only where it changes
function usSlots(slots) {
    const byDate = new Map();
    for (const slot of slots) {
        if (!byDate.has(slot.date)) byDate.set(slot.date, []);
        byDate.get(slot.date).push(usClock(slot.time));
    }
    return [...byDate].map(([date, times]) => {
        const [, month, day] = date.split('-').map(Number);
        const parts = times.map((t, i) => (i < times.length - 1 && times[i + 1].suffix === t.suffix ? t.clock : `${t.clock} ${t.suffix}`));
        return `${month}/${day} ${parts.join(' · ')}`;
    }).join(' · ');
}

// Step ids of the application on the site (booking.md, 14.6)
const STEP_NAMES = {
    placeOfVisitInfo: 'крок 2',
    consularServiceInfo: 'крок 3',
    dateAndTimeVisitInfo: 'крок 4'
};

const DAY_MS = 24 * 3600000;

function setNote(id, kind, text, title) {
    const el = $(id);
    el.className = 'ok-text' + (kind === 'ok' ? '' : ' muted');
    el.textContent = text;
    el.title = title || '';
}

function render() {
    if (!state) return;
    const { auth, app, appConnected, draft, draftJob, draftErrors = {}, lastSlots, settings } = state;
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
    $('tokenLeft').className = 'grow' + (warn ? ' sub error' : '');
    $('tokenLeft').innerHTML = left == null ? '<b>Сесія</b> · термін невідомий'
        : `<b>Сесія</b> · ще <b>${formatLeft(left)}</b>` + (warn ? ' · увійдіть знову' : '');
    $('tokenBar').className = 'bar' + (warn ? ' error' : '');
    $('tokenBar').firstElementChild.style.width = left == null ? '0%' : `${Math.min(100, Math.max(0, left / TOKEN_LIFETIME_MS * 100)).toFixed(1)}%`;

    // Did the token reach the app?
    const tokenReceived = appConnected && app && app.tokenReceived;
    if (!appConnected) setNote('tokenNote', 'muted', 'застосунок не відкрито', 'Токен передасться, щойно відкриєте localhost:4000');
    else if (tokenReceived && tokenReceived.exp === auth.exp) setNote('tokenNote', 'ok', '✓ у застосунку', `Токен передано в застосунок ${dayAndTime(tokenReceived.at)}`);
    else setNote('tokenNote', 'muted', 'передаю…', 'Передаю токен у застосунок');

    // Draft: the newest application seen in an e-consul tab. Creating and filling it
    // automatically comes with stage 3 of the plan; until then the user creates it on the site
    const openBtn = $('openDraftBtn'), newBtn = $('newDraftBtn');
    const creating = !!(draftJob && draftJob.status === 'running');
    newBtn.disabled = creating;
    if (creating) {
        // The extension fills steps 1–3 itself (creator.js), about 20 s
        setText('draftTitle', 'Створюю чернетку…');
        setText('draftInfo', '· кроки 1–3 з налаштувань');
        setNote('draftNote', 'muted', '', '');
        $('draftText').hidden = true;
        openBtn.hidden = !(draft && draft.url);
        newBtn.className = 'secondary';
    } else if (draft && draft.url) {
        setText('draftTitle', 'Чернетка заявки');
        const step = STEP_NAMES[draft.step] || (draft.step ? `крок ${draft.step}` : null);
        const when = draft.createdAt ? `до ${dayAndTime(draft.expiresAt)}` : `знайдено ${dayAndTime(draft.foundAt)}`;
        setText('draftInfo', '· ' + (step ? `${step} · ` : '') + when);
        $('draftText').hidden = true;
        const draftReceived = appConnected && app && app.draftReceived && app.draftReceived.url === draft.url;
        if (draftReceived) setNote('draftNote', 'ok', '✓', 'Посилання передано в застосунок (Draft link)');
        else setNote('draftNote', 'muted', '…', appConnected ? 'Передаю посилання в застосунок' : 'Посилання передасться, щойно відкриєте застосунок');
        openBtn.hidden = false;
        newBtn.className = 'secondary';
    } else {
        setText('draftTitle', 'Чернетки ще немає');
        setText('draftInfo', '');
        setNote('draftNote', 'muted', '', '');
        const failed = draftJob && draftJob.status === 'failed' ? (draftErrors[draftJob.error] || draftJob.error) : null;
        setText('draftText', failed
            ? `Не вдалося створити: ${failed}`
            : 'Натисніть «Створити нову»: розширення саме пройде кроки 1–3 з налаштувань застосунку.');
        $('draftText').hidden = false;
        openBtn.hidden = true;
        newBtn.className = 'primary';
    }

    if (document.activeElement !== $('alarmEnabled')) $('alarmEnabled').checked = settings.alarmEnabled !== false;
    if (document.activeElement !== $('alarmLead')) $('alarmLead').value = settings.alarmLeadMin || 5;
    $('alarmLead').disabled = settings.alarmEnabled === false;
    const alarmNext = $('alarmNext');
    alarmNext.hidden = !(settings.alarmEnabled !== false);
    alarmNext.textContent = state.draftAlarmAt
        ? `Наступний будильник: ${dayAndTime(state.draftAlarmAt)}`
        : 'Наступний будильник: ще не знаю час відкриття (відкрийте застосунок)';

    // Monitoring in the app
    const dot = $('monitorDot');
    if (!appConnected) {
        dot.className = 'dot muted';
        setText('monitorTitle', 'Застосунок');
        setText('monitorText', 'не відкрито · localhost:4000');
    } else if (monitor && monitor.running) {
        dot.className = 'dot';
        setText('monitorTitle', 'Працює');
        const parts = [];
        if (monitor.nextAt) parts.push(`за <span class="mono">${formatSeconds(Math.max(0, Math.round((monitor.nextAt - now) / 1000)))}</span>`);
        else parts.push('іде перевірка…');
        if (monitor.nextRelease && monitor.nextRelease.at > now - 3 * 60000) parts.push(`новий день <span class="mono">${hhmm(monitor.nextRelease.at)}</span>`);
        $('monitorText').innerHTML = parts.join(' · ');
    } else {
        dot.className = 'dot muted';
        setText('monitorTitle', 'Зупинено');
        setText('monitorText', monitor && monitor.stoppedBy === 'session' ? 'сесія завершилась' : 'запустіть у застосунку');
    }

    renderSlotLog(now, lastSlots);
    if (document.activeElement !== $('autoBook')) $('autoBook').checked = !!settings.autoBook;
    if (document.activeElement !== $('aggressiveBook')) $('aggressiveBook').checked = !!settings.aggressiveBook;
    $('aggressiveBook').disabled = !settings.autoBook;
    if (document.activeElement !== $('autoDraft')) $('autoDraft').checked = settings.autoDraft !== false;
    if (document.activeElement !== $('autoMonitor')) $('autoMonitor').checked = !!settings.autoMonitor;
    $('pauseLabel').textContent = settings.paused ? 'Відновити' : 'Призупинити';
}

// One row: time (Ukrainian), marker, bold title, slots (US), muted note. kind: 'found' | 'fail' | ''
function logRow({ at, kind, marker, title, slots, note }) {
    return `<div class="row ${kind}" title="${escapeHtml(dayAndTime(at))}"><span class="t">${hhmm(at)}</span><span class="${marker} d"></span>` +
        `<span><b>${title}</b>${slots ? ` <span class="slots">${escapeHtml(slots)}</span>` : ''}` +
        `${note ? `<br><span class="n">${escapeHtml(note)}</span>` : ''}</span></div>`;
}

// The last new slots and what happened to them on the site, newest first
function renderSlotLog(now, lastSlots) {
    const rows = [];
    if (lastSlots && lastSlots.slots.length && now - lastSlots.receivedAt < DAY_MS) {
        const count = lastSlots.slots.length;
        rows.push({ at: lastSlots.receivedAt, html: logRow({
            at: lastSlots.receivedAt, kind: 'found', marker: 'dot',
            title: (lastSlots.test ? 'ТЕСТ · ' : '') + `${count} ${count === 1 ? 'новий' : 'нові'}`,
            slots: usSlots(lastSlots.slots)
        }) });
    }
    const selection = selectionRow(now);
    if (selection) rows.push({ at: selection.at, html: logRow(selection) });
    rows.sort((x, y) => y.at - x.at);
    $('slotsBlock').hidden = rows.length === 0;
    $('slotLog').innerHTML = rows.map(row => row.html).join('');
}

// What happened to the last slots on the site: selecting, selected or why not
function selectionRow(now) {
    const { selection, selectErrors = {} } = state;
    if (!selection || now - (selection.at || selection.startedAt || 0) > DAY_MS) return null;
    const test = selection.test ? 'ТЕСТ · ' : '';
    const slot = selection.slot ? usSlots([selection.slot]) : '';
    const reason = escapeHtml(selectErrors[selection.error] || selection.error || '');
    const base = { at: selection.at || selection.startedAt, kind: '', marker: 'sq', slots: slot };
    switch (selection.status) {
        case 'running':
            return { ...base, title: `${test}Вибираю слот…`, note: `${Math.round((now - selection.startedAt) / 1000)} с`, slots: '' };
        case 'retrying':
            return { ...base, title: `${test}Сайт відповідає повільно`, note: `повторюю (спроба ${(selection.attempt || 1) + 1})`, slots: '' };
        case 'booking':
            return { ...base, title: 'Бронюю', note: 'натискаю «Підтвердити»…' };
        case 'booked':
            return { ...base, kind: 'found', title: 'Заброньовано', note: 'підтвердження прийде на email' };
        case 'book-failed':
            return { ...base, kind: 'fail', title: 'Не забронювалось', note: `${selectErrors[selection.error] || selection.error}${selection.text ? ' ' + selection.text.slice(0, 160) : ''}` };
        case 'selected':
            return { ...base, title: `${test}Вибрано слот`, note: 'натисніть «Підтвердити» на сайті' };
        case 'skipped':
            return { ...base, title: `${test}Слот пропущено`, note: selection.error === 'quarantined' ? `не бронюється, пропускаю до ${selection.until ? hhmm(selection.until) : '…'}` : 'пауза', slots: '' };
        default:
            return { ...base, kind: 'fail', title: `${test}Слот не вибрано`, note: reason ? (selectErrors[selection.error] || selection.error) : '', slots: '' };
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
$('aggressiveBook').addEventListener('change', async event => {
    await send('popup:settings', { patch: { aggressiveBook: event.target.checked } });
    refresh();
});
$('autoMonitor').addEventListener('change', async event => {
    await send('popup:settings', { patch: { autoMonitor: event.target.checked } });
    refresh();
});
$('autoDraft').addEventListener('change', async event => {
    await send('popup:settings', { patch: { autoDraft: event.target.checked } });
    refresh();
});
$('openDraftBtn').addEventListener('click', () => { send('popup:open-draft'); window.close(); });
$('newDraftBtn').addEventListener('click', () => { send('popup:new-draft'); window.close(); });
$('alarmEnabled').addEventListener('change', async event => {
    await send('popup:settings', { patch: { alarmEnabled: event.target.checked } });
    refresh();
});
$('alarmLead').addEventListener('input', event => {
    const value = Number(event.target.value);
    event.target.classList.toggle('invalid', !(Number.isInteger(value) && value >= 1 && value <= 60));
});
$('alarmLead').addEventListener('change', async event => {
    const value = Number(event.target.value);
    if (!(Number.isInteger(value) && value >= 1 && value <= 60)) return;
    await send('popup:settings', { patch: { alarmLeadMin: value } });
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
