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
//   заброньовано». Selected: dark background. Several slots can be selected at once
// - once anything is selected (in any week), a checkbox «Зняти вибір усіх» unselects all
// - clicking a slot saves the document (PUT /documents) but books nothing
// var, not const: the background injects this file again into open tabs after a reload
var EconsulPicker = (() => {
    const STEPS_BEFORE_CALENDAR = ['applicantInfo', 'placeOfVisitInfo', 'consularServiceInfo'];
    const CALENDAR_STEP = 'dateAndTimeVisitInfo';
    const WEEK_RE = /^(\d\d)\.(\d\d)\.(\d{4})\s*—\s*(\d\d)\.(\d\d)\.(\d{4})$/;
    const BOOKED_RE = /заброньовано/;
    const NO_TIME_RE = /немає вільного часу|черг[уи] очікування/i;
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
            || /пошук активних слотів/i.test(mainText()) || NO_TIME_RE.test(mainText()) || UNAVAILABLE_RE.test(mainText()));
    }

    // Steps 1–3 → step 4. «Далі» there only saves the step and runs its checks. A click before
    // the form is filled from the saved document fails validation (the site logs
    // validation.errors and stays): wait for the page to settle and press again if needed
    async function reachCalendar(log) {
        for (let i = 0; i < 4; i++) {
            const step = await waitFor(() => {
                const s = currentStep();
                if (s === CALENDAR_STEP) return s;
                if (STEPS_BEFORE_CALENDAR.includes(s) && document.getElementById('next-step-button')) return s;
                return null;
            }, STEP_WAIT_MS);
            if (!step) return { error: 'form-not-loaded' };
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
                // The site's own checks after «Далі» can take a while; without them nothing
                // happening for 8 s means the click was not taken
                moved = !!await waitFor(() => {
                    if (currentStep() !== step) return true;
                    if (UNAVAILABLE_RE.test(mainText())) return true;
                    return null;
                }, STEP_MOVE_WAIT_MS);
                if (!moved) log(`step ${step}: still here after ${STEP_MOVE_WAIT_MS / 1000} s${CHECKING_RE.test(mainText()) ? ', the site is checking' : ''}`);
                if (!moved && CHECKING_RE.test(mainText())) moved = !!await waitFor(() => currentStep() !== step || UNAVAILABLE_RE.test(mainText()), CHECKS_WAIT_MS);
            }
            if (!moved) return { error: 'step-stuck' };
            if (currentStep() === step) return { error: 'unavailable' };
        }
        return currentStep() === CALENDAR_STEP ? {} : { error: 'step-stuck' };
    }

    // 'left': the page went back to a step with «Далі» (see onCalendar), the caller presses it again
    async function waitForCalendar() {
        const since = Date.now();
        return waitFor(() => {
            if (slotButtons(document).length) return 'slots';
            if (Date.now() - since > 3000 && STEPS_BEFORE_CALENDAR.includes(currentStep()) && document.getElementById('next-step-button')) return 'left';
            const text = mainText();
            if (NO_TIME_RE.test(text)) return 'no-time';
            if (UNAVAILABLE_RE.test(text)) return 'unavailable';
            return null;
        }, CALENDAR_WAIT_MS, 300);
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

    // Unselects slots chosen earlier, in any week (by hand or by an earlier run)
    async function clearSelection() {
        const box = clearAllBox();
        if (!box) return;
        box.click();
        await waitFor(() => !clearAllBox(), 10000);
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
        if (state !== 'slots') return { error: state === 'left' ? 'step-stuck' : (state || 'calendar-not-loaded') };
        log('calendar loaded');

        const tried = [];
        const byDate = new Map();
        for (const slot of slots) {
            if (!byDate.has(slot.date)) byDate.set(slot.date, []);
            byDate.get(slot.date).push(slot.time);
        }
        for (const [date, times] of byDate) {
            if (!await openWeek(date)) { tried.push(`${date}: no week`); continue; }
            await expandDay(date);
            for (const time of times) {
                const el = findSlot(date, time);
                if (!el) { tried.push(`${date} ${time}: absent`); continue; }
                if (isBooked(el)) { tried.push(`${date} ${time}: booked`); continue; }
                await clearSelection();
                const target = findSlot(date, time);
                if (target && !isSelected(target)) target.click();
                const selected = await waitFor(() => { const t = findSlot(date, time); return t && isSelected(t) && t; }, 10000);
                if (selected) return { slot: { date, time }, element: selected, tried };
                tried.push(`${date} ${time}: click did not select`);
            }
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
        if (slotButtons(document).filter(el => !isBooked(el) && isSelected(el)).length !== 1) return 'several-selected';
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

    return { pick, confirm, findSlot, isSelected, currentStep, CALENDAR_STEP };
})();
