// Service worker: session state, the work tab, notifications, the icon badge and sounds.
// It sleeps when idle, so everything that has to happen later goes through chrome.alarms, and
// all state lives in chrome.storage: session (memory only, cleared with the browser) for the
// token and status, local for settings.
//
// The extension books only when the person turned on auto-booking (settings.autoBook): then
// econsul.js presses «Підтвердити» for the selected slot. Otherwise the person presses it.
// It never presses "Підтверджую" or "Записатись в чергу очікування" and does not call the API
// to book or to write task documents. It selects a slot by clicks on the site (econsul.js, picker.js): «Далі» on step 3
// and the slot on step 4; the site saves that itself. See extension/plans/extension-plan.md, section 3.

importScripts('telemetry.js'); // Telemetry: own requests and events for the local server

const APP_ORIGIN = 'http://localhost:3000';
const ECONSUL_TABS = 'https://e-consul.gov.ua/*';
// Without a session the site sends the user to id.e-consul.gov.ua and returns afterwards
const LOGIN_URL = 'https://e-consul.gov.ua/';
// New "Запис на візит" application (booking.md, 14.6). Opening it is what the user would do by
// hand: the site creates the task; steps 1–3 are filled on the site
const NEW_APPLICATION_URL = 'https://e-consul.gov.ua/tasks/create/161374/161374001';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // the site deletes unsent drafts a day after creation
const AUTH_CHECK_MIN_MS = 10 * 60 * 1000; // GET auth/me every 10–15 min, random
const AUTH_CHECK_MAX_MS = 15 * 60 * 1000;
const VERIFY_THROTTLE_MS = 10 * 60 * 1000; // re-check a token the API rejected at most this often
const SELECTED_SOUND = { minMs: 30 * 1000, maxMs: 2 * 60 * 1000 };
const DEFAULT_SETTINGS = { draftTime: '08:45', paused: false, autoBook: false };
const SELECT_TIMEOUT_MS = 3 * 60 * 1000;  // a selection without a result by then has failed
const SELECTED_HOLD_MS = 3 * 60 * 1000;   // new slots do not replace a selected one this soon
const TAB_READY_MS = 45 * 1000;           // the draft page loads and econsul.js answers

// Why a slot was not selected; shown in the popup and the notification
const SELECT_ERRORS = {
    'no-draft': 'Немає чернетки. Відкрийте заявку на e-consul (кроки 1–3).',
    'tab-not-ready': 'Сторінка чернетки не відповіла.',
    'wrong-task': 'У вкладці відкрита інша заявка.',
    'form-not-loaded': 'Форма заявки не завантажилась.',
    'next-disabled': 'Кнопка «Далі» на кроці 3 неактивна.',
    'step-stuck': 'Сайт не перейшов до календаря.',
    'unavailable': 'Сайт пише, що запис зараз недоступний.',
    'no-time': 'Сайт показує, що вільного часу немає.',
    'calendar-not-loaded': 'Календар не завантажився.',
    'not-found': 'Нових слотів у календарі вже немає.',
    'timeout': 'Вибір слота не завершився вчасно.',
    // Auto-booking (picker.js, confirm)
    'not-on-calendar': 'Сторінка пішла з календаря до бронювання.',
    'slot-not-selected': 'Слот перестав бути вибраним.',
    'several-selected': 'Вибрано кілька слотів, автоматично не бронюю.',
    'no-confirm-button': 'Немає активної кнопки «Підтвердити».',
    'alert': 'Сайт показав повідомлення.',
    'left-calendar': 'Сайт пішов з календаря без «Дякуємо».',
    'no-outcome': 'Після «Підтвердити» сайт нічого не показав за 90 с.'
};
const VERSION = chrome.runtime.getManifest().version;

// Why the session counts as ended; shown in the notification and the popup
const LOGOUT_REASONS = {
    'no-token': 'На e-consul.gov.ua немає активної сесії.',
    'expired': 'Термін дії токена минув.',
    'auth-me': 'Сайт не прийняв токен.',
    'api': 'API e-consul відхилило токен застосунку.'
};

