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
            }, 30000);
            if (!step) return { error: 'form-not-loaded' };
            if (step === CALENDAR_STEP) return {};
            let moved = false;
            for (let attempt = 1; attempt <= 3 && !moved; attempt++) {
                const age = performance.now();
                if (age < MIN_PAGE_AGE_MS) await sleep(MIN_PAGE_AGE_MS - age);
                await waitForQuiet(document.querySelector('main') || document.body, 1500, 15000);
                if (currentStep() !== step) { moved = true; break; }
                if (UNAVAILABLE_RE.test(mainText())) return { error: 'unavailable' };
                log(`step ${step}: Далі (${attempt})`);
                if (!await waitFor(clickNext, 15000)) return { error: 'next-disabled' };
                // The site's own checks after «Далі» can take a while; without them nothing
                // happening for 8 s means the click was not taken
                moved = !!await waitFor(() => {
                    if (currentStep() !== step) return true;
                    if (UNAVAILABLE_RE.test(mainText())) return true;
                    return null;
                }, 8000);
                if (!moved) log(`step ${step}: still here after 8 s${CHECKING_RE.test(mainText()) ? ', the site is checking' : ''}`);
                if (!moved && CHECKING_RE.test(mainText())) moved = !!await waitFor(() => currentStep() !== step || UNAVAILABLE_RE.test(mainText()), 45000);
            }
            if (!moved) return { error: 'step-stuck' };
            if (currentStep() === step) return { error: 'unavailable' };
        }
        return currentStep() === CALENDAR_STEP ? {} : { error: 'step-stuck' };
    }

    async function waitForCalendar() {
        return waitFor(() => {
            if (slotButtons(document).length) return 'slots';
            const text = mainText();
            if (NO_TIME_RE.test(text)) return 'no-time';
            if (UNAVAILABLE_RE.test(text)) return 'unavailable';
            return null;
        }, 60000, 300);
    }

    async function openWeek(isoDate) {
        if (dayGroup(isoDate)) return true;
        const chip = weekChips().find(w => w.from <= isoDate && isoDate <= w.to);
        if (!chip) return false;
        chip.el.click();
        return !!await waitFor(() => dayGroup(isoDate), 5000);
    }

    async function expandDay(isoDate) {
        const group = dayGroup(isoDate);
        const more = group && [...group.querySelectorAll('button')].find(b => /^Показати ще/.test(b.textContent.trim()));
        if (more) {
            more.click();
            await waitFor(() => {
                const g = dayGroup(isoDate);
                return g && ![...g.querySelectorAll('button')].some(b => /^Показати ще/.test(b.textContent.trim()));
            }, 3000);
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
        await waitFor(() => !clearAllBox(), 3000);
    }

    // slots: [{ date: 'YYYY-MM-DD', time: 'HH:MM' }], earliest first. Selects the first one the
    // calendar shows as free. Returns { slot, element } or { error, tried }
    async function pick(slots, log = () => {}) {
        const reached = await reachCalendar(log);
        if (reached.error) return reached;
        log('calendar step, waiting for slots');
        const state = await waitForCalendar();
        if (state !== 'slots') return { error: state || 'calendar-not-loaded' };
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
                const selected = await waitFor(() => { const t = findSlot(date, time); return t && isSelected(t) && t; }, 3000);
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
        return [...document.querySelectorAll('[role=alert], [role=alertdialog], .MuiAlert-message, .MuiSnackbar-root')]
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

    async function confirm(slot) {
        let error = checkReady(slot);
        if (error) return { error };
        await sleep(SAVE_PAUSE_MS);
        error = checkReady(slot);
        if (error) return { error };
        const before = new Set(alertTexts());
        document.getElementById('finish-button').click();
        const outcome = await waitFor(() => {
            if (DONE_RE.test(document.body.innerText)) return 'done';
            const fresh = alertTexts().filter(t => !before.has(t));
            if (fresh.length) return 'alert';
            if (currentStep() !== CALENDAR_STEP) return 'left-calendar';
            return null;
        }, 90000, 500);
        const text = (outcome === 'alert' ? alertTexts().filter(t => !before.has(t)).join(' | ') : (document.querySelector('main') || document.body).innerText).slice(0, 500);
        if (outcome === 'done') return { ok: true, text };
        return { error: outcome || 'no-outcome', text, path: location.pathname };
    }

    return { pick, confirm, findSlot, isSelected, currentStep, CALENDAR_STEP };
})();
