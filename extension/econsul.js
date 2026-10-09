// Content script on https://e-consul.gov.ua/*. Reads the session token the site keeps in
// localStorage.token (same origin as the page) and passes it to the background. Checks the
// token with GET my.e-consul.gov.ua/auth/me when the background asks (every 10–15 min).
// Notices when the tab shows an application (/tasks/{taskId}/…): that is the draft.
// Requests go from the page's origin, like the site's own requests.
// When the app finds slots, the background asks this tab to select one (select-slot): the
// tab goes from step 3 to the calendar with «Далі», selects the earliest free slot of the
// list (picker.js), shows a banner and highlights «Підтвердити».
//
// It books only when the person turned on auto-booking (settings.autoBook) and the slots are
// not a test: then it presses «Підтвердити» (#finish-button) for the selected slot. Never
// «Підтверджую» or «Записатись в чергу очікування». «Далі» exists only on steps 1–3 and just
// saves the step. Selecting a slot
// makes the site save the document, as a click by hand would. The only API calls of its own
// are GET auth/me and GET tasks/{taskId}, which the site itself makes when it opens a task.

// Wrapped in a function: the background injects this file again into open tabs after an
// extension reload, and top-level consts would clash with the orphaned copy
(() => {
    const API = 'https://my.e-consul.gov.ua';
    const POLL_MS = 2000;          // local reads only: localStorage and the address
    const RESEND_MS = 60 * 1000;   // the same token again, so the background can ask for a check
    // After the login redirect the site writes the token a few seconds after the page loads.
    // "No token" counts only after it has been missing this long, so a login does not first
    // raise a false "session ended" alert
    const NO_TOKEN_GRACE_MS = 10 * 1000;
    // An existing application: /tasks/{taskId} or /tasks/{taskId}/{stepId}. Same rule as
    // DRAFT_URL_RE in slots.html
    const TASK_PATH_RE = /^\/tasks\/(?!create\/|create$|my-tasks)([^/?#]+)(?:\/([^/?#]+))?/;

    let lastToken, lastSentAt = 0, noTokenSince = null, lastHref = null;
    const checkedTasks = new Set();

    function readToken() {
        try { return localStorage.getItem('token') || null; } catch (e) { return null; }
    }

    function send(message) {
        return chrome.runtime.sendMessage(message).catch(() => {
            // The extension was reloaded or removed: this script is orphaned, stop polling
            clearInterval(pollTimer);
            return null;
        });
    }

    async function reportToken(force = false) {
        const token = readToken();
        if (!token) {
            noTokenSince = noTokenSince || Date.now();
            if (Date.now() - noTokenSince < NO_TOKEN_GRACE_MS) return;
        } else {
            noTokenSince = null;
        }
        if (!force && token === lastToken && Date.now() - lastSentAt < RESEND_MS) return;
        lastToken = token;
        lastSentAt = Date.now();
        const reply = await send({ type: 'econsul:token', token });
        if (reply && reply.verify && token) checkAuth(token);
        if (token) reportTask(); // a task page opened before login
    }

    async function checkAuth(token) {
        let ok = false, status = 0;
        try {
            const response = await fetch(`${API}/auth/me`, { headers: { token }, cache: 'no-store' });
            ok = response.ok;
            status = response.status;
        } catch (e) {
            status = 0; // network error: neither logged in nor out
        }
        send({ type: 'econsul:auth-check', token, ok, status });
    }

    // The tab shows an application: report it with its creation time from GET /tasks/{id}.
    // A sent application (finished) or a deleted one is not a draft.
    async function reportTask() {
        const match = location.pathname.match(TASK_PATH_RE);
        if (!match) return;
        const taskId = decodeURIComponent(match[1]);
        const step = match[2] || null;
        const token = readToken();
        let info = null;
        if (token && !checkedTasks.has(taskId)) {
            checkedTasks.add(taskId);
            try {
                const response = await fetch(`${API}/tasks/${encodeURIComponent(taskId)}`, { headers: { token }, cache: 'no-store' });
                if (response.status === 404) info = { missing: true };
                else if (response.ok) {
                    const json = await response.json();
                    const task = json && json.data && !Array.isArray(json.data) ? json.data : json;
                    info = {
                        createdAt: task.createdAt ? Date.parse(task.createdAt) : null,
                        finished: !!task.finished,
                        deleted: !!(task.deleted || task.isDeleted)
                    };
                }
            } catch (e) { /* network: report without the details */ }
        }
        send({ type: 'econsul:task', url: location.origin + location.pathname, taskId, step, info });
    }

    // The site is a single-page app: watch the address instead of page loads
    function watchAddress() {
        if (location.href === lastHref) return;
        lastHref = location.href;
        reportTask();
    }

    // ---- Slot selection ----

    let job = null; // the running select-slot, so a second request does not start another
    let banner = null;

    const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    function slotLabel(slot) {
        const day = WEEKDAYS[new Date(slot.date + 'T12:00:00Z').getUTCDay()];
        return `${day}, ${slot.date.split('-').reverse().join('.')} о ${slot.time}`;
    }

    // Content script messages show in the page's DevTools console
    const log = text => console.info('[e-Consul Helper]', text);

    async function selectSlot({ jobId, taskId, slots, autoBook }) {
        if (job) return;
        job = jobId;
        log(`select-slot: ${slots.length} slot(s), earliest ${slots[0].date} ${slots[0].time}${autoBook ? ', auto-booking' : ''}`);
        removeBanner();
        let result;
        try {
            if (!location.pathname.startsWith(`/tasks/${taskId}`)) result = { error: 'wrong-task' };
            else result = await EconsulPicker.pick(slots, log);
        } catch (e) {
            result = { error: 'exception: ' + e.message };
        }
        log(result.slot ? `selected ${result.slot.date} ${result.slot.time}` : `not selected: ${result.error}`);
        if (result.tried && result.tried.length) log('tried: ' + result.tried.join('; '));
        if (result.slot && autoBook) {
            send({ type: 'econsul:slot-result', jobId, ok: true, slot: result.slot, tried: result.tried, booking: true });
            let booked;
            try {
                log('auto-booking: pressing «Підтвердити»');
                booked = await EconsulPicker.confirm(result.slot);
                log('auto-booking result: ' + JSON.stringify(booked));
            } catch (e) {
                booked = { error: 'exception: ' + e.message };
            }
            job = null;
            // Not booked: leave the slot selected with the banner, the person can still press
            if (!booked.ok && EconsulPicker.currentStep() === EconsulPicker.CALENDAR_STEP) showBanner(result.slot, EconsulPicker.findSlot(result.slot.date, result.slot.time));
            send({ type: 'econsul:book-result', jobId, slot: result.slot, ...booked });
            return;
        }
        job = null;
        if (result.slot) {
            showBanner(result.slot, result.element);
            send({ type: 'econsul:slot-result', jobId, ok: true, slot: result.slot, tried: result.tried });
        } else {
            send({ type: 'econsul:slot-result', jobId, ok: false, error: result.error, tried: result.tried || [] });
        }
    }

    // Design A: blue banner on top with the selected slot, the alarm time and «Вимкнути
    // звук»; the selected slot gets a blue ring and «Підтвердити» is highlighted
    const STYLE = `
        .ech-banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
            width: min(560px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 20px; border-radius: 12px;
            background: #0057B8; color: #FFFFFF; font-family: Manrope, system-ui, sans-serif;
            box-shadow: 0 1px 2px rgba(11,27,43,.08), 0 8px 24px rgba(11,27,43,.24);
            display: flex; flex-direction: column; gap: 10px; }
        .ech-signal { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #FFD500; }
        .ech-signal.off { color: rgba(255,255,255,.75); }
        .ech-title { font-size: 20px; font-weight: 800; line-height: 1.25; }
        .ech-row { display: flex; align-items: center; gap: 12px; }
        .ech-row .ech-hint { flex: 1; font-size: 14px; }
        .ech-banner button { height: 40px; padding: 0 14px; border: 1px solid rgba(255,255,255,.6); border-radius: 8px;
            background: transparent; color: #FFFFFF; font: 600 13px Manrope, system-ui, sans-serif; cursor: pointer; }
        .ech-banner button[hidden] { display: none; }
        .ech-slot { box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 5px #0057B8 !important; }
        .ech-finish { background: #0057B8 !important; color: #FFFFFF !important;
            box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 6px #FFD500 !important; }
        .ech-arrow { display: inline-flex; align-items: center; gap: 8px; margin-right: 12px;
            font: 700 13px Manrope, system-ui, sans-serif; color: #3E4C5B; }
    `;
    const SPEAKER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"></path></svg>';
    const ARROW = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3E4C5B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';

    function showBanner(slot, slotElement) {
        removeBanner();
        const style = document.createElement('style');
        style.textContent = STYLE;
        const root = document.createElement('div');
        root.className = 'ech-banner';
        root.innerHTML = `
            <div class="ech-signal">${SPEAKER}<span class="ech-signal-text">Сигнал · 0:00</span></div>
            <div class="ech-title"></div>
            <div class="ech-row">
                <div class="ech-hint">Натисніть «Підтвердити», щоб забронювати</div>
                <button type="button" class="ech-mute">Вимкнути звук</button>
            </div>`;
        root.querySelector('.ech-title').textContent = 'Вибрано: ' + slotLabel(slot);
        document.documentElement.append(style, root);

        const arrow = document.createElement('span');
        arrow.className = 'ech-arrow';
        arrow.innerHTML = 'натисніть тут ' + ARROW;
        // Clicks anywhere on «Підтвердити», also after React replaces the button
        document.addEventListener('click', onFinishClick, true);
        if (slotElement) slotElement.scrollIntoView({ block: 'center' });

        const startedAt = Date.now();
        const signalText = root.querySelector('.ech-signal-text');
        const timer = setInterval(() => {
            const s = Math.floor((Date.now() - startedAt) / 1000);
            signalText.textContent = `Сигнал · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            // The slot was unselected by hand or the page left step 4: the banner is stale
            const shown = EconsulPicker.findSlot(slot.date, slot.time);
            if (EconsulPicker.currentStep() !== EconsulPicker.CALENDAR_STEP || (shown && !EconsulPicker.isSelected(shown))) removeBanner();
            else highlight(shown, arrow);
        }, 1000);
        highlight(slotElement, arrow);
        root.querySelector('.ech-mute').addEventListener('click', () => {
            send({ type: 'econsul:mute' });
            soundOff('Звук вимкнено');
        });
        banner = { style, root, timer, arrow, slot };
    }

    // React re-renders the slot and the button with its own className, dropping ours: apply
    // the ring and the highlight again every second
    function highlight(slotElement, arrow) {
        document.querySelectorAll('.ech-slot').forEach(el => { if (el !== slotElement) el.classList.remove('ech-slot'); });
        if (slotElement) slotElement.classList.add('ech-slot');
        const finish = document.getElementById('finish-button');
        if (finish) {
            finish.classList.add('ech-finish');
            if (arrow.nextElementSibling !== finish) finish.before(arrow);
        }
    }

    function soundOff(text) {
        if (!banner) return;
        clearInterval(banner.timer);
        const signal = banner.root.querySelector('.ech-signal');
        signal.classList.add('off');
        signal.querySelector('.ech-signal-text').textContent = text;
        banner.root.querySelector('.ech-mute').hidden = true;
        // Keep watching the page without the counter
        banner.timer = setInterval(() => {
            if (EconsulPicker.currentStep() !== EconsulPicker.CALENDAR_STEP) removeBanner();
            else highlight(EconsulPicker.findSlot(banner.slot.date, banner.slot.time), banner.arrow);
        }, 1000);
    }

    function onFinishClick(event) {
        if (!event.target.closest || !event.target.closest('#finish-button')) return;
        // The person books: stop the alarm and get out of the way
        send({ type: 'econsul:confirm-clicked' });
        removeBanner();
    }

    function removeBanner() {
        if (!banner) return;
        clearInterval(banner.timer);
        banner.style.remove();
        banner.root.remove();
        banner.arrow.remove();
        document.removeEventListener('click', onFinishClick, true);
        document.querySelectorAll('.ech-finish').forEach(el => el.classList.remove('ech-finish'));
        document.querySelectorAll('.ech-slot').forEach(el => el.classList.remove('ech-slot'));
        banner = null;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'ping') {
            sendResponse({ ok: true, taskId: (location.pathname.match(TASK_PATH_RE) || [])[1] || null, busy: !!job });
            return;
        }
        if (message.type === 'select-slot') {
            selectSlot(message);
            sendResponse({ ok: true, busy: job !== message.jobId });
            return;
        }
        if (message.type === 'sound-ended') soundOff(message.reason === 'muted' ? 'Звук вимкнено' : 'Сигнал закінчився');
        if (message.type === 'check-auth' && message.token) {
            // Check the token the background knows, if the site still has it; a different token
            // here is reported as a new one instead
            const token = readToken();
            if (token === message.token) checkAuth(token);
            else reportToken(true);
        }
    });

    // Another e-consul tab logged in or out
    window.addEventListener('storage', event => {
        if (event.key === 'token' || event.key === null) reportToken(true);
    });

    // Login in this tab does not fire "storage": poll (no network)
    const pollTimer = setInterval(() => { reportToken(); watchAddress(); }, POLL_MS);
    reportToken();
    watchAddress();
})();
