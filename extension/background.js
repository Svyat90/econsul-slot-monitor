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
// A new draft (steps 1–3 of «Запис на візит») is also made by clicks (creator.js): after a login
// when there is no usable draft, and when the app or the popup asks. Settings come from the app.

importScripts('telemetry.js'); // Telemetry: own requests and events for the local server

const APP_ORIGIN = 'http://localhost:4000';
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
// alarmLeadMin: the reminder fires this many minutes before the current location opens new days
// autoMonitor: after a login the app starts monitoring by itself (off until the person turns it on)
// releaseStrike: at the opening of new days «Далі» on step 3 is pressed exactly at the moment (see onReleaseStrike)
const DEFAULT_SETTINGS = { paused: false, autoBook: false, aggressiveBook: false, autoDraft: true, autoMonitor: false, alarmEnabled: true, alarmLeadMin: 5, releaseStrike: true };
const ALARM_LEAD_MIN = 1, ALARM_LEAD_MAX = 60;
// The draft is opened on step 3 this long before the opening, so the page is loaded (also on a
// slow site) when «Далі» is pressed at the moment (2 min: the owner's decision, 2026-10-21; it was 30 s)
const STRIKE_LEAD_MS = 2 * 60 * 1000;
const STRIKE_LATE_MS = 60 * 1000; // woke up later than this after the opening: no strike
// «Далі» this long after the opening. It was 500 ms (2026-10-20/21) on the theory that the API needs
// a moment; the «no time» it was meant to avoid was the picker taking the waiting-queue button for
// the site's answer (2026-10-22), so «Далі» is pressed at the moment again (the owner's decision,
// 2026-10-22). lateMs in the journal counts from the opening
const STRIKE_DELAY_MS = 0;
// When new days open the site is loaded by everyone who tries to book and answers many times
// slower: the timeouts are generous and a failed selection starts over (see RETRYABLE)
const SELECT_TIMEOUT_MS = 10 * 60 * 1000; // a selection without a result by then has failed
const SELECTED_HOLD_MS = 3 * 60 * 1000;   // new slots do not replace a selected one this soon
const TAB_READY_MS = 120 * 1000;          // the draft page loads and econsul.js answers
const LOGIN_DRAFT_DELAY_MS = 12 * 1000;   // after a login: tabs report their draft before we decide to make one
const DRAFT_JOB_TIMEOUT_MS = 8 * 60 * 1000; // creating a draft takes ~20 s (minutes on a loaded site); no result by then is a failure
const DRAFT_SOUND_MAX_AGE_MS = 20 * 60 * 1000; // «draft saved» sounds only for a draft this young

// Errors that may be the site's load, not a lost slot: the selection starts over with a pause that
// doubles (5, 10, 20, 40 s), up to MAX_SELECT_ATTEMPTS tries. Nothing else is retried: «not-found»
// means the slot is gone, and a booking is never repeated
const RETRYABLE = new Set(['tab-not-ready', 'form-not-loaded', 'next-disabled', 'step-stuck', 'unavailable', 'calendar-not-loaded', 'timeout']);
const MAX_SELECT_ATTEMPTS = 5;

// Do not hammer the site with a slot that does not book (it may hang on the site's side or be a
// trap for bots: the same two slots stayed free for days and always answered «Сервіс недоступний»).
// - A press of «Підтвердити» answered «unavailable» (or any failure) puts the SLOT in quarantine;
//   every next failure makes it longer: 10 min, 30 min, 2 h, 6 h, 24 h. It is skipped (not even
//   selected) until then, also across restarts of the monitor, which announces it again as new.
// - One press per slot, then the next slot (the owner's decision, 2026-10-18; it was 3 presses,
//   6 around the opening of new days): a failure moves on instead of pressing the same slot again.
// - At most MAX_PRESSES_PER_HOUR presses over all slots; over that, slots are selected but not booked.
// A booked slot clears its history. Kept in chrome.storage.local (`bookingHistory`, `pressLog`).
const QUARANTINE_MS = [10, 30, 120, 360, 1440].map(minutes => minutes * 60 * 1000);
const MAX_PRESSES_PER_HOUR = 20;
// The next slot of a chain is tried at once; a slot that was in quarantine before (it is tried
// again) waits a random pause first, so the presses do not come at an even beat (the owner's
// decision, 2026-10-18). Aggressive booking never waits
const RETRY_SLOT_PAUSE_MIN_MS = 1 * 1000;
const RETRY_SLOT_PAUSE_MAX_MS = 5 * 1000;
// Aggressive booking (the owner's decision, 2026-10-18): no press limit, every failure = a flat
// 5 min quarantine, the next slot at once. Turned off when the session ends
const AGGRESSIVE_QUARANTINE_MS = 5 * 60 * 1000;
// With auto-booking on, booking is aggressive by itself around the opening of new days: from the
// strike (STRIKE_LEAD_MS before) to this long after the moment, the app's fast checks included
// (the owner's decision, 2026-10-21). The setting itself is not changed
const OPENING_AGGRESSIVE_AFTER_MS = 3 * 60 * 1000;
// Failures after which the next slot is tried. no-outcome and alert too (the owner's decision,
// 2026-10-18), although the site may have booked: then the person may get a second appointment
const ADVANCE_ERRORS = new Set(['unavailable', 'alert', 'no-outcome']);
const RETRY_PAUSE_MS = 5 * 1000;
// The same for creating a draft: the site may be slow, or a login may still be settling
const DRAFT_RETRYABLE = new Set(['tab-not-ready', 'form-not-loaded', 'country-not-found', 'country-not-found-missing', 'institution-not-found', 'institution-not-found-missing', 'service-not-found', 'service-not-found-missing', 'check-timeout', 'unavailable', 'next-disabled', 'step-stuck', 'timeout']);
const MAX_DRAFT_ATTEMPTS = 3;
const DRAFT_RETRY_PAUSE_MS = 10 * 1000;

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
    'draft-gone': 'Чернетки вже немає на сайті: створюю нову й вибираю слот у ній.',
    'draft-reset': 'Чернетка відкрилась не на кроці 3 (сайт її скинув): створюю нову.',
    'wrong-step': 'Чернетка відкрилась не на кроці 3.',
    'tab-left': 'Вкладку вибору слота закрито або в ній відкрито іншу сторінку.',
    // Auto-booking (picker.js, confirm)
    'not-on-calendar': 'Сторінка пішла з календаря до бронювання.',
    'slot-not-selected': 'Слот перестав бути вибраним.',
    'several-selected': 'Вибрано кілька слотів, автоматично не бронюю.',
    'no-confirm-button': 'Немає активної кнопки «Підтвердити».',
    'alert': 'Сайт показав повідомлення.',
    'left-calendar': 'Сайт пішов з календаря без «Дякуємо».',
    'no-outcome': 'Після «Підтвердити» сайт нічого не показав за 240 с.',
    'quarantined': 'Ці слоти недавно не забронювались: пропускаю їх, щоб не навантажувати сайт.'
};
// Why a draft was not created; shown in the popup, the app and the notification
const DRAFT_ERRORS = {
    'no-selection': 'Застосунок ще не передав установу й послугу. Відкрийте його й виберіть установу.',
    'not-logged-in': 'Спершу увійдіть на e-consul.',
    'tab-not-ready': 'Сторінка нової заявки не відповіла (можливо, сайт просить увійти).',
    'form-not-loaded': 'Форма заявки не завантажилась.',
    'applicant-incomplete': 'У профілі на e-consul не заповнені дані заявника (крок 1).',
    'consent-not-set': 'Не вдалося поставити згоду на кроці 1.',
    'country-not-found': 'Країну з налаштувань не знайдено у списку сайту.',
    'country-not-found-missing': 'Поле «Країна» не знайдено на кроці 2.',
    'institution-not-found': 'Установу з налаштувань не знайдено у списку сайту.',
    'institution-not-found-missing': 'Поле «Консульська установа» не з’явилось на кроці 2.',
    'service-not-found': 'Послугу з налаштувань не знайдено у списку сайту.',
    'service-not-found-missing': 'Поле «Послуга» не знайдено на кроці 3.',
    'check-timeout': 'Сайт довго перевіряє послугу.',
    'unavailable': 'Сайт пише, що запис зараз недоступний.',
    'self-not-set': 'Не вдалося вибрати «Для себе».',
    'next-disabled': 'Кнопка «Далі» неактивна.',
    'step-stuck': 'Сайт не перейшов на наступний крок.',
    'wrong-step': 'Заявка відкрилась на несподіваному кроці.',
    'timeout': 'Створення чернетки не завершилось вчасно.',
    'busy': 'Зараз іде вибір слота.'
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
    scheduleReleaseAlarm();
    // Tabs opened before the install or reload have no content scripts (or orphaned ones)
    for (const { js, matches } of chrome.runtime.getManifest().content_scripts) {
        for (const tab of await chrome.tabs.query({ url: matches })) {
            chrome.scripting.executeScript({ target: { tabId: tab.id }, files: js }).catch(() => {});
        }
    }
});
chrome.runtime.onStartup.addListener(() => { ensureAlarms(); renderBadge(); scheduleReleaseAlarm(); });
ensureAlarms();

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'tick') serial(onTick);
    else if (alarm.name === 'draft-login') serial(() => maybeCreateDraft('login'));
    else if (alarm.name === 'release-alarm') serial(onReleaseAlarm);
    else if (alarm.name === 'release-strike') serial(onReleaseStrike);
});