// Messages change shared state; run their handlers one at a time so two of them cannot
// read the same old state and overwrite each other
let queue = Promise.resolve();
function serial(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
}

// ---- Setup ----

function ensureAlarms() {
    chrome.alarms.get('tick', alarm => {
        if (!alarm) chrome.alarms.create('tick', { periodInMinutes: 1 });
    });
}

chrome.runtime.onInstalled.addListener(async () => {
    ensureAlarms();
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...settings } });
    renderBadge();
    // Tabs opened before the install or reload have no content scripts (or orphaned ones)
    for (const { js, matches } of chrome.runtime.getManifest().content_scripts) {
        for (const tab of await chrome.tabs.query({ url: matches })) {
            chrome.scripting.executeScript({ target: { tabId: tab.id }, files: js }).catch(() => {});
        }
    }
});
chrome.runtime.onStartup.addListener(() => { ensureAlarms(); renderBadge(); });
ensureAlarms();

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'tick') serial(onTick);
});

chrome.tabs.onRemoved.addListener(async tabId => {
    const { workTabId } = await chrome.storage.session.get('workTabId');
    if (workTabId === tabId) await chrome.storage.session.remove('workTabId');
});

// ---- Auth state ----
// auth: { token, exp (ms), loggedIn: true | false | undefined, reason, changedAt, checkedAt,
//         nextCheckAt, verifiedAt }

async function getAuth() {
    const { auth } = await chrome.storage.session.get('auth');
    return auth || {};
}

// Applies an update to auth and reacts to a change of loggedIn. opts.appPlayedSound: the app
// already played the session sound itself (it reported the 401)
async function updateAuth(update, opts = {}) {
    const prev = await getAuth();
    const next = { ...prev, ...update };
    if (next.loggedIn !== prev.loggedIn) next.changedAt = Date.now();
    await chrome.storage.session.set({ auth: next });
    await renderBadge(next);

    if (next.loggedIn === false && prev.loggedIn !== false) {
        await onLoggedOut(next, opts);
    } else if (next.loggedIn === true && (prev.loggedIn !== true || next.token !== prev.token)) {
        if (prev.loggedIn !== true) Telemetry.event('session.logged-in');
        chrome.notifications.clear('login');
        await sendToApps([authMessage(next), { type: 'ext:token', token: next.token, exp: next.exp }]);
    } else {
        await sendToApps([authMessage(next)]);
    }
    return next;
}

function authMessage(auth, extra = {}) {
    return { type: 'ext:auth', loggedIn: auth.loggedIn ?? null, exp: auth.exp || null, reason: auth.reason || null, ...extra };
}

// Session ended: badge (already set), notification with "Увійти", banner in the app and the
// broken-glass sound, played by the app when it can, otherwise by the offscreen document
async function onLoggedOut(auth, opts) {
    Telemetry.event('session.logged-out', { reason: auth.reason || null });
    chrome.notifications.create('login', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Увійдіть на e-consul',
        message: (LOGOUT_REASONS[auth.reason] || '') + ' Після входу токен прийде в застосунок сам.',
        buttons: [{ title: 'Увійти' }],
        requireInteraction: true,
        priority: 2
    });
    const appPlays = !opts.appPlayedSound && await appCanPlaySound();
    await sendToApps([authMessage(auth, { alert: appPlays })]);
    if (!opts.appPlayedSound && !appPlays) await playSound('glass');
}

function parseJwtExp(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.exp ? payload.exp * 1000 : null;
    } catch (e) {
        return null;
    }
}

function randomCheckDelay() {
    return AUTH_CHECK_MIN_MS + Math.random() * (AUTH_CHECK_MAX_MS - AUTH_CHECK_MIN_MS);
}

