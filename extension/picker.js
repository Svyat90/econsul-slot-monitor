// Content script on https://e-consul.gov.ua/*, loaded before econsul.js: selects a slot in the
// calendar of step 4 (dateAndTimeVisitInfo). No chrome.* here, so it can be tried on the page.
//
// What the site renders (checked on the live page 2026-10-09):
// - steps 1–3 have #next-step-button «Далі»; step 4 has #finish-button «Підтвердити» instead,
//   which books. A direct address of step 4 sends the browser back to step 3
// - while loading step 4 shows «Відбувається пошук активних слотів…»
// - week chips: elements with the text «dd.mm.yyyy — dd.mm.yyyy» (click opens the week)
// - day header: <button> «четвер, 01.04.2027»; its grandparent holds the day's slots and
//   the «Показати ще N слоти» / «Приховати» button
// - slot: [role=button] with aria-label «09:00 - 09:10», booked ones add «- цей слот вже
//   заброньовано». Selected: dark background. Several slots can be selected at once; clicking a
//   selected slot unselects it
// - once anything is selected (in any week), a checkbox «Зняти вибір усіх» unselects all
// - clicking a slot saves the document (PUT /documents) but books nothing
// var, not const: the background injects this file again into open tabs after a reload
var EconsulPicker = (() => {
    const STEPS_BEFORE_CALENDAR = ['applicantInfo', 'placeOfVisitInfo', 'consularServiceInfo'];
    const CALENDAR_STEP = 'dateAndTimeVisitInfo';
    const WEEK_RE = /^(\d\d)\.(\d\d)\.(\d{4})\s*—\s*(\d\d)\.(\d\d)\.(\d{4})$/;
    const BOOKED_RE = /заброньовано/;
    // The site's «no time» message. «Записатись в чергу очікування» is not one: it is the finish
    // button of step 4 while no slot is selected, there from the start of a search (the opening of
    // 2026-10-22: «no time» 0–1 ms after step 4 appeared, eight times, while the site's calendar
    // requests took 1–12 s and all answered 200)
    const NO_TIME_RE = /немає вільного часу/i;
    const QUEUE_RE = /черг[уи] очікування/i;
    const SEARCHING_RE = /пошук активних слотів/i;
    const UNAVAILABLE_RE = /наразі недоступний|Сервіс недоступний/i;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function waitFor(fn, timeoutMs, stepMs = 250) {
        const end = Date.now() + timeoutMs;
        for (;;) {
            const value = fn();
            if (value) return value;
            if (Date.now() > end) return null;
            await sleep(stepMs);
        }
    }

    function currentStep() {
        const match = location.pathname.match(/^\/tasks\/[^/]+\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    function mainText() {
        const main = document.querySelector('main');
        return main ? main.innerText : '';
    }

    // "2027-04-01" → "01.04.2027"
    function siteDate(iso) {
        return iso.split('-').reverse().join('.');
    }

    function isoFromParts(d, m, y) { return `${y}-${m}-${d}`; }

    function slotButtons(root) {
        return [...root.querySelectorAll('[role=button][aria-label]')]
            .filter(el => /^\d\d:\d\d - \d\d:\d\d/.test(el.getAttribute('aria-label')));
    }

    function isBooked(el) { return BOOKED_RE.test(el.getAttribute('aria-label')); }

    // The site marks a selected slot only with a generated class; its background is dark
    function isSelected(el) {
        const match = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
        if (!match) return false;
        const [r, g, b, a = 1] = match.map(Number);
        if (a === 0) return false;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35;
    }

    function weekChips() {
        return [...document.querySelectorAll('main div')]
            .filter(el => el.children.length === 0 && WEEK_RE.test(el.textContent.trim()))
            .map(el => {
                const m = el.textContent.trim().match(WEEK_RE);
                return { el, from: isoFromParts(m[1], m[2], m[3]), to: isoFromParts(m[4], m[5], m[6]) };
            });
    }

    function dayGroup(isoDate) {
        const label = siteDate(isoDate);
        const header = [...document.querySelectorAll('main button')]
            .find(b => b.textContent.trim().endsWith(label) && /,/.test(b.textContent));
        return header ? header.parentElement.parentElement : null;
    }

    function clickNext() {
        const next = document.getElementById('next-step-button');
        if (!next || next.disabled) return false;
        next.click();
        return true;
    }

    // Resolves once `root` has not changed for quietMs (or after maxMs): the site renders the
    // form first and fills it from the saved document a moment later
    function waitForQuiet(root, quietMs, maxMs) {
        return new Promise(resolve => {
            let timer = null;
            const done = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
            const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quietMs); });
            observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
            timer = setTimeout(done, quietMs);
            const cap = setTimeout(done, maxMs);
        });
    }

    const CHECKING_RE = /Зачекайте|відбувається перевірка/i;
    // The form gets its saved values a few seconds after the page loads, without visible changes
    // for a while: «Далі» 4 s after the load failed validation on the live site
    const MIN_PAGE_AGE_MS = 6000;

    // When new days open the site is loaded by everyone who tries to book and answers many times
    // slower (tens of seconds instead of a few). Every wait below is generous on purpose: giving
    // up early and starting over only adds load and loses the slot's place in the race
    const STEP_WAIT_MS = 90 * 1000;       // the form of a step appears
    const NEXT_CLICK_WAIT_MS = 30 * 1000; // «Далі» becomes active
    const STEP_MOVE_WAIT_MS = 45 * 1000;  // the address changes after «Далі», before it is pressed again
    const CHECKS_WAIT_MS = 120 * 1000;    // the site's own checks after «Далі» («Зачекайте…»)
    const CALENDAR_WAIT_MS = 180 * 1000;  // the calendar shows slots after «Відбувається пошук…»
    const WEEK_WAIT_MS = 15 * 1000;

    // Really on the calendar: the address says step 4, step 4 has no «Далі», and the page shows
    // the search, slots, the «no time» text or «Підтвердити». A direct address of step 4 shows
    // step 4 for a moment and then sends the browser back to step 3 («Далі» is there)
    function onCalendar() {
        if (currentStep() !== CALENDAR_STEP || document.getElementById('next-step-button')) return false;
        return !!(document.getElementById('finish-button') || slotButtons(document).length
            || SEARCHING_RE.test(mainText()) || NO_TIME_RE.test(mainText()) || QUEUE_RE.test(mainText()) || UNAVAILABLE_RE.test(mainText()));
    }

    // After «Далі» on `step`: true once the address changed or the site says «unavailable». The
    // site's own checks after «Далі» can take a while; without them nothing happening for
    // STEP_MOVE_WAIT_MS means the click was not taken
    async function waitMoved(step, log) {
        let moved = !!await waitFor(() => currentStep() !== step || UNAVAILABLE_RE.test(mainText()) || null, STEP_MOVE_WAIT_MS);
        if (!moved) log(`step ${step}: still here after ${STEP_MOVE_WAIT_MS / 1000} s${CHECKING_RE.test(mainText()) ? ', the site is checking' : ''}`);
        if (!moved && CHECKING_RE.test(mainText())) moved = !!await waitFor(() => currentStep() !== step || UNAVAILABLE_RE.test(mainText()), CHECKS_WAIT_MS);
        return moved;
    }

    // The draft is always opened on step 3. The site showing step 1 or 2 instead means it reset the
    // draft: the morning after its creation it opened on step 1 (the owner's report, 2026-10-20),
    // and «Далі» there would go on without the consent. The background makes a new draft
    const RESET_STEPS = ['applicantInfo', 'placeOfVisitInfo'];

    function formStep() {
        const s = currentStep();
        if (s === CALENDAR_STEP) return s;
        if (STEPS_BEFORE_CALENDAR.includes(s) && document.getElementById('next-step-button')) return s;
        return null;
    }

    // Steps 1–3 → step 4. «Далі» there only saves the step and runs its checks. A click before
    // the form is filled from the saved document fails validation (the site logs
    // validation.errors and stays): wait for the page to settle and press again if needed
    async function reachCalendar(log) {
        for (let i = 0; i < 4; i++) {
            const step = await waitFor(formStep, STEP_WAIT_MS);
            if (!step) return { error: 'form-not-loaded' };
            if (i === 0 && RESET_STEPS.includes(step)) return { error: 'draft-reset' };
            if (step === CALENDAR_STEP) {
                // do not trust the address alone: see onCalendar
                await sleep(3000);
                if (onCalendar()) return {};
                log('the address says step 4, the page is not on the calendar: going on from the step it shows');
                continue;
            }
            let moved = false;
            for (let attempt = 1; attempt <= 3 && !moved; attempt++) {
                const age = performance.now();
                if (age < MIN_PAGE_AGE_MS) await sleep(MIN_PAGE_AGE_MS - age);
                await waitForQuiet(document.querySelector('main') || document.body, 1500, 15000);
                if (currentStep() !== step) { moved = true; break; }
                if (UNAVAILABLE_RE.test(mainText())) return { error: 'unavailable' };
                log(`step ${step}: Далі (${attempt})`);
                if (!await waitFor(clickNext, NEXT_CLICK_WAIT_MS)) return { error: 'next-disabled' };
                moved = await waitMoved(step, log);
            }
            if (!moved) return { error: 'step-stuck' };
            if (currentStep() === step) return { error: 'unavailable' };
        }
        return currentStep() === CALENDAR_STEP ? {} : { error: 'step-stuck' };
    }

    // How each calendar search went («no-time:1250», «slots:8400»), for the journal of a strike
    let searchLog = [];

    // 'left': the page went back to a step with «Далі» (see onCalendar), the caller presses it again
    // «No time» is the site's answer only once its search is over: the search text was shown, or a
    // calendar request of this search came back, and the message then stays NO_TIME_HOLD_MS. Without
    // either for NO_TIME_MAX_WAIT_MS the message is taken as it is
    async function waitForCalendar() {
        const since = Date.now();
        const sincePerf = performance.now();
        let searched = false, noTimeSince = null;
        const state = await waitFor(() => {
            if (slotButtons(document).length) return 'slots';
            if (Date.now() - since > 3000 && STEPS_BEFORE_CALENDAR.includes(currentStep()) && document.getElementById('next-step-button')) return 'left';
            const text = mainText();
            if (SEARCHING_RE.test(text)) { searched = true; noTimeSince = null; return null; }
            if (NO_TIME_RE.test(text)) {
                const answered = searched || calendarRequests(sincePerf) > 0 || Date.now() - since > NO_TIME_MAX_WAIT_MS;
                if (!answered) return null;
                noTimeSince ??= Date.now();
                return Date.now() - noTimeSince >= NO_TIME_HOLD_MS ? 'no-time' : null;
            }
            noTimeSince = null;
            if (UNAVAILABLE_RE.test(text)) return 'unavailable';
            return null;
        }, CALENDAR_WAIT_MS, 300);
        lastSearchMs = Date.now() - since;
        // «no-time:9400:r2s»: outcome, ms, calendar requests that came back, s = the search text was seen
        searchLog.push(`${state || 'timeout'}:${lastSearchMs}:r${calendarRequests(sincePerf)}${searched ? 's' : ''}`);
        return state;
    }
    const NO_TIME_HOLD_MS = 1500;
    const NO_TIME_MAX_WAIT_MS = 30 * 1000;

    // The site's external_reader requests that came back since `sincePerf` (performance.now());
    // a request in flight has no entry yet
    function calendarRequests(sincePerf) {
        try {
            return performance.getEntriesByType('resource')
                .filter(e => e.startTime >= sincePerf && /my\.e-consul\.gov\.ua\/external_reader/.test(e.name)).length;
        } catch (e) {
            return 0;
        }
    }
    let lastSearchMs = null;

    // «Немає вільного часу» this soon after step 4 appeared is not the site's answer. A real search
    // fetches the schedule and the reserved slots and counts them in a worker: ~25 s on a calm site
    // (2026-10-20), and those requests took 5–13 s at the opening. Yet at the opening the text came
    // 1.25 s after «Далі», twice (the loaded site seems to show it when its requests fail)
    const QUICK_NO_TIME_MS = 5000;

    // «Назад» to step 3 and «Далі» again: a new search without loading the page. Step 3 is ready
    // ~1 s after «Назад» and step 4 shows ~1 s after «Далі» (live, 2026-10-20); loading the draft
    // takes ~15 s and more on a loaded site. Returns what waitForCalendar returns, or an error code
    async function searchAgain(log) {
        const back = document.getElementById('prev-step-button');
        if (!back || currentStep() !== CALENDAR_STEP) return 'left';
        back.click();
        const ready = await waitFor(() => {
            const next = document.getElementById('next-step-button');
            return currentStep() === 'consularServiceInfo' && next && !next.disabled;
        }, STEP_MOVE_WAIT_MS);
        if (!ready) return 'step-stuck';
        await waitForQuiet(document.querySelector('main') || document.body, 300, 3000);
        log('search again: Далі');
        if (!await waitFor(clickNext, NEXT_CLICK_WAIT_MS)) return 'next-disabled';
        if (!await waitMoved('consularServiceInfo', log) || currentStep() !== CALENDAR_STEP) return 'left';
        return waitForCalendar();
    }

    // ---- The opening of new days ----
    // The site builds the calendar from the browser's clock (booking.md §6): a new day is in it
    // only when step 4 is loaded after the day's opening moment. The background opens step 3 half
    // a minute ahead; «Далі» is pressed exactly at the moment, not before and not after it
    const STRIKE_STEP = 'consularServiceInfo';
    // A timer alone may fire late: Chrome aligns the timers of a hidden or covered window to
    // whole seconds. The last second before the moment is a busy wait instead
    const SPIN_MS = 1000;

    // Resolves when the clock reaches `at` (epoch ms): never before it, a few ms after it at most
    async function waitUntil(at) {
        const ahead = at - Date.now() - SPIN_MS;
        if (ahead > 0) await sleep(ahead);
        while (Date.now() < at) { /* the last second: busy wait */ }
    }

    // Time left before the busy wait, for the waits that must not run into the moment
    function untilSpin(at) { return Math.max(0, at - Date.now() - SPIN_MS - 100); }

    // Step 3 is on the page: get it ready, press «Далі» at `at` and wait for the calendar.
    // { clickedAt } once it shows slots, or { error, clickedAt }. The page may come too late to
    // fill the form before the moment (a slow site): then «Далі» is pressed at the moment anyway,
    // and if the site does not take it, the usual way presses it again (reachCalendar)
    async function strike(at, log = () => {}) {
        const step = await waitFor(formStep, STEP_WAIT_MS);
        if (!step) return { error: 'form-not-loaded' };
        if (RESET_STEPS.includes(step)) return { error: 'draft-reset' };
        if (step !== STRIKE_STEP) return { error: 'wrong-step' };
        const age = performance.now();
        if (age < MIN_PAGE_AGE_MS) await sleep(Math.min(MIN_PAGE_AGE_MS - age, untilSpin(at)));
        await waitForQuiet(document.querySelector('main') || document.body, 1500, Math.min(15000, untilSpin(at)));
        if (currentStep() !== STRIKE_STEP) return { error: 'wrong-step' };
        await waitFor(() => { const b = document.getElementById('next-step-button'); return b && !b.disabled; }, untilSpin(at));
        log(`opening: «Далі» at ${new Date(at).toLocaleTimeString()}`);
        await waitUntil(at);
        // Pressed at once when it is active; otherwise as soon as it becomes active
        if (!clickNext() && !await waitFor(clickNext, NEXT_CLICK_WAIT_MS, 20)) return { error: 'next-disabled' };
        const clickedAt = Date.now();
        const clickedPerf = performance.now();
        log(`opening: «Далі» pressed ${clickedAt - at} ms after the moment`);
        // The site's own API requests after the click, «status:ms» each (0: not answered or not
        // exposed): tells a refused or failed calendar request from a real «no time»
        const siteRequests = () => {
            try {
                return performance.getEntriesByType('resource')
                    .filter(e => e.startTime >= clickedPerf && /my\.e-consul\.gov\.ua\/external_reader/.test(e.name))
                    .map(e => `${e.responseStatus || 0}:${Math.round(e.duration)}`).join(',');
            } catch (e) {
                return ''; // only for the journal: never stops the strike
            }
        };
        searchLog = [];
        const moved = await waitMoved(STRIKE_STEP, log);
        let state = moved && currentStep() === CALENDAR_STEP ? await waitForCalendar() : 'left';
        let rounds = 0;
        for (;;) {
            if (state === 'left' && rounds < 3) {
                rounds++;
                log(`opening: not on the calendar (round ${rounds}), the usual way`);
                const reached = await reachCalendar(log);
                if (reached.error) return { ...reached, clickedAt, searches: searchLog.join(',') };
                state = await waitForCalendar();
                continue;
            }
            // «No time» right after the opening, real or not, is searched again on this page: the
            // slots of the new day are taken within a minute, a reload of the draft is too slow
            if (state === 'no-time' && searchLog.length < STRIKE_SEARCHES && Date.now() < at + STRIKE_SEARCH_MS) {
                log(`opening: «no time» after ${lastSearchMs} ms, searching again (${searchLog.length + 1})`);
                state = await searchAgain(log);
                continue;
            }
            break;
        }
        const searches = searchLog.join(',');
        const requests = siteRequests();
        if (state !== 'slots') return { error: state === 'left' ? 'step-stuck' : (state || 'calendar-not-loaded'), clickedAt, searches, requests };
        return { clickedAt, searches, requests };
    }
    const STRIKE_SEARCHES = 8;           // calendar searches at the opening at most
    const STRIKE_SEARCH_MS = 90 * 1000;  // ...and none started later than this after the moment

    const DAY_RE = /,\s*(\d\d)\.(\d\d)\.(\d{4})$/;

    // ISO dates of the day headers on the page («четвер, 01.04.2027»)
    function shownDays() {
        const days = [...document.querySelectorAll('main button')]
            .map(b => b.textContent.trim().match(DAY_RE)).filter(Boolean)
            .map(m => isoFromParts(m[1], m[2], m[3]));
        return [...new Set(days)];
    }

    // The free slots of the last week of the calendar, where the opening adds the new day.
    // { slots: [{ date, time }], lastDay: the last day of the calendar }
    async function lastWeekFreeSlots() {
        const chips = weekChips();
        if (chips.length) {
            const last = chips.reduce((a, b) => (b.to > a.to ? b : a));
            last.el.click();
            await waitFor(() => shownDays().some(d => last.from <= d && d <= last.to), WEEK_WAIT_MS);
        }
        const slots = [];
        const days = shownDays();
        for (const date of days) {
            const group = await expandDay(date);
            if (!group) continue;
            for (const el of slotButtons(group)) {
                if (!isBooked(el)) slots.push({ date, time: el.getAttribute('aria-label').slice(0, 5) });
            }
        }
        return { slots, lastDay: days.length ? days.reduce((a, b) => (b > a ? b : a)) : null };
    }

    // The free slots of the calendar a new draft shows (step 4, nothing selected) within the date
    // range { from, to }: week by week from the earliest, up to the first week with free slots in
    // range (the usual order tries the earliest day first; the app's slots join the chain later).
    // { slots: [{ date, time }], searches, error? }; a «no time» calendar is no slots, not an error
    async function freeSlots(range = {}, log = () => {}) {
        searchLog = [];
        if (currentStep() !== CALENDAR_STEP) return { error: 'wrong-step', slots: [] };
        const state = await waitForCalendar();
        const searches = searchLog.join(',');
        if (state === 'no-time') return { slots: [], searches };
        if (state !== 'slots') return { error: state === 'left' ? 'step-stuck' : (state || 'calendar-not-loaded'), slots: [], searches };
        const inRange = d => (!range.from || d >= range.from) && (!range.to || d <= range.to);
        const weeks = weekChips()
            .filter(w => (!range.to || w.from <= range.to) && (!range.from || w.to >= range.from))
            .map(w => w.from).sort();
        for (const from of weeks.length ? weeks : [null]) {
            // The chips are drawn again after each click: find this week's chip anew
            const week = from && weekChips().find(w => w.from === from);
            if (week && !shownDays().some(d => week.from <= d && d <= week.to)) {
                week.el.click();
                await waitFor(() => shownDays().some(d => week.from <= d && d <= week.to), WEEK_WAIT_MS);
            }
            const slots = [];
            const days = shownDays().filter(d => inRange(d) && (!week || (week.from <= d && d <= week.to))).sort();
            for (const date of days) {
                const group = await expandDay(date);
                if (!group) continue;
                for (const el of slotButtons(group)) {
                    if (!isBooked(el)) slots.push({ date, time: el.getAttribute('aria-label').slice(0, 5) });
                }
            }
            if (slots.length) {
                log(`new draft: ${slots.length} free slot(s) in the week from ${from || days[0]}`);
                return { slots, searches };
            }
        }
        return { slots: [], searches };
    }

    async function openWeek(isoDate) {
        if (dayGroup(isoDate)) return true;
        const chip = weekChips().find(w => w.from <= isoDate && isoDate <= w.to);
        if (!chip) return false;
        chip.el.click();
        return !!await waitFor(() => dayGroup(isoDate), WEEK_WAIT_MS);
    }

    async function expandDay(isoDate) {
        const group = dayGroup(isoDate);
        const more = group && [...group.querySelectorAll('button')].find(b => /^Показати ще/.test(b.textContent.trim()));
        if (more) {
            more.click();
            await waitFor(() => {
                const g = dayGroup(isoDate);
                return g && ![...g.querySelectorAll('button')].some(b => /^Показати ще/.test(b.textContent.trim()));
            }, 10000);
        }
        return dayGroup(isoDate);
    }

    function findSlot(isoDate, time) {
        const group = dayGroup(isoDate);
        if (!group) return null;
        return slotButtons(group).find(el => el.getAttribute('aria-label').startsWith(time + ' - ')) || null;
    }

    function clearAllBox() {
        const group = [...document.querySelectorAll('main .MuiFormGroup-root, main label')]
            .find(el => /Зняти вибір усіх/.test(el.textContent));
        return group && group.querySelector('input[type=checkbox]');
    }

    function selectedSlots() {
        return slotButtons(document).filter(el => !isBooked(el) && isSelected(el));
    }

    // Unselects slots chosen earlier, in any week (by hand or by an earlier run). A loaded site may
    // leave the old slot selected after «Зняти вибір усіх» (the opening of 2026-10-23: 09:40 stayed
    // selected, 10:30 was added and «Підтвердити» saw two), so it checks and tries again, then
    // clicks the shown selected slots one by one. Returns false when something is still selected
    const CLEAR_WAIT_MS = 20000;
    const cleared = () => !clearAllBox() && !selectedSlots().length;

    async function clearSelection(log = () => {}) {
        for (let round = 1; round <= 2 && !cleared(); round++) {
            const box = clearAllBox();
            if (!box) break;
            box.click();
            if (await waitFor(cleared, CLEAR_WAIT_MS)) return true;
            log(`«Зняти вибір усіх» did not clear the selection (round ${round})`);
        }
        await unselect(selectedSlots(), log);
        return cleared();
    }

    // Clicking a selected slot unselects it. The elements are looked up anew: the day is redrawn after each click
    async function unselect(elements, log = () => {}) {
        const labels = elements.map(el => el.getAttribute('aria-label'));
        for (const label of labels) {
            const el = selectedSlots().find(e => e.getAttribute('aria-label') === label);
            if (!el) continue;
            log(`unselecting ${label.slice(0, 5)}`);
            el.click();
            await waitFor(() => !selectedSlots().some(e => e.getAttribute('aria-label') === label), CLEAR_WAIT_MS);
        }
    }

    // slots: [{ date: 'YYYY-MM-DD', time: 'HH:MM' }], earliest first. Selects the first one the
    // calendar shows as free. Returns { slot, element } or { error, tried }
    // opts.onCalendar: the next slot of a chain on the calendar this page already shows
    async function pick(slots, log = () => {}, opts = {}) {
        let state = null;
        if (opts.onCalendar && onCalendar() && slotButtons(document).length) state = 'slots';
        for (let round = 1; round <= 3 && state !== 'slots'; round++) {
            const reached = await reachCalendar(log);
            if (reached.error) return reached;
            log('calendar step, waiting for slots');
            state = await waitForCalendar();
            if (state !== 'left') break;
            log(`back on a step before the calendar (round ${round}): pressing «Далі» again`);
        }
        for (let again = 0; state === 'no-time' && lastSearchMs < QUICK_NO_TIME_MS && again < 2; again++) {
            log(`«no time» after ${lastSearchMs} ms is too quick to be the site's answer: searching again`);
            state = await searchAgain(log);
        }
        if (state !== 'slots') return { error: state === 'left' ? 'step-stuck' : (state || 'calendar-not-loaded') };
        log('calendar loaded');

        // Strictly in the given order (the background's tryOrder: day by day, random within a day)
        const tried = [];
        const noWeek = new Set();
        for (const { date, time } of slots) {
            if (noWeek.has(date)) { tried.push(`${date} ${time}: no week`); continue; }
            if (!await openWeek(date)) { noWeek.add(date); tried.push(`${date}: no week`); continue; }
            await expandDay(date);
            const el = findSlot(date, time);
            if (!el) { tried.push(`${date} ${time}: absent`); continue; }
            if (isBooked(el)) { tried.push(`${date} ${time}: booked`); continue; }
            if (!await clearSelection(log)) return { error: 'selection-not-cleared', tried };
            const target = findSlot(date, time);
            if (target && !isSelected(target)) target.click();
            const selected = await waitFor(() => { const t = findSlot(date, time); return t && isSelected(t) && t; }, 10000);
            if (selected) return { slot: { date, time }, element: selected, tried };
            tried.push(`${date} ${time}: click did not select`);
        }
        return { error: 'not-found', tried };
    }

    // Auto-booking only (the person turned it on): presses «Підтвердити» for the slot `slot`
    // that pick() selected, then waits for what the site shows. Only #finish-button with
    // exactly this text: «Підтверджую» (moving an existing appointment) and «Записатись в
    // чергу очікування» are left to the person
    const CONFIRM_TEXT = 'Підтвердити';
    const SAVE_PAUSE_MS = 2500; // the click on the slot saves the document (PUT) first
    const DONE_RE = /Дякуємо|обробляємо ваш запит/i;

    function alertTexts() {
        return [...document.querySelectorAll('[role=alert], [role=alertdialog], [role=dialog], .MuiAlert-message, .MuiSnackbar-root, .MuiDialog-root')]
            .map(el => el.innerText.trim()).filter(Boolean);
    }

    function checkReady(slot) {
        if (currentStep() !== CALENDAR_STEP) return 'not-on-calendar';
        const shown = findSlot(slot.date, slot.time);
        if (!shown || !isSelected(shown)) return 'slot-not-selected';
        if (selectedSlots().length !== 1) return 'several-selected';
        const button = document.getElementById('finish-button');
        if (!button || button.disabled || button.textContent.trim() !== CONFIRM_TEXT) return 'no-confirm-button';
        return null;
    }

    // The site's own line near the buttons («Сервіс недоступний. Скористайтеся послугою пізніше»): it is
    // plain text, not an alert, and is what a loaded site answers to «Підтвердити»
    function unavailableText() {
        const line = [...document.querySelectorAll('main *')]
            .find(el => !el.children.length && UNAVAILABLE_RE.test(el.textContent) && el.textContent.length < 300);
        return line ? line.textContent.trim() : '';
    }

    // «Підтвердити» is pressed again when the site says it is unavailable (not booked yet), like a person
    // would: up to CONFIRM_TRIES times with a growing pause. It is never pressed again after any other
    // answer or silence: a booking that may be going through must not be repeated
    const CONFIRM_TRIES = 6; // the default; the background passes fewer outside the opening window
    const CONFIRM_PAUSE_MS = 8000;
    const READY_WAIT_MS = 15000; // «Підтвердити» becomes active after the slot is saved
    const ANSWER_WAIT_MS = 240000; // a loaded site may take minutes to answer a booking: not an error yet

    async function confirm(slot, log = () => {}, tries = CONFIRM_TRIES) {
        let presses = 0;
        // Right after the click on the slot the site saves it and «Підтвердити» is not active yet
        let error = null;
        await waitFor(() => !(error = checkReady(slot)), READY_WAIT_MS);
        if (error === 'several-selected') {
            // Another slot stayed selected (a loaded site, or a click by the person): keep only this one
            await unselect(selectedSlots().filter(el => !el.getAttribute('aria-label').startsWith(slot.time + ' - ')), log);
            await waitFor(() => !(error = checkReady(slot)), READY_WAIT_MS);
        }
        if (error) return { error };
        // The person watching sees the button being pressed and the site's answer next to it
        document.getElementById('finish-button').scrollIntoView({ block: 'center', behavior: 'smooth' });
        await sleep(SAVE_PAUSE_MS);
        let last = null;
        for (let attempt = 1; attempt <= tries; attempt++) {
            error = checkReady(slot);
            if (error) return { error, text: last ? last.text : undefined, presses };
            const before = new Set(alertTexts());
            const hadUnavailable = !!unavailableText();
            log(`confirm: «Підтвердити» (${attempt}/${tries})`);
            const finish = document.getElementById('finish-button');
            finish.scrollIntoView({ block: 'center' }); // React may have re-rendered it since
            finish.click();
            presses++;
            const clickedAt = Date.now();
            const outcome = await waitFor(() => {
                if (DONE_RE.test(document.body.innerText)) return 'done';
                const fresh = alertTexts().filter(t => !before.has(t));
                if (fresh.length) return 'alert';
                if (currentStep() !== CALENDAR_STEP) return 'left-calendar';
                // the line may already be there from the previous try: give the site a moment to answer anew
                if (unavailableText() && (!hadUnavailable || Date.now() - clickedAt > 4000)) return 'unavailable';
                return null;
            }, ANSWER_WAIT_MS, 500);
            if (outcome === 'done') return { ok: true, presses, text: (document.querySelector('main') || document.body).innerText.slice(0, 500) };
            if (outcome === 'unavailable') {
                last = { error: 'unavailable', text: unavailableText().slice(0, 300), path: location.pathname };
                log(`confirm: the site says «${last.text}»`);
                if (attempt < tries) await sleep(CONFIRM_PAUSE_MS * attempt);
                continue;
            }
            const text = outcome === 'alert'
                ? alertTexts().filter(t => !before.has(t)).join(' | ').slice(0, 500)
                : (document.querySelector('main') || document.body).innerText.slice(0, 500);
            return { error: outcome || 'no-outcome', text, path: location.pathname, presses };
        }
        return last ? { ...last, presses } : { error: 'no-outcome', presses };
    }

    return { pick, confirm, strike, lastWeekFreeSlots, freeSlots, findSlot, isSelected, currentStep, CALENDAR_STEP };
})();