chrome.tabs.onRemoved.addListener(async tabId => {
    const { workTabId } = await chrome.storage.session.get('workTabId');
    if (workTabId === tabId) await chrome.storage.session.remove('workTabId');
    serial(() => onSelectionTabLeft(tabId, null));
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
        if (prev.loggedIn !== true) {
            Telemetry.event('session.logged-in');
            // A login: make a draft if there is no usable one, after tabs had time to report theirs
            chrome.alarms.create('draft-login', { when: Date.now() + LOGIN_DRAFT_DELAY_MS });
        }
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
    // Aggressive booking lasts one session: after a new login it is turned on again by hand
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    if (settings.aggressiveBook) {
        Telemetry.event('user.aggressive-book', { enabled: false, from: 'session' });
        await saveSettings({ aggressiveBook: false });
    }
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
    const { draft, resetDrafts = [] } = await chrome.storage.session.get(['draft', 'resetDrafts']);
    if (resetDrafts.includes(taskId)) return; // the site reset it (see forgetResetDraft): a tab showing it does not bring it back
    if (info && (info.missing || info.finished || info.deleted)) {
        if (draft && draft.taskId === taskId) {
            Telemetry.event('draft.gone', { taskId, reason: info.missing ? 'missing' : info.finished ? 'finished' : 'deleted' });
            await chrome.storage.session.remove('draft');
            await sendToApps([{ type: 'ext:draft', draft: null }]);
            await onSelectionDraftGone(taskId);
        }
        return;
    }
    const same = draft && draft.taskId === taskId;
    const createdAt = (info && info.createdAt) || (same ? draft.createdAt : null);
    // Several tabs may show applications (an abandoned half-filled one next to the new draft) and
    // each repeats its report. The newest application stays the draft: another one replaces it
    // only when it is known to be newer, or when we know nothing about the current one's age
    if (draft && !same && draft.createdAt && !(createdAt && createdAt > draft.createdAt)) return;
    // The institution and service of a draft we made (the tab of the creation shows it); unknown
    // for a draft the person made on the site
    const { draftJob } = await chrome.storage.session.get('draftJob');
    const made = !same && draftJob && draftJob.tabId === tab.id && draftJob.institutionCode ? draftJob : null;
    const next = {
        url, taskId, step,
        institutionCode: same ? draft.institutionCode || null : made ? made.institutionCode : null,
        serviceCode: same ? draft.serviceCode || null : made ? made.serviceCode : null,
        createdAt,
        expiresAt: createdAt ? createdAt + DRAFT_TTL_MS : null,
        foundAt: same ? draft.foundAt : Date.now(),
        tabId: tab.id
    };
    await chrome.storage.session.set({ draft: next });
    if (!same) Telemetry.event('draft.found', { taskId, step: step || null });
    if (step === 'dateAndTimeVisitInfo' && !(same && draft.step === step)) await draftSavedSound(next);
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

// The draft reached step 4 with nothing selected: it is saved and ready. One soft sound per
// draft; not for a draft that slot picking only reopens, nor for an old one found after a reload
async function draftSavedSound(draft) {
    const { draftSounded, selection } = await chrome.storage.session.get(['draftSounded', 'selection']);
    if (draftSounded === draft.taskId) return;
    if (selection && selection.taskId === draft.taskId) return;
    if (!draft.createdAt || Date.now() - draft.createdAt > DRAFT_SOUND_MAX_AGE_MS) return;
    await chrome.storage.session.set({ draftSounded: draft.taskId });
    Telemetry.event('draft.created', { taskId: draft.taskId, ageMs: Date.now() - draft.createdAt });
    await playSound('draft');
}

// ---- Draft creation ----
// draftJob: { status: 'running' | 'done' | 'failed', jobId, reason, tabId, error, startedAt, at }

async function setDraftJob(job) {
    await chrome.storage.session.set({ draftJob: job });
    await sendToApps([draftJobMessage(job)]);
    return job;
}

function draftJobMessage(job) {
    if (!job || job.status === 'done') return { type: 'ext:draft-job', status: null };
    return { type: 'ext:draft-job', status: job.status === 'retrying' ? 'running' : job.status, error: job.error || null, text: job.error ? (DRAFT_ERRORS[job.error] || job.error) : null };
}

async function getAppSelection() {
    const { lastSelection = null } = await chrome.storage.local.get('lastSelection');
    return lastSelection;
}

// A draft made on an earlier day (the user's calendar day) is not used, although the site keeps it
// for 24 h: the morning after, the site opened such a draft on step 1 instead of step 3 (the
// owner's report, 2026-10-20). A new day gets a new draft
function draftFromEarlierDay(draft) {
    return !!(draft && draft.createdAt && new Date(draft.createdAt).toDateString() !== new Date().toDateString());
}

// Made for another institution or service than the app monitors now (the person changed them in
// the app): its calendar never shows the app's slots, every selection in it ends «no time» (seen
// 2026-10-22: Houston's slots tried in a Chicago draft). Known only for drafts we made
function draftForOtherPlace(draft, appSelection) {
    return !!(draft && draft.institutionCode && appSelection && appSelection.institutionCode
        && (draft.institutionCode !== appSelection.institutionCode || draft.serviceCode !== appSelection.serviceCode));
}

// Expired (the site deletes it a day after creation), made on an earlier day, or (when the app's
// selection is given) made for another institution or service
function draftOutdated(draft, appSelection = null) {
    return !!(draft && ((draft.expiresAt && draft.expiresAt <= Date.now()) || draftFromEarlierDay(draft) || draftForOtherPlace(draft, appSelection)));
}

// The site reset a draft (it opens on step 1 or 2, picker.js RESET_STEPS): it is forgotten, and
// the tabs still showing it do not bring it back as the draft (onSiteTask)
async function forgetResetDraft(taskId) {
    const { draft, resetDrafts = [] } = await chrome.storage.session.get(['draft', 'resetDrafts']);
    if (!resetDrafts.includes(taskId)) await chrome.storage.session.set({ resetDrafts: [...resetDrafts, taskId].slice(-20) });
    Telemetry.event('draft.gone', { taskId, reason: 'reset' });
    if (draft && draft.taskId === taskId) {
        await chrome.storage.session.remove('draft');
        await sendToApps([{ type: 'ext:draft', draft: null }]);
    }
}

// Is there a draft worth keeping? None known, an expired one, one made on an earlier day, or one
// the site has sent or deleted does not count. The site is asked through a tab; no tab or no
// answer keeps the draft
async function draftIsUsable() {
    const { draft } = await chrome.storage.session.get('draft');
    if (!draft) return false;
    if (draft.expiresAt && draft.expiresAt <= Date.now()) return false;
    if (draftFromEarlierDay(draft)) {
        Telemetry.event('draft.gone', { taskId: draft.taskId, reason: 'earlier-day' });
        return false;
    }
    if (draftForOtherPlace(draft, await getAppSelection())) {
        Telemetry.event('draft.gone', { taskId: draft.taskId, reason: 'other-place' });
        return false;
    }
    const tab = await findEconsulTab();
    if (!tab) return true;
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'check-task', taskId: draft.taskId }).catch(() => null);
    const info = reply && reply.info;
    if (info && (info.missing || info.finished || info.deleted)) {
        Telemetry.event('draft.gone', { taskId: draft.taskId, reason: info.missing ? 'missing' : info.finished ? 'finished' : 'deleted' });
        await chrome.storage.session.remove('draft');
        await sendToApps([{ type: 'ext:draft', draft: null }]);
        return false;
    }
    return true;
}

// After a login: make a draft only when there is none usable
async function maybeCreateDraft(reason) {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    if (settings.autoDraft === false || settings.paused) return;
    const auth = await getAuth();
    if (auth.loggedIn !== true) return;
    if (await draftIsUsable()) return;
    await createDraft(reason);
}