// From econsul.js: the current localStorage.token of the site (null when there is none).
// Returns { verify: true } when the content script should check the token with auth/me.
async function onSiteToken(token, tab) {
    await rememberWorkTab(tab);
    const auth = await getAuth();
    if (!token) {
        if (auth.loggedIn !== false) await updateAuth({ loggedIn: false, reason: 'no-token' });
        return {};
    }
    const exp = parseJwtExp(token);
    if (exp && exp <= Date.now()) {
        if (auth.loggedIn !== false || auth.token !== token) await updateAuth({ token, exp, loggedIn: false, reason: 'expired' });
        return {};
    }
    if (token !== auth.token) {
        // The site writes a token only after a successful login
        await updateAuth({ token, exp, loggedIn: true, reason: null, checkedAt: Date.now(), nextCheckAt: Date.now() + randomCheckDelay() });
        return {};
    }
    if (auth.loggedIn !== true && Date.now() - (auth.verifiedAt || 0) > VERIFY_THROTTLE_MS) {
        await updateAuth({ verifiedAt: Date.now() });
        return { verify: true };
    }
    return {};
}

// From econsul.js: result of GET auth/me with the given token
async function onAuthCheck({ token, ok, status }) {
    const auth = await getAuth();
    if (token !== auth.token) return;
    const update = { checkedAt: Date.now(), nextCheckAt: Date.now() + randomCheckDelay() };
    if (ok) await updateAuth({ ...update, loggedIn: true, reason: null });
    else if (status === 401 || status === 403) await updateAuth({ ...update, loggedIn: false, reason: 'auth-me' });
    else await chrome.storage.session.set({ auth: { ...auth, ...update } }); // network error: try again later
}

// From econsul.js: how an own request to e-Consul went. Only kind, time and status come in
// (never the token or the address); the journal gets the record
async function onSiteRequest({ kind, startedAt, durationMs, status }) {
    if (kind !== 'auth' && kind !== 'tasks') return;
    if (!Number.isFinite(startedAt) || !Number.isInteger(durationMs) || durationMs < 0) return;
    if (!Number.isInteger(status) || (status !== 0 && (status < 100 || status > 599))) return;
    Telemetry.request({ kind, startedAt, durationMs, status });
}

// From econsul.js: a tab shows the application taskId (on step `step`). The newest one seen is
// the draft: shown in the popup and passed to the app as Draft link. info (GET /tasks/{id}):
// { createdAt, finished, deleted } or { missing }, null when it could not be read.
async function onSiteTask({ url, taskId, step, info }, tab) {
    const { draft } = await chrome.storage.session.get('draft');
    if (info && (info.missing || info.finished || info.deleted)) {
        if (draft && draft.taskId === taskId) {
            Telemetry.event('draft.gone', { taskId, reason: info.missing ? 'missing' : info.finished ? 'finished' : 'deleted' });
            await chrome.storage.session.remove('draft');
            await sendToApps([{ type: 'ext:draft', draft: null }]);
        }
        return;
    }
    const same = draft && draft.taskId === taskId;
    const createdAt = (info && info.createdAt) || (same ? draft.createdAt : null);
    const next = {
        url, taskId, step,
        createdAt,
        expiresAt: createdAt ? createdAt + DRAFT_TTL_MS : null,
        foundAt: same ? draft.foundAt : Date.now(),
        tabId: tab.id
    };
    await chrome.storage.session.set({ draft: next });
    if (!same) Telemetry.event('draft.found', { taskId, step: step || null });
    if (!same || next.createdAt !== draft.createdAt || next.url !== draft.url) await sendToApps([{ type: 'ext:draft', draft: publicDraft(next) }]);
}

// What the app gets: no tab id
function publicDraft(draft) {
    if (!draft) return null;
    const { tabId, ...rest } = draft;
    return rest;
}

// Shows the tab with the draft if it is still open there, otherwise opens it in the work tab
async function openDraft() {
    const { draft } = await chrome.storage.session.get('draft');
    if (!draft) return;
    const tab = draft.tabId != null && await chrome.tabs.get(draft.tabId).catch(() => null);
    const reused = !!(tab && tab.url && tab.url.includes(`/tasks/${draft.taskId}`));
    Telemetry.event('draft.opened', { taskId: draft.taskId, reusedTab: reused });
    if (reused) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
    } else {
        await openWorkTab(draft.url);
    }
}

