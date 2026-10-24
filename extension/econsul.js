// Content script on https://e-consul.gov.ua/*. Reads the session token the site keeps in
// localStorage.token (same origin as the page) and passes it to the background. Checks the
// token with GET my.e-consul.gov.ua/auth/me when the background asks (every 10–15 min).
// Notices when the tab shows an application (/tasks/{taskId}/…): that is the draft.
// Requests go from the page's origin, like the site's own requests.
// When the app finds slots, the background asks this tab to select one (select-slot): the
// tab goes from step 3 to the calendar with «Далі», selects the earliest free slot of the
// list (picker.js), shows a banner and highlights «Підтвердити».
//
// At the opening of new days (release-strike) it presses «Далі» on step 3 exactly at the moment
// and hands the free slots of the new calendar to the background, which selects one right there.
//
// When the background asks (create-draft), it fills steps 1–3 of a new application from the
// app's settings (creator.js) and stops on step 4 with nothing selected: that is the draft.
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
    // DRAFT_URL_RE in web/src/domain/booking/booking-url.ts
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

    // Tells the background how an own request went, for the journal: kind, time, status
    // (0: no response). Never the token or the address.
    function reportRequest(kind, startedAt, perfStart, status) {
        send({ type: 'econsul:request', kind, startedAt, durationMs: Math.round(performance.now() - perfStart), status });
    }

    async function checkAuth(token) {
        let ok = false, status = 0;
        const startedAt = Date.now(), perfStart = performance.now();
        try {
            const response = await fetch(`${API}/auth/me`, { headers: { token }, cache: 'no-store' });
            ok = response.ok;
            status = response.status;
        } catch (e) {
            status = 0; // network error: neither logged in nor out
        }
        reportRequest('auth', startedAt, perfStart, status);
        send({ type: 'econsul:auth-check', token, ok, status });
    }

    // GET /tasks/{taskId}: what the site knows about the application. { createdAt, finished,
    // deleted } or { missing } (404); null when it could not be read
    async function fetchTaskInfo(taskId, token) {
        let info = null;
        const startedAt = Date.now(), perfStart = performance.now();
        let responded = false;
        try {
            const response = await fetch(`${API}/tasks/${encodeURIComponent(taskId)}`, { headers: { token }, cache: 'no-store' });
            responded = true;
            reportRequest('tasks', startedAt, perfStart, response.status);
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
        } catch (e) {
            // network: report without the details
            if (!responded) reportRequest('tasks', startedAt, perfStart, 0);
        }
        return info;
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
            info = await fetchTaskInfo(taskId, token);
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

    // select-slot, then each next step of a chain of failed bookings the background hands back
    // (the next slot on the same calendar, without loading the draft again)
    async function selectSlot(message, startOnCalendar = false) {
        if (job) return;
        let next = message, onCalendar = startOnCalendar;
        while (next) {
            if (next.pauseMs) await new Promise(r => setTimeout(r, next.pauseMs));
            next = await selectOne(next, onCalendar);
            onCalendar = true;
        }
    }

    async function selectOne({ jobId, taskId, slots, autoBook, confirmTries, reconApi, note }, onCalendar) {
        job = jobId;
        log(`select-slot: ${slots.length} slot(s), first ${slots[0].date} ${slots[0].time}${autoBook ? ', auto-booking' : ''}${onCalendar ? ', on this calendar' : ''}`);
        removeBanner();
        let result;
        try {
            if (!location.pathname.startsWith(`/tasks/${taskId}`)) result = { error: 'wrong-task' };
            else result = await EconsulPicker.pick(slots, log, { onCalendar });
        } catch (e) {
            result = { error: 'exception: ' + e.message };
        }
        log(result.slot ? `selected ${result.slot.date} ${result.slot.time}` : `not selected: ${result.error}`);
        if (result.tried && result.tried.length) log('tried: ' + result.tried.join('; '));
        if (result.slot && reconApi) {
            // Direct-API-booking test, phase 1: the slot is selected (the site saved chosenSlots in the
            // document), so read the document shape instead of pressing «Підтвердити». Nothing is booked.
            // The selection is reported WITHOUT `booking`, so the background finalizes it as «selected»
            // (not stuck in «booking»), which lets monitoring run the recon again after the hold.
            await apiRecon(jobId, taskId, result.slot);
            send({ type: 'econsul:slot-result', jobId, ok: true, slot: result.slot, tried: result.tried });
            job = null;
            return null;
        }
        if (result.slot && autoBook) {
            send({ type: 'econsul:slot-result', jobId, ok: true, slot: result.slot, tried: result.tried, booking: true });
            return book(jobId, result.slot, confirmTries);
        }
        job = null;
        if (result.slot) {
            showBanner(result.slot, result.element, null, note);
            send({ type: 'econsul:slot-result', jobId, ok: true, slot: result.slot, tried: result.tried });
        } else {
            send({ type: 'econsul:slot-result', jobId, ok: false, error: result.error, tried: result.tried || [] });
        }
        return null;
    }

    // Direct-API-booking test, phase 1 (read-only reconnaissance). The slot is already selected, so the
    // site has saved it in the document (PUT /documents with chosenSlots). This reads GET /tasks/{id} and
    // GET /documents/{id} and reports their REAL shapes — documentId, the path to chosenSlots and the real
    // format of one chosen slot (times + consulIpnHash) — so phase 2 can build the booking request from
    // verified fields instead of the reconstructed §14 ones. No PUT, no external-reader/check, nothing
    // booked. Reports field names and the slot shape only — never the token or applicant personal data.
    async function apiRecon(jobId, taskId, slot) {
        const token = readToken();
        const out = { stage: 'recon' };
        const firstString = (...v) => v.find(x => typeof x === 'string' && x) || null;
        try {
            const startedAt = Date.now(), perfStart = performance.now();
            const tr = await fetch(`${API}/tasks/${encodeURIComponent(taskId)}`, { headers: { token }, cache: 'no-store' });
            reportRequest('tasks', startedAt, perfStart, tr.status);
            out.taskStatus = tr.status;
            const tj = tr.ok ? await tr.json() : null;
            const task = (tj && tj.data && !Array.isArray(tj.data) ? tj.data : tj) || {};
            out.taskKeys = Object.keys(task).slice(0, 25).join(',') || null;
            const docId = firstString(
                task.documentId, task.documentID,
                task.document && (task.document.id || task.document.documentId),
                Array.isArray(task.documents) && task.documents[0] && (task.documents[0].id || task.documents[0].documentId),
            );
            out.docId = docId ? String(docId).slice(0, 48) : null;
            // The site may save the chosen slot a moment after the click: read the document up to 3 times
            for (let read = 1; docId && read <= 3; read++) {
                if (read > 1) await new Promise(r => setTimeout(r, 2500));
                const s2 = Date.now(), p2 = performance.now();
                const dr = await fetch(`${API}/documents/${encodeURIComponent(docId)}`, { headers: { token }, cache: 'no-store' });
                reportRequest('document', s2, p2, dr.status);
                out.docStatus = dr.status;
                out.docReads = read;
                const dj = dr.ok ? await dr.json() : null;
                const doc = (dj && dj.data ? dj.data : dj) || {};
                const data = doc.data || doc;
                out.docKeys = Object.keys(doc).slice(0, 25).join(',') || null;
                // Field names only (no values): where the steps of the form live in the document
                out.dataKeys = Object.keys(data).slice(0, 40).join(',').slice(0, 480) || null;
                const visit = data.dateAndTimeVisitInfo;
                out.visitKeys = visit && typeof visit === 'object' ? Object.keys(visit).slice(0, 25).join(',') : null;
                const found = findKey(data, 'chosenSlots', 'data', 6);
                out.chosenPath = found ? found.path : null;
                out.hasVisitInfo = !!visit;
                out.hasCalendar = !!(visit && visit.calendar);
                const chosen = found && found.value;
                out.chosenCount = Array.isArray(chosen) ? chosen.length : null;
                // One chosen slot: times + consuls[{consulIpnHash}]. No applicant personal data in here.
                out.chosenSample = Array.isArray(chosen) && chosen[0] ? JSON.stringify(chosen[0]).slice(0, 400) : null;
                if (out.chosenCount) break;
            }
        } catch (e) {
            out.error = ((e && e.message) || 'error').slice(0, 140);
        }
        log('api-recon: ' + JSON.stringify(out));
        await send({ type: 'econsul:api-recon', jobId, slot, ...out });
    }

    // Depth-first search for a key; returns its dotted path and value, or null
    function findKey(obj, key, path, depth) {
        if (!obj || typeof obj !== 'object' || depth < 0) return null;
        if (Object.prototype.hasOwnProperty.call(obj, key)) return { path: `${path}.${key}`, value: obj[key] };
        for (const [k, v] of Object.entries(obj)) {
            const found = findKey(v, key, Array.isArray(obj) ? `${path}[${k}]` : `${path}.${k}`, depth - 1);
            if (found) return found;
        }
        return null;
    }

    // Auto-booking presses «Підтвердити» for the selected slot. Returns the next step of the chain
    // to select on this calendar, or null
    async function book(jobId, slot, confirmTries) {
        let booked;
        try {
            log('auto-booking: pressing «Підтвердити»');
            booked = await EconsulPicker.confirm(slot, log, confirmTries);
            log('auto-booking result: ' + JSON.stringify(booked));
        } catch (e) {
            booked = { error: 'exception: ' + e.message };
        }
        job = null;
        // Not booked: the background moves on to the next slot (on this calendar: `next`; or
        // by loading the draft again: no banner) or leaves this slot for the person to press
        const onCalendarNow = EconsulPicker.currentStep() === EconsulPicker.CALENDAR_STEP && !document.getElementById('next-step-button');
        const reply = await send({ type: 'econsul:book-result', jobId, slot, ...booked, onCalendar: onCalendarNow });
        if (!booked.ok && reply && reply.next && onCalendarNow) return reply.next;
        if (!booked.ok && reply && reply.showBanner && EconsulPicker.currentStep() === EconsulPicker.CALENDAR_STEP) {
            showBanner(slot, EconsulPicker.findSlot(slot.date, slot.time), reply.reason);
        }
        return null;
    }

    // Auto-booking was turned on (or the press limit reset) while a slot waits on the banner for
    // the person: press «Підтвердити» for it now, then go on like any auto-booking
    async function confirmSelected({ jobId, slot, confirmTries }) {
        job = jobId;
        removeBanner();
        const next = await book(jobId, slot, confirmTries);
        if (next) selectSlot(next, true);
    }

    // The opening of new days: the background opened step 3 of the draft half a minute ahead.
    // «Далі» exactly at `at` (picker.js strike), then the free slots of the last week go to the
    // background, which answers with the slots to select on this calendar (its usual order, date
    // range, quarantine and auto-booking)
    async function releaseStrike({ jobId, taskId, at }) {
        if (job) return;
        job = jobId;
        removeBanner();
        let result, found = { slots: [], lastDay: null };
        try {
            if (!location.pathname.startsWith(`/tasks/${taskId}`)) result = { error: 'wrong-task' };
            else {
                result = await EconsulPicker.strike(at, log);
                if (!result.error) found = await EconsulPicker.lastWeekFreeSlots();
            }
        } catch (e) {
            result = { error: 'exception: ' + e.message };
        }
        log(result.error ? `opening: ${result.error}` : `opening: calendar loaded, ${found.slots.length} free slot(s) in the last week (last day ${found.lastDay})`);
        job = null;
        const reply = await send({ type: 'econsul:strike-result', jobId, error: result.error || null, clickedAt: result.clickedAt || null, searches: result.searches || null, requests: result.requests || null, slots: found.slots, lastDay: found.lastDay });
        if (reply && reply.next) selectSlot(reply.next, true);
    }

    // ---- Draft creation ----

    let draftJob = null; // the running create-draft

    // Steps 1–3 of the application this tab shows (the background opened /tasks/create/…)
    async function createDraft({ jobId, selection }) {
        if (draftJob) return;
        draftJob = jobId;
        log(`create-draft: ${selection.institutionName}, ${selection.serviceName}`);
        let result;
        try {
            result = await EconsulCreator.createDraft(selection, log);
        } catch (e) {
            result = { error: 'exception: ' + e.message };
        }
        log(result.error ? `draft not created: ${result.error}` : 'draft created (step 4, nothing selected)');
        draftJob = null;
        const taskId = (location.pathname.match(/^\/tasks\/([^/]+)\//) || [])[1] || null;
        const reply = await send({ type: 'econsul:draft-result', jobId, ok: !result.error, error: result.error || null, taskId });
        if (reply && reply.scan) draftScan(reply.scan);
    }

    // A new draft stands on its calendar: its free slots (within the app's date range) go to the
    // background, which answers with the slots to select right here, as for the opening
    async function draftScan({ jobId, range }) {
        if (job) return;
        job = jobId;
        let result;
        try {
            result = await EconsulPicker.freeSlots(range || {}, log);
        } catch (e) {
            result = { error: 'exception: ' + e.message, slots: [] };
        }
        log(result.error ? `new draft: ${result.error}` : `new draft: ${result.slots.length} free slot(s)`);
        job = null;
        const reply = await send({ type: 'econsul:scan-result', jobId, error: result.error || null, searches: result.searches || null, slots: result.slots });
        if (reply && reply.next) selectSlot(reply.next, true);
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
        .ech-banner button:disabled { opacity: .6; cursor: default; }
        .ech-slot { box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 5px #0057B8 !important; }
        .ech-finish { background: #0057B8 !important; color: #FFFFFF !important;
            box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 6px #FFD500 !important; }
        .ech-arrow { display: inline-flex; align-items: center; gap: 8px; margin-right: 12px;
            font: 700 13px Manrope, system-ui, sans-serif; color: #3E4C5B; }
    `;
    const SPEAKER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"></path></svg>';
    const ARROW = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3E4C5B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';

    // stopped: why auto-booking gave this slot back to the person
    // note: why the person presses although auto-booking is on (the hourly limit)
    function showBanner(slot, slotElement, stopped = null, note = null) {
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
                <button type="button" class="ech-next">Наступний слот</button>
                <button type="button" class="ech-mute">Вимкнути звук</button>
            </div>`;
        root.querySelector('.ech-title').textContent = 'Вибрано: ' + slotLabel(slot);
        if (stopped) root.querySelector('.ech-hint').textContent = `Автобронювання зупинилось: ${stopped} Натисніть «Підтвердити» самі`;
        else if (note) root.querySelector('.ech-hint').textContent = `${note} Натисніть «Підтвердити» самі`;
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
        // The person wants another slot: the background picks the next one of this selection, and it is
        // selected right here on this calendar (this one is not put in quarantine, only skipped)
        root.querySelector('.ech-next').addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'Шукаю…';
            const reply = await send({ type: 'econsul:next-slot', slot });
            if (reply && reply.next) return selectSlot(reply.next, true);
            button.hidden = true;
            root.querySelector('.ech-hint').textContent = (reply && reply.text) || 'Іншого слота немає.';
        });
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
            // pageSince: when this page started loading, so the background tells it from the page before a navigation
            sendResponse({ ok: true, taskId: (location.pathname.match(TASK_PATH_RE) || [])[1] || null, path: location.pathname, busy: !!job || !!draftJob, pageSince: performance.timeOrigin });
            return;
        }
        if (message.type === 'create-draft') {
            createDraft(message);
            sendResponse({ ok: true, busy: draftJob !== message.jobId });
            return;
        }
        if (message.type === 'check-task') {
            // Is the application still a draft? Answers { info } (see fetchTaskInfo)
            const token = readToken();
            if (!token) sendResponse({ info: null });
            else fetchTaskInfo(message.taskId, token).then(info => sendResponse({ info }));
            return true;
        }
        if (message.type === 'confirm-slot') {
            const busy = !!job;
            if (!busy) confirmSelected(message);
            sendResponse({ ok: !busy });
            return;
        }
        if (message.type === 'select-slot') {
            selectSlot(message);
            sendResponse({ ok: true, busy: job !== message.jobId });
            return;
        }
        if (message.type === 'release-strike') {
            releaseStrike(message);
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