// Opens a new application and fills steps 1–3 from the app's settings (institution, service).
// reason: 'login' (the work tab that just logged in), 'app' / 'popup' (a new tab: the work tab
// may be showing the current draft)
async function createDraft(reason, attempt = 1) {
    const { draftJob, selection } = await chrome.storage.session.get(['draftJob', 'selection']);
    const now = Date.now();
    if (draftJob && draftJob.status === 'running' && now - draftJob.startedAt < DRAFT_JOB_TIMEOUT_MS) return;
    const job = { status: 'running', jobId: crypto.randomUUID(), reason, attempt, startedAt: now, at: now };
    const busy = selection && ['running', 'booking'].includes(selection.status) && now - selection.startedAt < SELECT_TIMEOUT_MS;
    if (busy) return draftFailed(job, 'busy');
    if ((await getAuth()).loggedIn !== true) return draftFailed(job, 'not-logged-in');
    const appSelection = await getAppSelection();
    if (!appSelection) return draftFailed(job, 'no-selection');

    await setDraftJob({ ...job, institutionCode: appSelection.institutionCode, serviceCode: appSelection.serviceCode });
    Telemetry.event('draft.create-started', { reason, institution: appSelection.institutionCode, service: appSelection.serviceCode }, { jobId: job.jobId });
    let tab;
    if (reason === 'login') tab = await openWorkTab(NEW_APPLICATION_URL);
    else {
        tab = await chrome.tabs.create({ url: NEW_APPLICATION_URL, active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
    }
    await setDraftJob({ ...job, institutionCode: appSelection.institutionCode, serviceCode: appSelection.serviceCode, tabId: tab.id });

    // The site creates the task and moves to /tasks/{id}/applicantInfo; wait for econsul.js there
    await new Promise(r => setTimeout(r, 2500));
    const end = Date.now() + TAB_READY_MS;
    let reply = null;
    while (Date.now() < end) {
        reply = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }).catch(() => null);
        if (reply && reply.ok && !reply.busy && /^\/tasks\/(?!create\/)[^/]+\//.test(reply.path || '')) break;
        reply = null;
        await new Promise(r => setTimeout(r, 1000));
    }
    if (!reply) return draftFailed({ ...job, tabId: tab.id }, 'tab-not-ready');
    await chrome.tabs.sendMessage(tab.id, { type: 'create-draft', jobId: job.jobId, selection: appSelection }).catch(() => null);
}

async function draftFailed(job, error) {
    const code = String(error).split(':')[0].slice(0, 50);
    const attempt = job.attempt || 1;
    const willRetry = DRAFT_RETRYABLE.has(code) && attempt < MAX_DRAFT_ATTEMPTS;
    Telemetry.event('draft.create-failed', { error: code, reason: job.reason || null, attempt, willRetry, durationMs: job.startedAt ? Date.now() - job.startedAt : null }, { jobId: job.jobId });
    if (willRetry) {
        // A loaded site (or a login that is still settling): start over after a pause, quietly
        await setDraftJob({ ...job, status: 'retrying', error, at: Date.now() });
        setTimeout(() => serial(async () => {
            const { draftJob } = await chrome.storage.session.get('draftJob');
            if (!draftJob || draftJob.jobId !== job.jobId || draftJob.status !== 'retrying') return;
            await createDraft(job.reason, attempt + 1);
        }), DRAFT_RETRY_PAUSE_MS * attempt);
        return;
    }
    await setDraftJob({ ...job, status: 'failed', error, at: Date.now() });
    chrome.notifications.create('draft', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Чернетку не створено',
        message: (DRAFT_ERRORS[error] || error) + ' Створіть її вручну на e-consul.',
        requireInteraction: true,
        priority: 2
    });
}

// From econsul.js: steps 1–3 are over (ok) or stopped with an error code
async function onDraftResult({ jobId, ok, error, taskId }) {
    const { draftJob } = await chrome.storage.session.get('draftJob');
    if (!draftJob || draftJob.jobId !== jobId) return {};
    if (!ok) return draftFailed(draftJob, error || 'step-stuck');
    // The scan's selection is set before the job ends: a selection waiting for this draft
    // (runSelection) then finds it busy and leaves its slots waiting instead of reloading the tab
    const scan = await startDraftScan(draftJob, typeof taskId === 'string' ? taskId : null);
    // The draft itself arrives as the tab reports step 4 (onSiteTask)
    await setDraftJob({ ...draftJob, status: 'done', at: Date.now() });
    return scan;
}

// A new draft stands on its calendar (step 4): its free slots are selected right there, booked
// with auto-booking, in the usual order (date range, quarantine, day by day) — without waiting for
// the monitor, which offers slots only once it runs and has checked (the owner's decision,
// 2026-10-22). A «running» selection like the strike: the app's slots wait for it (waitingSlots).
// Not when slots made the draft (runSelection goes on with them), nor during a booking or right
// after a selection the person may be confirming
async function startDraftScan(draftJob, taskId) {
    if (!taskId || draftJob.reason === 'slots' || draftJob.tabId == null) return {};
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    if (settings.paused) return {};
    const { selection } = await chrome.storage.session.get('selection');
    const now = Date.now();
    if (selection && ['running', 'booking'].includes(selection.status) && now - selection.startedAt < SELECT_TIMEOUT_MS) return {};
    if (selection && selection.status === 'selected' && now - selection.at < SELECTED_HOLD_MS) return {};
    const range = await appDateRange();
    const { autoBook, aggressive, limitUntil } = await bookingPlan(settings, false);
    const jobId = crypto.randomUUID();
    await setSelection({ status: 'running', scan: true, jobId, taskId, tabId: draftJob.tabId, test: false, autoBook, aggressive, limitUntil, slots: [], attempt: 1, startedAt: now, at: now });
    Telemetry.event('selection.started', { taskId, slots: 0, autoBook, aggressive, attempt: 1, scan: true }, { jobId, test: false });
    return { scan: { jobId, range: { from: range.from || null, to: range.to || null } } };
}

// From econsul.js: the free slots of the new draft's calendar (see startDraftScan). Answers with
// the slots to select there ({ next }): the app's new slots that came meanwhile first, then these,
// then all the app's free slots
async function onScanResult({ jobId, error, searches, slots: found }) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.jobId !== jobId || selection.status !== 'running' || !selection.scan) return {};
    const shown = cleanSlots(found);
    const code = error ? String(error).split(':')[0].slice(0, 50) : null;
    Telemetry.event('selection.stage', {
        stage: 'draft-scan', taskId: selection.taskId, error: code, free: shown.length,
        searches: typeof searches === 'string' && /^[a-z:,0-9-]*$/.test(searches) ? searches.slice(0, 300) : null
    }, { jobId, test: false });
    if (code) {
        await strikeFailed(selection, code);
        return {};
    }
    const range = await appDateRange();
    const inRange = shown.filter(s => (!range.from || s.date >= range.from) && (!range.to || s.date <= range.to));
    const { waitingSlots = { fresh: [], all: [] } } = await chrome.storage.session.get('waitingSlots');
    if (!inRange.length && !waitingSlots.fresh.length && !waitingSlots.all.length) {
        // No free slot in the draft: nothing to report, the monitor goes on as usual
        await setSelection({ ...selection, status: 'skipped', error: 'no-free', at: Date.now() });
        return {};
    }
    return selectOnCalendar(selection, mergeSlots(waitingSlots.fresh, inRange), mergeSlots(waitingSlots.fresh, inRange, waitingSlots.all));
}

function cleanSlots(found) {
    const isDate = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d);
    return (Array.isArray(found) ? found : [])
        .filter(s => s && isDate(s.date) && typeof s.time === 'string' && /^\d\d:\d\d$/.test(s.time))
        .map(({ date, time }) => ({ date, time }));
}

// The selection on the calendar a strike or a draft scan has open: quarantine, the usual order
// (fresh first) and the booking plan; answers the data of select-slot ({ next }) or {}
async function selectOnCalendar(selection, fresh, candidates) {
    await chrome.storage.session.remove('waitingSlots');
    if (!candidates.length) {
        await endSelection(selection, 'not-found');
        return {};
    }
    const usable = await usableSlots(candidates, false, Date.now());
    if (!usable) return {}; // all in quarantine: the selection is «skipped»
    const slots = tryOrder(usable, fresh);
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    if (settings.paused) {
        await setSelection({ status: 'skipped', error: 'paused', test: false, at: Date.now() });
        return {};
    }
    const { autoBook, aggressive, confirmTries, limitUntil } = await bookingPlan(settings, false);
    await setSelection({ ...selection, slots, autoBook, aggressive, limitUntil, at: Date.now() });
    const { jobId, taskId } = selection;
    return { next: { jobId, taskId, slots, autoBook, confirmTries, note: limitUntil ? limitText(limitUntil) : null } };
}

// A creation without a result for too long has failed (the tab was closed, the page froze)
async function checkDraftJobTimeout() {
    const { draftJob } = await chrome.storage.session.get('draftJob');
    if (draftJob && draftJob.status === 'running' && Date.now() - draftJob.startedAt > DRAFT_JOB_TIMEOUT_MS) await draftFailed(draftJob, 'timeout');
}

// ---- Release alarm ----
// A reminder shortly before the current location opens new days (nextRelease of the app: its
// opening moment in the user's time): log in if the session is gone, start the monitor if it is
// not running. It creates nothing. The release comes from the app; it is kept in local storage
// so the alarm is set again after a browser start, before the app is open.

async function rememberNextRelease(release) {
    if (!release || !Number.isFinite(release.at)) return;
    const { nextRelease } = await chrome.storage.local.get('nextRelease');
    // an opening that has begun is kept: the booking window counts from it
    if (release.at <= Date.now()) await chrome.storage.local.set({ lastOpenAt: release.at });
    if (nextRelease && nextRelease.at === release.at) return;
    await chrome.storage.local.set({ nextRelease: { at: release.at, opening: release.opening || null } });
    await scheduleReleaseAlarm();
}

// Sets (or clears) the alarms for the stored release: the reminder and the strike at the opening.
// Returns when the reminder fires, or null
async function scheduleReleaseAlarm() {
    const { settings = DEFAULT_SETTINGS, nextRelease = null } = await chrome.storage.local.get(['settings', 'nextRelease']);
    const all = { ...DEFAULT_SETTINGS, ...settings };
    await setAlarm('release-strike', nextRelease && all.releaseStrike !== false ? nextRelease.at - STRIKE_LEAD_MS : null);
    return setAlarm('release-alarm', nextRelease && all.alarmEnabled !== false ? nextRelease.at - all.alarmLeadMin * 60 * 1000 : null);
}

async function setAlarm(name, when) {
    const existing = await chrome.alarms.get(name);
    if (!when || when <= Date.now()) {
        if (existing) await chrome.alarms.clear(name);
        return null;
    }
    if (!existing || Math.abs(existing.scheduledTime - when) > 1000) await chrome.alarms.create(name, { when });
    return when;
}