// A draft the site deletes a day after creation: the journal gets one `draft.gone` when that
// time has passed (the draft itself stays until the site says it is gone)
async function checkDraftExpiry() {
    const { draft, draftGoneLogged } = await chrome.storage.session.get(['draft', 'draftGoneLogged']);
    if (!draft || !draft.expiresAt || draft.expiresAt > Date.now() || draftGoneLogged === draft.taskId) return;
    await chrome.storage.session.set({ draftGoneLogged: draft.taskId });
    Telemetry.event('draft.gone', { taskId: draft.taskId, reason: 'expired' });
}

// Every minute: an expired token ends the session; every 10–15 min one e-consul tab checks
// the token with auth/me
async function onTick() {
    Telemetry.flush();
    await checkDraftExpiry();
    const auth = await getAuth();
    if (auth.loggedIn === true && auth.exp && auth.exp <= Date.now()) {
        await updateAuth({ loggedIn: false, reason: 'expired' });
        return;
    }
    if (auth.loggedIn === true && auth.token && Date.now() >= (auth.nextCheckAt || 0)) {
        const tab = await findEconsulTab();
        if (tab) {
            await chrome.storage.session.set({ auth: { ...auth, nextCheckAt: Date.now() + randomCheckDelay() } });
            chrome.tabs.sendMessage(tab.id, { type: 'check-auth', token: auth.token }).catch(() => {});
        }
    }
}

// ---- Work tab ----

async function rememberWorkTab(tab) {
    if (!tab) return;
    const { workTabId } = await chrome.storage.session.get('workTabId');
    const current = workTabId != null && await chrome.tabs.get(workTabId).catch(() => null);
    if (!current) await chrome.storage.session.set({ workTabId: tab.id });
}

async function findEconsulTab() {
    const { workTabId } = await chrome.storage.session.get('workTabId');
    const work = workTabId != null && await chrome.tabs.get(workTabId).catch(() => null);
    if (work && work.url && work.url.startsWith('https://e-consul.gov.ua/')) return work;
    const [any] = await chrome.tabs.query({ url: ECONSUL_TABS });
    return any || null;
}