// Did the app take the draft link? The app answers ext:draft with app:received (draftReceived).
// Not yet: send the draft once more and give the app a moment
async function draftBoundToApp() {
    const bound = async () => {
        const { draft, app } = await chrome.storage.session.get(['draft', 'app']);
        return !!(draft && app && app.draftReceived && app.draftReceived.url === draft.url);
    };
    if (await bound()) return true;
    const { draft } = await chrome.storage.session.get('draft');
    await sendToApps([{ type: 'ext:draft', draft: publicDraft(draft) }]);
    await new Promise(r => setTimeout(r, 2500));
    return bound();
}

// The alarm: before the opening make sure everything is ready. Not logged in → remind to log
// in; monitor not running → remind to start it; no usable draft (none, expired, deleted or sent
// by the site, or one the app did not take) → make a fresh one. All in order — silence, the app
// still gets ext:alarm and shows nothing then
async function onReleaseAlarm() {
    const { settings = DEFAULT_SETTINGS, nextRelease = null } = await chrome.storage.local.get(['settings', 'nextRelease']);
    if (!nextRelease || settings.alarmEnabled === false) return;
    if (Date.now() > nextRelease.at + 2 * 60 * 1000) return; // woke up from sleep after the opening: too late to remind
    const auth = await getAuth();
    const { app = null } = await chrome.storage.session.get('app');
    const appOpen = await isAppConnected();
    const running = !!(appOpen && app && app.monitor && app.monitor.running);
    const at = nextRelease.at;
    const time = new Date(at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    const loggedIn = auth.loggedIn === true;
    // Logged in: the draft must exist, be alive on the site and be bound to the app (when it is open)
    let draftOk = true;
    if (loggedIn) {
        draftOk = await draftIsUsable();
        if (draftOk && appOpen) draftOk = await draftBoundToApp();
    }
    Telemetry.event('alarm.fired', { loggedIn, monitorRunning: running, appOpen, draftOk, opensAt: time });
    await sendToApps([{ type: 'ext:alarm', at, opening: nextRelease.opening || null }]);
    // Not awaited: it takes ~20 s and the messages of other handlers wait in the queue behind us
    if (loggedIn && !draftOk && settings.autoDraft !== false && !settings.paused) createDraft('alarm').catch(() => {});
    if (loggedIn && running) return;
    chrome.notifications.create('alarm', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: loggedIn ? 'Скоро відкриття: запустіть моніторинг' : 'Скоро відкриття: увійдіть на e-consul',
        message: `Нові дні відкриваються о ${time}. ` + (loggedIn
            ? (appOpen ? 'Моніторинг не запущено: натисніть «Запустити» в застосунку.' : 'Відкрийте застосунок і запустіть моніторинг.')
            : 'Сесії немає, моніторинг не працюватиме.'),
        buttons: loggedIn ? [] : [{ title: 'Увійти' }],
        requireInteraction: true,
        priority: 2
    });
    await playSound('reminder');
}

// ---- Strike at the opening ----
// The site builds the calendar from the browser's clock (booking.md §6): the new day is in it only
// when step 4 is loaded after the opening moment, and waiting for the app to find the slots and
// then loading the draft takes tens of seconds. So STRIKE_LEAD_MS before the opening the draft is
// opened on step 3 and econsul.js presses «Далі» exactly at the moment (picker.js strike). The
// free slots of the last week of that calendar then go through the usual selection on it, without
// loading the draft again. The strike is a «running» selection: slots from the app wait for it
// (waitingSlots), and nothing else reloads the tab

async function onReleaseStrike() {
    const { settings = DEFAULT_SETTINGS, nextRelease = null } = await chrome.storage.local.get(['settings', 'nextRelease']);
    if (!nextRelease || settings.releaseStrike === false) return;
    // Not awaited: it may wait for a draft being made, whose messages go through serial
    runStrike(nextRelease.at).catch(() => {});
}

async function runStrike(at) {
    const skip = reason => { Telemetry.event('selection.stage', { stage: 'strike-skipped', reason, opensAt: new Date(at).toISOString() }); return null; };
    if (Date.now() > at + STRIKE_LATE_MS) return skip('late'); // the computer slept through the opening
    // The reminder before the opening may be making a fresh draft right now: wait for it
    while (Date.now() < at + STRIKE_LATE_MS) {
        const { draftJob } = await chrome.storage.session.get('draftJob');
        if (!draftJob || !['running', 'retrying'].includes(draftJob.status) || Date.now() - draftJob.startedAt > DRAFT_JOB_TIMEOUT_MS) break;
        await new Promise(r => setTimeout(r, 1000));
    }
    const started = await serial(async () => {
        const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
        if (settings.paused || settings.releaseStrike === false) return skip('off');
        if ((await getAuth()).loggedIn !== true) return skip('not-logged-in');
        const { selection, draft } = await chrome.storage.session.get(['selection', 'draft']);
        if (!draft || draftOutdated(draft)) return skip('no-draft');
        if (draftForOtherPlace(draft, await getAppSelection())) return skip('other-place');
        const now = Date.now();
        // A booking under way is never interrupted, nor a slot the person may be booking right now
        if (selection && selection.status === 'booking' && now - selection.startedAt < SELECT_TIMEOUT_MS) return skip('booking');
        if (selection && selection.status === 'selected' && now - selection.at < SELECTED_HOLD_MS) return skip('selected');
        // A selection loading the draft (or waiting to retry) gives way: its slots are tried on the
        // calendar of the opening
        if (selection && ['running', 'retrying'].includes(selection.status) && !selection.test && selection.slots) await keepWaitingSlots(selection.slots, false);
        const { autoBook, aggressive, limitUntil } = await bookingPlan(settings, false);
        const current = await setSelection({ status: 'running', strike: at, jobId: crypto.randomUUID(), taskId: draft.taskId, test: false, autoBook, aggressive, limitUntil, slots: [], attempt: 1, startedAt: now, at: now });
        return { current, draft };
    });
    if (!started) return;
    const { current, draft } = started;
    const { jobId } = current;
    const since = Date.now();
    const tab = await openDraftStep3(draft);
    if (!await selectionRunning(jobId)) return;
    await setSelection({ ...current, tabId: tab.id });
    Telemetry.event('selection.started', { taskId: draft.taskId, slots: 0, autoBook: current.autoBook, aggressive: current.aggressive, attempt: 1, strike: true, msBeforeOpening: at - Date.now() }, { jobId, test: false });
    const reply = await waitForTask(tab.id, draft.taskId, since);
    if (!await selectionRunning(jobId)) return;
    if (!reply) return serial(async () => {
        const { selection } = await chrome.storage.session.get('selection');
        if (selection && selection.jobId === jobId && selection.status === 'running') await strikeFailed(selection, 'tab-not-ready');
    });
    Telemetry.event('selection.stage', { stage: 'tab-ready', taskId: draft.taskId, msBeforeOpening: at - Date.now() }, { jobId, test: false });
    await chrome.tabs.sendMessage(tab.id, { type: 'release-strike', jobId, taskId: draft.taskId, at: at + STRIKE_DELAY_MS }).catch(() => null);
}

// The strike did not reach the calendar: the selection ends quietly (the app's slots go the usual
// way, loading the draft); a draft the site reset is replaced by a new one
async function strikeFailed(selection, code) {
    await endSelection(selection, code);
    if (code === 'draft-reset') await forgetResetDraft(selection.taskId);
    const { waitingSlots } = await chrome.storage.session.get('waitingSlots');
    // Not awaited: both may wait for a new draft, whose messages go through serial
    if (waitingSlots && (waitingSlots.fresh.length || waitingSlots.all.length)) startSelection([], false, 1, { all: true });
    else if (code === 'draft-reset') createDraft('reset').catch(() => {});
}

// The date range of the app's monitor (slots outside it are never selected)
async function appDateRange() {
    const { app = null, lastSlots = null } = await chrome.storage.session.get(['app', 'lastSlots']);
    return (app && app.monitor && app.monitor.dateRange) || (lastSlots && lastSlots.range) || {};
}

// From econsul.js: «Далі» was pressed at the opening (clickedAt) and the calendar loaded; slots: the
// free ones of its last week, lastDay: its last day (the one the opening added). Answers with the
// slots to select right there ({ next }), in the usual order: new slots first — those of the new
// day and those the app sent meanwhile — then the rest of the week and of the app's free slots
async function onStrikeResult({ jobId, error, clickedAt, searches, requests, slots: found, lastDay }) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.jobId !== jobId || selection.status !== 'running' || !selection.strike) return {};
    const isDate = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d);
    const shown = (Array.isArray(found) ? found : [])
        .filter(s => s && isDate(s.date) && typeof s.time === 'string' && /^\d\d:\d\d$/.test(s.time))
        .map(({ date, time }) => ({ date, time }));
    const code = error ? String(error).split(':')[0].slice(0, 50) : null;
    Telemetry.event('selection.stage', {
        stage: 'strike', taskId: selection.taskId, error: code, free: shown.length, lastDay: isDate(lastDay) ? lastDay : null,
        lateMs: Number.isFinite(clickedAt) ? clickedAt - selection.strike : null,
        // each calendar search: its outcome and how long it took («no-time:1250,slots:8400»)
        searches: typeof searches === 'string' && /^[a-z:,0-9-]*$/.test(searches) ? searches.slice(0, 300) : null,
        // the site's external_reader requests after the click: «status:ms» each
        requests: typeof requests === 'string' && /^[0-9:,]*$/.test(requests) ? requests.slice(0, 300) : null
    }, { jobId, test: false });
    if (code) {
        await strikeFailed(selection, code);
        return {};
    }
    const range = await appDateRange();
    const inRange = shown.filter(s => (!range.from || s.date >= range.from) && (!range.to || s.date <= range.to));
    const opened = inRange.filter(s => s.date === lastDay);
    const { waitingSlots = { fresh: [], all: [] } } = await chrome.storage.session.get('waitingSlots');
    return selectOnCalendar(selection, mergeSlots(waitingSlots.fresh, opened), mergeSlots(waitingSlots.fresh, opened, inRange, waitingSlots.all));
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
    await checkDraftJobTimeout();
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
    return tab;
}