// Shows the work tab (opens a pinned one if there is none) and navigates it to url
async function openWorkTab(url) {
    const { workTabId } = await chrome.storage.session.get('workTabId');
    let tab = workTabId != null && await chrome.tabs.get(workTabId).catch(() => null);
    if (!tab) [tab] = await chrome.tabs.query({ url: ECONSUL_TABS });
    if (tab) tab = await chrome.tabs.update(tab.id, { active: true, url });
    else tab = await chrome.tabs.create({ url, pinned: true, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.storage.session.set({ workTabId: tab.id });
}

chrome.notifications.onButtonClicked.addListener(id => {
    if (id === 'login') { openWorkTab(LOGIN_URL); chrome.notifications.clear(id); }
});
chrome.notifications.onClicked.addListener(id => {
    if (id === 'login') { openWorkTab(LOGIN_URL); chrome.notifications.clear(id); }
});

// ---- Badge ----

async function renderBadge(auth) {
    auth = auth || await getAuth();
    const { settings } = await chrome.storage.local.get('settings');
    let text = '', color = '#0057B8';
    if (auth.loggedIn === false) { text = '!'; color = '#B42318'; }
    else if (settings && settings.paused) { text = '||'; color = '#4A5868'; }
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    await chrome.action.setTitle({ title: auth.loggedIn === false ? 'e-Consul Helper: увійдіть на e-consul' : 'e-Consul Helper' });
}

// ---- App (slots.html on localhost:3000) ----

async function appTabs() {
    return chrome.tabs.query({ url: APP_ORIGIN + '/*' });
}

async function sendToApps(messages) {
    for (const tab of await appTabs()) {
        for (const msg of messages) chrome.tabs.sendMessage(tab.id, { to: 'app', msg }).catch(() => {});
    }
}

// The app plays the session sound itself when one of its tabs is open and its audio was
// unlocked by a click (it reports that in app:hello / app:monitor)
async function appCanPlaySound() {
    const { app } = await chrome.storage.session.get('app');
    if (!app || !app.audioReady) return false;
    const tabs = await appTabs();
    for (const tab of tabs) {
        const reply = await chrome.tabs.sendMessage(tab.id, { to: 'bridge', type: 'ping' }).catch(() => null);
        if (reply && reply.ok) return true;
    }
    return false;
}

async function isAppConnected() {
    for (const tab of await appTabs()) {
        const reply = await chrome.tabs.sendMessage(tab.id, { to: 'bridge', type: 'ping' }).catch(() => null);
        if (reply && reply.ok) return true;
    }
    return false;
}

// A message from the page of the app, passed on by app-bridge.js. Returns messages to post
// back to that page.
async function onAppMessage(msg) {
    const auth = await getAuth();
    const { app = {} } = await chrome.storage.session.get('app');
    const setApp = patch => chrome.storage.session.set({ app: { ...app, ...patch, seenAt: Date.now() } });
    switch (msg.type) {
        case 'app:hello': {
            await setApp({ audioReady: !!msg.audioReady });
            const { draft = null } = await chrome.storage.session.get('draft');
            const replies = [{ type: 'ext:hello', version: VERSION }, authMessage(auth), { type: 'ext:draft', draft: publicDraft(draft) }, await settingsMessage()];
            if (auth.loggedIn === true && auth.token) replies.push({ type: 'ext:token', token: auth.token, exp: auth.exp });
            return replies;
        }
        case 'app:monitor':
            await setApp({ audioReady: !!msg.audioReady, monitor: msg.monitor || null });
            return [];
        case 'app:selection':
            await setApp({ selection: msg.selection || null });
            return [];
        case 'app:received':
            // The app took the token / draft link: the popup says so
            await setApp({
                tokenReceived: msg.exp ? { exp: msg.exp, at: Date.now() } : app.tokenReceived,
                draftReceived: msg.draftUrl ? { url: msg.draftUrl, at: Date.now() } : app.draftReceived
            });
            return [];
        case 'app:auth-failed':
            // The app used another token (an old one pasted by hand) while the site has a valid
            // one: send the current token instead of ending the session
            if (msg.token && auth.token && msg.token !== auth.token && auth.loggedIn === true) {
                return [{ type: 'ext:token', token: auth.token, exp: auth.exp }];
            }
            // The API rejected the token the app uses. If the site still has the same token,
            // econsul.js re-checks it with auth/me (onSiteToken, at most every 10 min)
            // soundPlayed: monitoring hit the 401 and played the session sound itself
            if (auth.loggedIn !== false) await updateAuth({ loggedIn: false, reason: 'api' }, { appPlayedSound: !!msg.soundPlayed });
            return [];
        case 'app:slots':
            Telemetry.event('app.slots-received', { count: (msg.slots || []).length, test: !!msg.test }, { test: !!msg.test });
            await chrome.storage.session.set({ lastSlots: { receivedAt: Date.now(), slots: msg.slots || [], range: msg.range || {}, test: !!msg.test } });
            // Not awaited: loading the draft takes up to a minute, other messages must not wait
            if ((msg.slots || []).length) startSelection(msg.slots, !!msg.test);
            return [{ type: 'ext:slots-received', count: (msg.slots || []).length }];
        case 'app:settings':
            // Only what the app shows: the auto-booking checkbox
            if (msg.patch && typeof msg.patch.autoBook === 'boolean') {
                Telemetry.event('user.auto-book', { enabled: msg.patch.autoBook, from: 'app' });
                await saveSettings({ autoBook: msg.patch.autoBook });
            }
            return [];
        case 'app:login':
            await openWorkTab(LOGIN_URL);
            return [];
        case 'app:mute':
            Telemetry.event('user.mute', { from: 'app' });
            await stopSounds(true);
            return [];
        case 'app:test-sound':
            Telemetry.event('user.test-sound', { sound: msg.sound === 'selected' ? 'selected' : msg.sound === 'glass' ? 'glass' : 'other', from: 'app' });
            if (msg.sound === 'selected') await playSound('selected', SELECTED_SOUND);
            else if (msg.sound === 'glass') await playSound('glass');
            return [];
        default:
            return [];
    }
}

// ---- Slot selection ----
// selection: { status: 'running' | 'selected' | 'booking' | 'booked' | 'book-failed' |
//              'failed' | 'skipped', jobId, taskId, tabId, slot, error, text, tried, test,
//              autoBook, startedAt, at }

async function setSelection(selection) {
    await chrome.storage.session.set({ selection });
    return selection;
}

// New slots from the app (earliest first, already within the date range): open the draft,
// go to the calendar and select the earliest one the site shows as free
async function startSelection(slots, test) {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const { selection, draft } = await chrome.storage.session.get(['selection', 'draft']);
    const now = Date.now();
    if (settings.paused) return setSelection({ status: 'skipped', error: 'paused', test, at: now });
    if (selection && ['running', 'booking'].includes(selection.status) && now - selection.startedAt < SELECT_TIMEOUT_MS) return;
    // The person may be pressing «Підтвердити» right now: do not switch the slot under them
    if (selection && selection.status === 'selected' && now - selection.at < SELECTED_HOLD_MS) return;
    if (!draft) return selectionFailed({ status: 'failed', test, startedAt: now }, 'no-draft');
    // This draft is booked: the site turns it into a sent application
    if (selection && selection.status === 'booked' && selection.taskId === draft.taskId) return;

    const jobId = crypto.randomUUID();
    const autoBook = !!settings.autoBook && !test; // test slots are never booked
    const current = await setSelection({ status: 'running', jobId, taskId: draft.taskId, test, autoBook, startedAt: now, at: now });

    // Load the draft again even if it is open on step 4: the calendar there may be old.
    // A direct address of step 4 opens step 3, from where econsul.js presses «Далі»
    let tab = draft.tabId != null && await chrome.tabs.get(draft.tabId).catch(() => null);
    if (!(tab && tab.url && tab.url.includes(`/tasks/${draft.taskId}`))) tab = null;
    if (tab) tab = await chrome.tabs.update(tab.id, { active: true, url: draft.url });
    else tab = await chrome.tabs.create({ url: draft.url, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await setSelection({ ...current, tabId: tab.id });
    Telemetry.event('selection.started', { taskId: draft.taskId, slots: slots.length, autoBook }, { jobId, test });

    // Wait until the new page's econsul.js answers for this task
    await new Promise(r => setTimeout(r, 1500));
    const end = Date.now() + TAB_READY_MS;
    let reply = null;
    while (Date.now() < end) {
        reply = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }).catch(() => null);
        if (reply && reply.ok && reply.taskId === draft.taskId) break;
        reply = null;
        await new Promise(r => setTimeout(r, 1000));
    }
    if (!reply) return selectionFailed({ ...current, tabId: tab.id }, 'tab-not-ready');
    Telemetry.event('selection.stage', { stage: 'tab-ready', taskId: draft.taskId, durationMs: Date.now() - now }, { jobId, test });
    await chrome.tabs.sendMessage(tab.id, { type: 'select-slot', jobId, taskId: draft.taskId, slots, autoBook }).catch(() => null);
}

async function selectionFailed(selection, error, tried = []) {
    Telemetry.event('selection.failed', {
        error: String(error).split(':')[0].slice(0, 50), // a code of SELECT_ERRORS, never page text
        taskId: selection.taskId || null,
        durationMs: selection.startedAt ? Date.now() - selection.startedAt : null
    }, { jobId: selection.jobId, test: selection.test });
    await setSelection({ ...selection, status: 'failed', error, tried, at: Date.now() });
    await sendToApps([{ type: 'ext:slot-failed', error, text: SELECT_ERRORS[error] || error, test: !!selection.test }]);
    if (selection.test && error === 'not-found') return; // test slots are made up
    chrome.notifications.create('slot', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Слот не вибрано',
        message: SELECT_ERRORS[error] || error,
        priority: 1
    });
}

// From econsul.js: the result of select-slot. booking: auto-booking presses «Підтвердити» next
async function onSlotResult({ jobId, ok, slot, error, tried, booking }) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.jobId !== jobId) return;
    if (!ok) return selectionFailed(selection, error, tried);
    Telemetry.event('selection.selected', {
        taskId: selection.taskId, date: slot.date, time: slot.time, autoBook: !!booking,
        durationMs: Date.now() - selection.startedAt
    }, { jobId, test: selection.test });
    if (booking) return setSelection({ ...selection, status: 'booking', slot, tried, at: Date.now() });
    await setSelection({ ...selection, status: 'selected', slot, tried, at: Date.now() });
    await playSound('selected', SELECTED_SOUND);
    const date = slot.date.split('-').reverse().join('.');
    chrome.notifications.create('slot', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `Вибрано слот ${date} о ${slot.time}`,
        message: 'Натисніть «Підтвердити» на сторінці e-consul, щоб забронювати.',
        requireInteraction: true,
        priority: 2
    });
    await sendToApps([{ type: 'ext:slot-selected', slot }]);
}