chrome.notifications.onButtonClicked.addListener(id => {
    if (id === 'login' || id === 'alarm') { openWorkTab(LOGIN_URL); chrome.notifications.clear(id); }
});
chrome.notifications.onClicked.addListener(id => {
    if (id === 'login') { openWorkTab(LOGIN_URL); chrome.notifications.clear(id); }
    if (id === 'alarm') { showApp(); chrome.notifications.clear(id); }
});

// Shows the tab of the app, or opens one
async function showApp() {
    const [tab] = await appTabs();
    if (!tab) return chrome.tabs.create({ url: APP_ORIGIN + '/', active: true });
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
}

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

// ---- App (web/ on localhost:4000) ----

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
            const { draftJob = null } = await chrome.storage.session.get('draftJob');
            const replies = [{ type: 'ext:hello', version: VERSION }, authMessage(auth), { type: 'ext:draft', draft: publicDraft(draft) }, draftJobMessage(draftJob), await settingsMessage()];
            if (auth.loggedIn === true && auth.token) replies.push({ type: 'ext:token', token: auth.token, exp: auth.exp });
            return replies;
        }
        case 'app:monitor':
            await setApp({ audioReady: !!msg.audioReady, monitor: msg.monitor || null });
            await rememberNextRelease(msg.monitor && msg.monitor.nextRelease);
            return [];
        case 'app:selection':
            await setApp({ selection: msg.selection || null });
            // The settings a new draft is made from; kept for the next browser start, when the app is not open yet
            if (msg.selection) await chrome.storage.local.set({ lastSelection: msg.selection });
            return [];
        case 'app:create-draft':
            Telemetry.event('user.new-draft', { from: 'app' });
            createDraft('app'); // not awaited: it takes ~20 s
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
            if ((msg.slots || []).length) startSelection(msg.slots, !!msg.test, 1, { all: !!msg.all });
            return [{ type: 'ext:slots-received', count: (msg.slots || []).length }];
        case 'app:settings':
            // What the app shows: auto-booking, auto draft and the reminder before the opening
            if (msg.patch && typeof msg.patch.autoBook === 'boolean') Telemetry.event('user.auto-book', { enabled: msg.patch.autoBook, from: 'app' });
            if (msg.patch && typeof msg.patch.aggressiveBook === 'boolean') Telemetry.event('user.aggressive-book', { enabled: msg.patch.aggressiveBook, from: 'app' });
            if (msg.patch) await saveSettings(msg.patch);
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

// ---- Slot quarantine and press limits (see QUARANTINE_MS) ----

async function slotKeyOf(slot) {
    const selection = await getAppSelection();
    return `${selection ? selection.institutionCode : '?'}|${slot.date}|${slot.time}`;
}

// Splits slots into those that may be tried now and those still in quarantine
async function splitQuarantined(slots) {
    const { bookingHistory = {} } = await chrome.storage.local.get('bookingHistory');
    const now = Date.now();
    const usable = [], skipped = [];
    for (const slot of slots) {
        const record = bookingHistory[await slotKeyOf(slot)];
        if (record && record.until > now) skipped.push({ slot, until: record.until, fails: record.fails });
        else usable.push(slot);
    }
    return { usable, skipped };
}

async function recordSlotFailure(slot, error, aggressive = false) {
    const key = await slotKeyOf(slot);
    const { bookingHistory = {} } = await chrome.storage.local.get('bookingHistory');
    const fails = ((bookingHistory[key] && bookingHistory[key].fails) || 0) + 1;
    const until = Date.now() + (aggressive ? AGGRESSIVE_QUARANTINE_MS : QUARANTINE_MS[Math.min(fails, QUARANTINE_MS.length) - 1]);
    bookingHistory[key] = { fails, until, error: String(error).split(':')[0].slice(0, 50), at: Date.now() };
    // old records go: a quarantine that ended a day ago is forgotten
    for (const [k, v] of Object.entries(bookingHistory)) if (v.until < Date.now() - 24 * 60 * 60 * 1000) delete bookingHistory[k];
    await chrome.storage.local.set({ bookingHistory });
    return { fails, until };
}

async function clearSlotHistory(slot) {
    const key = await slotKeyOf(slot);
    const { bookingHistory = {} } = await chrome.storage.local.get('bookingHistory');
    if (bookingHistory[key]) {
        delete bookingHistory[key];
        await chrome.storage.local.set({ bookingHistory });
    }
}

async function pressesLastHour() {
    const { pressLog = [] } = await chrome.storage.local.get('pressLog');
    return pressLog.filter(at => at > Date.now() - 60 * 60 * 1000);
}

// The person resets the hourly limit. A slot that was only selected because of it is booked
// now: the selection starts over with its slots (the draft loads again, «Підтвердити» is pressed)
async function resetPresses(from) {
    const used = (await pressesLastHour()).length;
    await chrome.storage.local.set({ pressLog: [] });
    Telemetry.event('user.reset-presses', { used, from });
    await bookSelectedNow('limit-reset');
}

// Auto-booking became possible (turned on, aggressive turned on, the limit reset) while a slot is
// selected and waits for the person: press «Підтвердити» for it right away on its calendar. If the
// tab cannot do it (closed, busy), the selection starts over with its slots and books the usual way
async function bookSelectedNow(reason) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.status !== 'selected' || selection.test || !selection.slot || selection.autoBook) return;
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    if (settings.paused) return;
    const { autoBook, aggressive, confirmTries, limitUntil } = await bookingPlan(settings, false);
    if (!autoBook) return; // still off, or the limit holds it back (the banner says so)
    const jobId = crypto.randomUUID();
    const now = Date.now();
    const booking = { ...selection, status: 'booking', jobId, autoBook, aggressive, limitUntil, startedAt: now, at: now };
    await setSelection(booking);
    await stopSounds(true);
    Telemetry.event('selection.stage', { stage: 'book-selected', reason, taskId: selection.taskId, date: selection.slot.date, time: selection.slot.time, aggressive }, { jobId, test: false });
    const reply = selection.tabId != null
        ? await chrome.tabs.sendMessage(selection.tabId, { type: 'confirm-slot', jobId, slot: selection.slot, confirmTries }).catch(() => null)
        : null;
    if (reply && reply.ok) return;
    await setSelection({ ...booking, status: 'failed', error: 'tab-left', at: Date.now() });
    // Not awaited: startSelection may wait for a draft, whose messages go through serial
    if (selection.slots) startSelection(selection.slots, false);
}

async function recordPresses(count) {
    if (!count) return;
    const recent = await pressesLastHour();
    for (let i = 0; i < count; i++) recent.push(Date.now());
    await chrome.storage.local.set({ pressLog: recent });
}

// ---- Slot selection ----
// selection: { status: 'running' | 'selected' | 'booking' | 'booked' | 'book-failed' |
//              'failed' | 'skipped', jobId, taskId, tabId, slot, error, text, tried, test,
//              autoBook, startedAt, at }

async function setSelection(selection) {
    await chrome.storage.session.set({ selection });
    return selection;
}

// One selection starts at a time. Until it is «running» it may wait minutes for a draft; slots
// that arrive meanwhile (new ones, or the app offering all free slots to a new draft) join it
// instead of starting a second selection in another tab
let selectionStarting = null; // { test, fresh, all } while a start is waiting

function slotKey(slot) { return `${slot.date} ${slot.time}`; }

// The lists in order, each slot once: what comes first is tried first
function mergeSlots(...lists) {
    const seen = new Set();
    return lists.flat().filter(slot => !seen.has(slotKey(slot)) && seen.add(slotKey(slot)));
}

// The order the slots are tried in (the owner's decision, 2026-10-18): new slots first, then the
// rest; in each group day by day, the earliest day first, and every slot of a day before the next
// day; within a day in random order (the end, the middle and the start of the day alike)
function tryOrder(slots, fresh) {
    const freshKeys = new Set(fresh.map(slotKey));
    const shuffle = list => {
        const out = [...list];
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    };
    const byDay = list => [...new Set(list.map(s => s.date))].sort()
        .flatMap(date => shuffle(list.filter(s => s.date === date)));
    return [...byDay(slots.filter(s => freshKeys.has(slotKey(s)))), ...byDay(slots.filter(s => !freshKeys.has(slotKey(s))))];
}

// A random pause before a slot that was in quarantine before; none for a slot tried the first time
async function retryPause(slot, aggressive) {
    if (aggressive || !slot) return 0;
    const { bookingHistory = {} } = await chrome.storage.local.get('bookingHistory');
    if (!bookingHistory[await slotKeyOf(slot)]) return 0;
    return RETRY_SLOT_PAUSE_MIN_MS + Math.round(Math.random() * (RETRY_SLOT_PAUSE_MAX_MS - RETRY_SLOT_PAUSE_MIN_MS));
}

// Slots that came while a selection was busy: tried on its next step (new ones first)
async function keepWaitingSlots(slots, all) {
    const { waitingSlots = { fresh: [], all: [] } } = await chrome.storage.session.get('waitingSlots');
    if (all) waitingSlots.all = mergeSlots(waitingSlots.all, slots);
    else waitingSlots.fresh = mergeSlots(slots, waitingSlots.fresh);
    await chrome.storage.session.set({ waitingSlots });
}