// From econsul.js: auto-booking pressed «Підтвердити». ok: the site said «Дякуємо»
async function onBookResult({ jobId, slot, ok, error, text }) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.jobId !== jobId) return;
    const date = slot.date.split('-').reverse().join('.');
    Telemetry.event(ok ? 'booking.booked' : 'booking.failed', {
        taskId: selection.taskId, date: slot.date, time: slot.time,
        ...(ok ? {} : { error: String(error).split(':')[0].slice(0, 50) })
    }, { jobId, test: selection.test });
    await setSelection({ ...selection, status: ok ? 'booked' : 'book-failed', slot, error: error || null, text: text || null, at: Date.now() });
    // Either way the person has to look: the result comes by email, or the slot waits for them
    await playSound('selected', SELECTED_SOUND);
    chrome.notifications.create('slot', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: ok ? `Заброньовано ${date} о ${slot.time}` : `Не вдалося забронювати ${date} о ${slot.time}`,
        message: ok
            ? 'Сайт прийняв заявку. Підтвердження прийде на email.'
            : `${SELECT_ERRORS[error] || error}${text ? ' ' + text.slice(0, 120) : ''} Слот лишився вибраним, можна натиснути «Підтвердити» самому.`,
        requireInteraction: true,
        priority: 2
    });
    await sendToApps([{ type: ok ? 'ext:slot-booked' : 'ext:slot-selected', slot }]);
}

async function showSelectionTab() {
    const { selection } = await chrome.storage.session.get('selection');
    const tab = selection && selection.tabId != null && await chrome.tabs.get(selection.tabId).catch(() => null);
    if (!tab) return openDraft();
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
}

chrome.notifications.onClicked.addListener(id => {
    if (id === 'slot') { showSelectionTab(); chrome.notifications.clear(id); }
});

// ---- Sounds (offscreen document) ----

async function ensureOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Сигнали про слот і завершену сесію, коли вкладка застосунку неактивна'
        });
    } catch (e) {
        if (!/single offscreen/i.test(e.message)) throw e;
    }
}

async function playSound(sound, opts = {}) {
    await ensureOffscreen();
    await chrome.storage.session.set({ sound: { name: sound, startedAt: Date.now(), playing: sound === 'selected' } });
    return chrome.runtime.sendMessage({ target: 'offscreen', type: 'play', sound, ...opts }).catch(() => null);
}

async function stopSounds(force) {
    await sendToApps([{ type: 'ext:mute' }]);
    if (!await chrome.offscreen.hasDocument()) return;
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop', force }).catch(() => null);
}

// ---- Settings (popup and app) ----

async function saveSettings(patch) {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...settings, ...patch } });
    await renderBadge();
    await sendToApps([await settingsMessage()]);
}