// Slots from the app (earliest first, already within the date range): open the draft, go to the
// calendar and select the first one the site shows as free. New slots go before the others:
// before the rest of a chain of failed bookings and before all free slots the app offers to a
// new draft (opts.all)
async function startSelection(slots, test, attempt = 1, opts = {}) {
    if (selectionStarting) {
        if (selectionStarting.test === test) {
            if (opts.all) selectionStarting.all = mergeSlots(selectionStarting.all, slots);
            else selectionStarting.fresh = mergeSlots(slots, selectionStarting.fresh);
        }
        return;
    }
    const starting = selectionStarting = { test, fresh: opts.all ? [] : slots, all: opts.all ? slots : [] };
    const release = () => { if (selectionStarting === starting) selectionStarting = null; };
    try {
        return await runSelection(starting, attempt, release);
    } finally {
        release();
    }
}

// The slots out of quarantine (see QUARANTINE_MS); null when there are none: the selection is
// «skipped» and, at the end of a chain of failed bookings, the person is told
async function usableSlots(slots, chaining, now) {
    if (!slots.length) return null; // nothing left to try (a chain whose slots all went)
    const { usable, skipped } = await splitQuarantined(slots);
    if (skipped.length) {
        Telemetry.event('selection.stage', { stage: 'quarantine-skip', skipped: skipped.length, usable: usable.length, until: new Date(Math.min(...skipped.map(s => s.until))).toISOString() });
    }
    if (!usable.length) {
        const until = Math.min(...skipped.map(s => s.until));
        const untilText = new Date(until).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        await sendToApps([{ type: 'ext:slot-failed', error: 'quarantined', text: `Слоти не бронювались: пропускаю до ${untilText}.`, test: false }]);
        if (chaining) {
            // A chain of failed bookings ran out of slots: the person has to know
            Telemetry.event('selection.stage', { stage: 'chain-ended', slots: slots.length });
            await playSound('selected', SELECTED_SOUND);
            chrome.notifications.create('slot', {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Жоден слот не забронювався',
                message: `Спробував усі вільні слоти (${slots.length}). Наступна спроба — з новими слотами або після ${untilText}.`,
                requireInteraction: true,
                priority: 2
            });
        }
        await setSelection({ status: 'skipped', error: 'quarantined', test: false, at: now, until });
        return null;
    }
    return usable;
}

// Whether «Підтвердити» is pressed and how many times (see MAX_PRESSES_PER_HOUR, aggressive booking)
// limitUntil: auto-booking is on but the hourly limit is used up: the slot is only selected, and
// the person is told why and until when (the oldest press of the hour drops out then)
async function bookingPlan(settings, test) {
    const presses = await pressesLastHour();
    const pressesLeft = MAX_PRESSES_PER_HOUR - presses.length;
    const aggressive = !!settings.autoBook && !test && (!!settings.aggressiveBook || await atOpening(Date.now()));
    const autoBook = !!settings.autoBook && !test && (aggressive || pressesLeft > 0); // test slots are never booked
    const limited = !!settings.autoBook && !aggressive && !test && pressesLeft <= 0;
    if (limited) Telemetry.event('selection.stage', { stage: 'press-limit', limit: MAX_PRESSES_PER_HOUR });
    const limitUntil = limited ? Math.min(...presses) + 60 * 60 * 1000 : null;
    // one press per slot in both modes: a failure moves on to the next slot
    const confirmTries = 1;
    return { autoBook, aggressive, confirmTries, limitUntil };
}

// Is now within the opening of new days (see OPENING_AGGRESSIVE_AFTER_MS)? nextRelease stays the
// opening under way until the app's fast window ends; lastOpenAt keeps it after that
async function atOpening(now) {
    const { nextRelease = null, lastOpenAt = null } = await chrome.storage.local.get(['nextRelease', 'lastOpenAt']);
    return [nextRelease && nextRelease.at, lastOpenAt].some(at => Number.isFinite(at) && at - STRIKE_LEAD_MS <= now && now < at + OPENING_AGGRESSIVE_AFTER_MS);
}

function limitText(limitUntil) {
    const at = new Date(limitUntil).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    return `Ліміт ${MAX_PRESSES_PER_HOUR} натискань на годину вичерпано — автобронювання відновиться о ${at}.`;
}