async function settingsMessage() {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    return { type: 'ext:settings', autoBook: !!settings.autoBook, paused: !!settings.paused };
}

// ---- Popup ----

async function onPopupMessage(msg) {
    switch (msg.type) {
        case 'popup:state': {
            const auth = await getAuth();
            const { app = null, lastSlots = null, draft = null, sound = null, selection = null } = await chrome.storage.session.get(['app', 'lastSlots', 'draft', 'sound', 'selection']);
            const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
            const { token, ...publicAuth } = auth; // the popup does not need the token itself
            return { version: VERSION, auth: { ...publicAuth, hasToken: !!token }, app, appConnected: await isAppConnected(), lastSlots, draft, sound, selection, selectErrors: SELECT_ERRORS, settings };
        }
        case 'popup:login':
            await openWorkTab(LOGIN_URL);
            return {};
        case 'popup:open-draft':
            await openDraft();
            return {};
        case 'popup:new-draft':
            // A new tab: the work tab may be showing the current draft. The site creates the task
            // and moves to /tasks/{id}/…, where econsul.js picks it up as the new draft
            await chrome.tabs.create({ url: NEW_APPLICATION_URL, active: true });
            return {};
        case 'popup:mute':
            Telemetry.event('user.mute', { from: 'popup' });
            await stopSounds(true);
            return {};
        case 'popup:settings':
            if (msg.patch && typeof msg.patch.paused === 'boolean') Telemetry.event('user.pause', { paused: msg.patch.paused, from: 'popup' });
            if (msg.patch && typeof msg.patch.autoBook === 'boolean') Telemetry.event('user.auto-book', { enabled: msg.patch.autoBook, from: 'popup' });
            await saveSettings(msg.patch);
            return {};
        default:
            return {};
    }
}

// ---- Message router ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen') return false; // for offscreen.js
    let handler = null;
    if (message.type === 'offscreen:alarm-ended') {
        handler = async () => {
            await chrome.storage.session.set({ sound: { playing: false, endedAt: Date.now(), reason: message.reason } });
            const { selection } = await chrome.storage.session.get('selection');
            if (selection && selection.tabId != null) chrome.tabs.sendMessage(selection.tabId, { type: 'sound-ended', reason: message.reason }).catch(() => {});
        };
    } else if (sender.tab && sender.url && sender.url.startsWith('https://e-consul.gov.ua/')) {
        if (message.type === 'econsul:token') handler = () => onSiteToken(message.token || null, sender.tab);
        else if (message.type === 'econsul:auth-check') handler = () => onAuthCheck(message);
        else if (message.type === 'econsul:task') handler = () => onSiteTask(message, sender.tab);
        else if (message.type === 'econsul:slot-result') handler = () => onSlotResult(message);
        else if (message.type === 'econsul:book-result') handler = () => onBookResult(message);
        else if (message.type === 'econsul:request') handler = () => onSiteRequest(message);
        else if (message.type === 'econsul:confirm-clicked') handler = async () => {
            const { selection } = await chrome.storage.session.get('selection');
            Telemetry.event('booking.confirm-clicked', { taskId: selection ? selection.taskId : null }, { jobId: selection && selection.jobId, test: !!(selection && selection.test) });
            await stopSounds(true);
        };
        else if (message.type === 'econsul:mute') handler = () => stopSounds(true);
    } else if (sender.tab && sender.origin === APP_ORIGIN && message.type === 'app') {
        // Only the app's own origin gets the token
        handler = () => onAppMessage(message.msg || {}).then(messages => ({ messages }));
    } else if (sender.id === chrome.runtime.id && sender.url && sender.url.startsWith(chrome.runtime.getURL('popup.html'))) {
        // The popup (also when opened as a tab, e.g. for screenshots)
        handler = () => onPopupMessage(message);
    }
    if (!handler) return false;
    serial(handler).then(sendResponse, error => sendResponse({ error: error.message }));
    return true;
});