async function runSelection(starting, attempt, release) {
    const { test } = starting;
    let slots;
    // A draft is being made (the tab is on steps 1–3): wait for it instead of reloading the tab
    for (let i = 0; i < 480; i++) {
        const { draftJob } = await chrome.storage.session.get('draftJob');
        if (!draftJob || !['running', 'retrying'].includes(draftJob.status) || Date.now() - draftJob.startedAt > DRAFT_JOB_TIMEOUT_MS) break;
        await new Promise(r => setTimeout(r, 1000));
    }
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    let { selection, draft } = await chrome.storage.session.get(['selection', 'draft']);
    const now = Date.now();
    // The site deletes a draft a day after creation: an expired one is no draft (picking in it
    // ends on the site's error page); nor is one made on an earlier day (draftFromEarlierDay) or for
    // another institution or service than the app's (draftForOtherPlace): a new one is made below
    const appSelection = await getAppSelection();
    const expired = d => draftOutdated(d, appSelection);
    if (draftForOtherPlace(draft, appSelection)) Telemetry.event('draft.gone', { taskId: draft.taskId, reason: 'other-place' });
    if (expired(draft)) draft = null;
    if (settings.paused) return setSelection({ status: 'skipped', error: 'paused', test, at: now });
    // Slots came before any draft (a login started the monitor, the draft is not made yet): make
    // it now and go on with these slots when it is ready, instead of failing with «no draft»
    if (!draft && settings.autoDraft !== false && !test && (await getAuth()).loggedIn === true) {
        await createDraft('slots');
        for (let i = 0; i < 480; i++) {
            const { draftJob } = await chrome.storage.session.get('draftJob');
            if (!draftJob || !['running', 'retrying'].includes(draftJob.status) || Date.now() - draftJob.startedAt > DRAFT_JOB_TIMEOUT_MS) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        ({ draft } = await chrome.storage.session.get('draft'));
        if (expired(draft)) draft = null; // the creation failed: the old one is still stored
        if (draft) Telemetry.event('selection.stage', { stage: 'draft-made-for-slots', taskId: draft.taskId });
    }
    const busy = (selection && ['running', 'booking'].includes(selection.status) && now - selection.startedAt < SELECT_TIMEOUT_MS)
        // The person may be pressing «Підтвердити» right now: do not switch the slot under them
        || (selection && selection.status === 'selected' && now - selection.at < SELECTED_HOLD_MS);
    if (busy) {
        if (!test) {
            await keepWaitingSlots(starting.fresh, false);
            await keepWaitingSlots(starting.all, true);
        }
        return;
    }
    if (!draft) return selectionFailed({ status: 'failed', test, startedAt: now }, 'no-draft');
    // This draft is booked: the site turns it into a sent application
    if (selection && selection.status === 'booked' && selection.taskId === draft.taskId) return;
    const chaining = !!(selection && selection.advancing && selection.slots);
    let fresh = starting.fresh;
    if (test) slots = mergeSlots(starting.fresh, starting.all);
    else {
        // New slots first (those that came while busy, then these), then the rest of a chain of
        // failed bookings, then all free slots offered to the draft
        const { waitingSlots = { fresh: [], all: [] } } = await chrome.storage.session.get('waitingSlots');
        await chrome.storage.session.remove('waitingSlots');
        slots = mergeSlots(waitingSlots.fresh, starting.fresh, chaining ? selection.slots : [], waitingSlots.all, starting.all);
        fresh = mergeSlots(waitingSlots.fresh, starting.fresh);
    }

    // Slots that did not book recently are left alone (see QUARANTINE_MS)
    if (!test) {
        slots = await usableSlots(slots, chaining, now);
        if (!slots) return;
    }
    slots = tryOrder(slots, fresh);

    const jobId = crypto.randomUUID();
    const { autoBook, aggressive, confirmTries, limitUntil } = await bookingPlan(settings, test);
    const pauseMs = autoBook ? await retryPause(slots[0], aggressive) : 0;
    if (pauseMs) {
        Telemetry.event('selection.stage', { stage: 'retry-pause', pauseMs }, { jobId, test });
        await new Promise(r => setTimeout(r, pauseMs));
    }
    const current = await setSelection({ status: 'running', jobId, taskId: draft.taskId, test, autoBook, aggressive, limitUntil, slots, attempt, startedAt: now, at: now });
    release(); // from here a new start sees «running» and leaves this one alone

    // Load the draft again even if it is open on step 4: the calendar there may be old
    const since = Date.now();
    const tab = await openDraftStep3(draft);
    // Still this selection: the tab may already have reported the draft gone (onSelectionDraftGone)
    if (!await selectionRunning(jobId)) return;
    await setSelection({ ...current, tabId: tab.id });
    Telemetry.event('selection.started', { taskId: draft.taskId, slots: slots.length, autoBook, aggressive, attempt }, { jobId, test });

    const reply = await waitForTask(tab.id, draft.taskId, since);
    if (!await selectionRunning(jobId)) return;
    if (!reply) return selectionFailed({ ...current, tabId: tab.id }, 'tab-not-ready');
    Telemetry.event('selection.stage', { stage: 'tab-ready', taskId: draft.taskId, durationMs: Date.now() - now }, { jobId, test });
    const note = limitUntil ? limitText(limitUntil) : null; // the banner says why the person presses
    await chrome.tabs.sendMessage(tab.id, { type: 'select-slot', jobId, taskId: draft.taskId, slots, autoBook, confirmTries, note }).catch(() => null);
}

// Opens the draft on step 3 in its tab (or a new one) and brings it to the front. Step 3 is
// opened directly: the address of step 4 shows step 4 for a moment and goes back to step 3;
// econsul.js presses «Далі» from there
async function openDraftStep3(draft) {
    const openUrl = `https://e-consul.gov.ua/tasks/${draft.taskId}/consularServiceInfo`;
    let tab = draft.tabId != null && await chrome.tabs.get(draft.tabId).catch(() => null);
    if (!(tab && tab.url && tab.url.includes(`/tasks/${draft.taskId}`))) tab = null;
    if (tab) tab = await chrome.tabs.update(tab.id, { active: true, url: openUrl });
    else tab = await chrome.tabs.create({ url: openUrl, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return tab;
}

// Waits until econsul.js of the page loaded after `since` answers for this task. The page shown
// before the navigation answers too while a slow site keeps it, and a message sent to it is lost
// with it. The reply, or null after TAB_READY_MS
async function waitForTask(tabId, taskId, since) {
    await new Promise(r => setTimeout(r, 1500));
    const end = Date.now() + TAB_READY_MS;
    while (Date.now() < end) {
        const reply = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => null);
        if (reply && reply.ok && reply.taskId === taskId && reply.pageSince >= since) return reply;
        await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}

async function selectionRunning(jobId) {
    const { selection } = await chrome.storage.session.get('selection');
    return !!(selection && selection.jobId === jobId && selection.status === 'running');
}

async function selectionFailed(selection, error, tried = []) {
    Telemetry.event('selection.failed', {
        error: String(error).split(':')[0].slice(0, 50), // a code of SELECT_ERRORS, never page text
        taskId: selection.taskId || null,
        durationMs: selection.startedAt ? Date.now() - selection.startedAt : null,
        attempt: selection.attempt || 1
    }, { jobId: selection.jobId, test: selection.test });
    const attempt = selection.attempt || 1;
    const code = String(error).split(':')[0];
    if (RETRYABLE.has(code) && attempt < MAX_SELECT_ATTEMPTS && selection.slots && selection.slots.length) {
        // Probably the site's load: start over instead of telling the person it failed
        const pause = RETRY_PAUSE_MS * 2 ** (attempt - 1);
        await setSelection({ ...selection, status: 'retrying', error, tried, at: Date.now() });
        Telemetry.event('selection.stage', { stage: 'retry', attempt: attempt + 1, error: code, pauseMs: pause, taskId: selection.taskId || null }, { jobId: selection.jobId, test: selection.test });
        setTimeout(() => serial(async () => {
            // A newer selection (new slots, the person's own work) took over meanwhile
            const { selection: now } = await chrome.storage.session.get('selection');
            if (!now || now.jobId !== selection.jobId || now.status !== 'retrying') return;
            // Not awaited: startSelection may wait for a new draft, whose messages go through serial
            startSelection(selection.slots, !!selection.test, attempt + 1);
        }), pause);
        return;
    }
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

// Ends a running selection without retrying it in the same draft and without the «Слот не
// вибрано» notification: draft-gone starts it over in a new draft, tab-left is the person's doing
async function endSelection(selection, error) {
    Telemetry.event('selection.failed', {
        error, taskId: selection.taskId || null,
        durationMs: selection.startedAt ? Date.now() - selection.startedAt : null,
        attempt: selection.attempt || 1
    }, { jobId: selection.jobId, test: selection.test });
    await setSelection({ ...selection, status: 'failed', error, at: Date.now() });
    await sendToApps([{ type: 'ext:slot-failed', error, text: SELECT_ERRORS[error], test: !!selection.test }]);
}

// The site says the draft a selection works in is gone (404, sent, deleted): the page shows the
// site's error and has no form, so the picker would wait for nothing and every retry, and the
// draft creation, would wait for it. Start over: with no draft, startSelection makes a new one
async function onSelectionDraftGone(taskId) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.taskId !== taskId || !['running', 'retrying'].includes(selection.status)) return;
    await endSelection(selection, 'draft-gone');
    // Not awaited: it waits for the new draft, whose messages go through serial
    if (selection.slots && selection.slots.length) startSelection(selection.slots, !!selection.test);
}

// The draft opened on step 1 or 2 instead of step 3 (the site reset it): the same as a draft
// that is gone, start over in a new one
async function onSelectionDraftReset(selection) {
    await forgetResetDraft(selection.taskId);
    await endSelection(selection, 'draft-reset');
    // Not awaited: it waits for the new draft, whose messages go through serial
    if (selection.slots && selection.slots.length) startSelection(selection.slots, !!selection.test);
}

// The tab of a running selection was closed or left the application (the person took over):
// nothing will report a result, and a «running» selection blocks draft creation for minutes
async function onSelectionTabLeft(tabId, url) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.status !== 'running' || selection.tabId !== tabId) return;
    if (url && url.includes(`/tasks/${selection.taskId}`)) return;
    await endSelection(selection, 'tab-left');
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) serial(() => onSelectionTabLeft(tabId, changeInfo.url));
});

// From econsul.js: the result of select-slot. booking: auto-booking presses «Підтвердити» next
async function onSlotResult({ jobId, ok, slot, error, tried, booking }) {
    const { selection } = await chrome.storage.session.get('selection');
    // A selection already ended here (its draft is gone, its tab left) is not retried
    if (!selection || selection.jobId !== jobId || selection.status !== 'running') return;
    if (!ok && error === 'draft-reset') return onSelectionDraftReset(selection);
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
        message: `${selection.limitUntil ? limitText(selection.limitUntil) + ' ' : ''}Натисніть «Підтвердити» на сторінці e-consul, щоб забронювати.`,
        requireInteraction: true,
        priority: 2
    });
    await sendToApps([{ type: 'ext:slot-selected', slot }]);
}

// From econsul.js: auto-booking pressed «Підтвердити». ok: the site said «Дякуємо». A failure
// that is the site's answer (ADVANCE_ERRORS) puts the slot in quarantine and tries the next free
// slot of the selection; any other failure (the page left the calendar, nothing to press) stops
async function onBookResult({ jobId, slot, ok, error, text, presses, onCalendar }) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || selection.jobId !== jobId) return;
    const date = slot.date.split('-').reverse().join('.');
    const code = String(error).split(':')[0].slice(0, 50);
    const aggressive = !!selection.aggressive;
    Telemetry.event(ok ? 'booking.booked' : 'booking.failed', {
        taskId: selection.taskId, date: slot.date, time: slot.time, aggressive,
        ...(ok ? {} : { error: code }),
        // what the site said when it answered with a message (not the page text: that has the applicant's data)
        ...(!ok && (error === 'alert' || error === 'unavailable') && text ? { message: String(text).slice(0, 300) } : {})
    }, { jobId, test: selection.test });
    // The hourly limit guards the usual mode; aggressive presses (no limit) do not use it up
    if (!aggressive) await recordPresses(presses);
    let quarantine = null;
    if (ok) {
        await clearSlotHistory(slot);
        await chrome.storage.session.remove('waitingSlots');
    } else if (ADVANCE_ERRORS.has(code)) quarantine = await recordSlotFailure(slot, error, aggressive);
    if (quarantine) Telemetry.event('selection.stage', { stage: 'quarantine-start', fails: quarantine.fails, until: new Date(quarantine.until).toISOString(), presses: presses || 0, aggressive }, { jobId, test: selection.test });

    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const advance = !ok && !selection.test && ADVANCE_ERRORS.has(code) && !!settings.autoBook && !settings.paused;
    const ended = { ...selection, status: ok ? 'booked' : 'book-failed', slot, error: error || null, text: text || null, quarantineUntil: quarantine ? quarantine.until : null, advancing: advance, at: Date.now() };
    await setSelection(ended);
    const reason = `${SELECT_ERRORS[error] || error}${text ? ' ' + text.slice(0, 120) : ''}`;

    if (advance) {
        // Quietly on to the next slot: the person hears about it when one books or none does
        Telemetry.event('selection.stage', { stage: 'advance', error: code, left: selection.slots.length - 1, aggressive }, { jobId, test: false });
        await sendToApps([{ type: 'ext:slot-failed', error: code, text: `Не забронювалось ${date} ${slot.time}: ${reason} Пробую наступний слот.`, test: false }]);
        // Still on the calendar: the next slot is clicked right there, without loading the draft
        // again (on a loaded site that takes the longest)
        if (onCalendar) {
            const next = await nextOnCalendar(ended);
            if (next) return { showBanner: false, ...next };
        }
        setTimeout(() => serial(async () => {
            // New slots (or the person) started another selection meanwhile: it carries this chain on
            const { selection: now } = await chrome.storage.session.get('selection');
            if (!now || now.jobId !== jobId || now.status !== 'book-failed') return;
            // Not awaited: startSelection may wait for a draft, whose messages go through serial
            startSelection([], false, 1, { all: true });
        }), 0); // a pause, if any, comes before a slot tried again (retryPause)
        return { showBanner: false };
    }

    // Either way the person has to look: the result comes by email, or the slot waits for them
    await playSound('selected', SELECTED_SOUND);
    chrome.notifications.create('slot', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: ok ? `Заброньовано ${date} о ${slot.time}` : `Не вдалося забронювати ${date} о ${slot.time}`,
        message: ok
            ? 'Сайт прийняв заявку. Підтвердження прийде на email.'
            : `${reason} Слот лишився вибраним, можна натиснути «Підтвердити» самому.${quarantine ? ` Автоматично цей слот пропускаю до ${new Date(quarantine.until).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}.` : ''}`,
        requireInteraction: true,
        priority: 2
    });
    await sendToApps([ok
        ? { type: 'ext:slot-booked', slot }
        : { type: 'ext:slot-failed', error: code, text: `Не забронювалось ${date} ${slot.time}: ${reason} Слот лишився вибраним.`, test: false }]);
    // econsul.js: the slot waits for the person's «Підтвердити»; the banner says why
    return { showBanner: !ok, reason: SELECT_ERRORS[error] || error || null };
}

// «Наступний слот» on the banner: the person skips the selected slot (no quarantine: nothing was
// wrong with it) and the next one of the same selection is selected on this calendar, in the same
// order (new slots first, day by day). Skipped slots are not offered again in this selection.
// { next: select-slot data } or { text } when there is nothing to offer
async function onNextSlot({ slot }, tab) {
    const { selection } = await chrome.storage.session.get('selection');
    if (!selection || !['selected', 'book-failed'].includes(selection.status) || selection.tabId !== tab.id || !selection.slots) {
        return { text: 'Цей вибір уже завершено.' };
    }
    const skipped = mergeSlots(selection.skipped || [], slot ? [slot] : []);
    const skippedKeys = new Set(skipped.map(slotKey));
    const { waitingSlots = { fresh: [], all: [] } } = await chrome.storage.session.get('waitingSlots');
    await chrome.storage.session.remove('waitingSlots');
    const rest = mergeSlots(waitingSlots.fresh, selection.slots, waitingSlots.all).filter(s => !skippedKeys.has(slotKey(s)));
    const { usable } = selection.test ? { usable: rest } : await splitQuarantined(rest);
    if (!usable.length) return { text: rest.length ? 'Решта слотів зараз у карантині.' : 'Інших вільних слотів немає.' };
    const slots = tryOrder(usable, waitingSlots.fresh);
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const { autoBook, aggressive, confirmTries, limitUntil } = await bookingPlan(settings, !!selection.test);
    const jobId = crypto.randomUUID();
    const now = Date.now();
    await setSelection({ status: 'running', jobId, taskId: selection.taskId, tabId: tab.id, test: !!selection.test, autoBook, aggressive, limitUntil, slots, skipped, attempt: 1, startedAt: now, at: now });
    await stopSounds(true);
    Telemetry.event('selection.stage', { stage: 'user-next', skipped: skipped.length, left: slots.length }, { jobId, test: !!selection.test });
    return { next: { jobId, taskId: selection.taskId, slots, autoBook, confirmTries, note: limitUntil ? limitText(limitUntil) : null } };
}

// The next step of a chain on the calendar the tab already shows: a new «running» selection
// without loading the draft. { next: select-slot data } or { ended: true } (nothing left to try:
// the person is told); null: go the usual way (load the draft again)
async function nextOnCalendar(previous) {
    if (selectionStarting || previous.tabId == null) return null; // another start carries the chain on
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    if (settings.paused || !settings.autoBook) return null;
    const now = Date.now();
    // New slots first (they came while booking), then the rest of the chain
    const { waitingSlots = { fresh: [], all: [] } } = await chrome.storage.session.get('waitingSlots');
    await chrome.storage.session.remove('waitingSlots');
    const usable = await usableSlots(mergeSlots(waitingSlots.fresh, previous.slots, waitingSlots.all), true, now);
    if (!usable) return { ended: true };
    const slots = tryOrder(usable, waitingSlots.fresh);
    const jobId = crypto.randomUUID();
    const { autoBook, aggressive, confirmTries, limitUntil } = await bookingPlan(settings, false);
    await setSelection({ status: 'running', jobId, taskId: previous.taskId, tabId: previous.tabId, test: false, autoBook, aggressive, limitUntil, slots, attempt: 1, startedAt: now, at: now });
    Telemetry.event('selection.started', { taskId: previous.taskId, slots: slots.length, autoBook, aggressive, attempt: 1, onCalendar: true }, { jobId, test: false });
    const pauseMs = autoBook ? await retryPause(slots[0], aggressive) : 0;
    if (pauseMs) Telemetry.event('selection.stage', { stage: 'retry-pause', pauseMs }, { jobId, test: false });
    return { next: { jobId, taskId: previous.taskId, slots, autoBook, confirmTries, note: limitUntil ? limitText(limitUntil) : null, pauseMs } };
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
    if (id === 'draft') { showDraftJobTab(); chrome.notifications.clear(id); }
});

async function showDraftJobTab() {
    const { draftJob } = await chrome.storage.session.get('draftJob');
    const tab = draftJob && draftJob.tabId != null && await chrome.tabs.get(draftJob.tabId).catch(() => null);
    if (!tab) return openWorkTab(NEW_APPLICATION_URL);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
}

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

// Only known settings of the right type get in; the alarm lead is a whole number of minutes
function cleanSettingsPatch(patch = {}) {
    const clean = {};
    for (const key of ['paused', 'autoBook', 'aggressiveBook', 'autoDraft', 'autoMonitor', 'alarmEnabled', 'releaseStrike']) if (typeof patch[key] === 'boolean') clean[key] = patch[key];
    const lead = Math.round(Number(patch.alarmLeadMin));
    if (patch.alarmLeadMin != null && Number.isFinite(lead)) clean.alarmLeadMin = Math.min(ALARM_LEAD_MAX, Math.max(ALARM_LEAD_MIN, lead));
    return clean;
}

async function saveSettings(patch) {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const clean = cleanSettingsPatch(patch);
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...settings, ...clean } });
    if ('alarmEnabled' in clean || 'alarmLeadMin' in clean || 'releaseStrike' in clean) await scheduleReleaseAlarm();
    await renderBadge();
    await sendToApps([await settingsMessage()]);
    // Turned on now: the slot selected by hand is booked at once (see bookSelectedNow)
    if (clean.autoBook === true || clean.aggressiveBook === true || clean.paused === false) await bookSelectedNow('settings');
}

async function settingsMessage() {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const all = { ...DEFAULT_SETTINGS, ...settings };
    return { type: 'ext:settings', autoBook: !!all.autoBook, aggressiveBook: !!all.aggressiveBook, paused: !!all.paused, autoDraft: all.autoDraft !== false, autoMonitor: !!all.autoMonitor, alarmEnabled: all.alarmEnabled !== false, alarmLeadMin: all.alarmLeadMin, releaseStrike: all.releaseStrike !== false };
}

// ---- Popup ----

async function onPopupMessage(msg) {
    switch (msg.type) {
        case 'popup:state': {
            const auth = await getAuth();
            const { app = null, lastSlots = null, draft = null, sound = null, selection = null, draftJob = null } = await chrome.storage.session.get(['app', 'lastSlots', 'draft', 'sound', 'selection', 'draftJob']);
            const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
            const { token, ...publicAuth } = auth; // the popup does not need the token itself
            const alarm = await chrome.alarms.get('release-alarm');
            const presses = await pressesLastHour();
            const pressInfo = { used: presses.length, max: MAX_PRESSES_PER_HOUR, until: presses.length >= MAX_PRESSES_PER_HOUR ? Math.min(...presses) + 60 * 60 * 1000 : null };
            return { version: VERSION, auth: { ...publicAuth, hasToken: !!token }, app, appConnected: await isAppConnected(), lastSlots, draft, sound, selection, draftJob, draftAlarmAt: alarm ? alarm.scheduledTime : null, selectErrors: SELECT_ERRORS, draftErrors: DRAFT_ERRORS, settings, presses: pressInfo };
        }
        case 'popup:login':
            await openWorkTab(LOGIN_URL);
            return {};
        case 'popup:open-draft':
            await openDraft();
            return {};
        case 'popup:new-draft':
            // The app's settings are known: fill steps 1–3 ourselves. Otherwise open the new
            // application and leave the steps to the person; econsul.js picks the draft up
            Telemetry.event('user.new-draft', { from: 'popup' });
            if (await getAppSelection() && (await getAuth()).loggedIn === true) createDraft('popup');
            else await chrome.tabs.create({ url: NEW_APPLICATION_URL, active: true });
            return {};
        case 'popup:mute':
            Telemetry.event('user.mute', { from: 'popup' });
            await stopSounds(true);
            return {};
        case 'popup:reset-presses':
            await resetPresses('popup');
            return {};
        case 'popup:settings':
            if (msg.patch && typeof msg.patch.paused === 'boolean') Telemetry.event('user.pause', { paused: msg.patch.paused, from: 'popup' });
            if (msg.patch && typeof msg.patch.autoBook === 'boolean') Telemetry.event('user.auto-book', { enabled: msg.patch.autoBook, from: 'popup' });
            if (msg.patch && typeof msg.patch.aggressiveBook === 'boolean') Telemetry.event('user.aggressive-book', { enabled: msg.patch.aggressiveBook, from: 'popup' });
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
        else if (message.type === 'econsul:next-slot') handler = () => onNextSlot(message, sender.tab);
        else if (message.type === 'econsul:strike-result') handler = () => onStrikeResult(message);
        else if (message.type === 'econsul:draft-result') handler = () => onDraftResult(message);
        else if (message.type === 'econsul:scan-result') handler = () => onScanResult(message);
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
