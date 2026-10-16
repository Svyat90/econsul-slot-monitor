// Content script on https://e-consul.gov.ua/*, loaded before econsul.js: fills steps 1–3 of a new
// «Запис на візит» application (applicantInfo, placeOfVisitInfo, consularServiceInfo) and stops
// on step 4 (dateAndTimeVisitInfo) with nothing selected: that is the draft. No chrome.* here,
// so it can be tried on the page.
//
// What the site renders (checked on the live page 2026-10-16):
// - /tasks/create/161374/161374001 creates the task and moves to /tasks/{id}/applicantInfo
//   without a page load (the single-page app only changes the address)
// - step 1: the applicant data (name, tax number, email, phone, birth date, gender) come from
//   the profile; the only thing left is the required checkbox #confirmation (the consent that
//   the Ministry may cancel a visit made through third parties or services). Not filled
//   profile → not our data to invent: stop with applicant-incomplete
// - step 2: MUI Autocompletes #country and #consularInstitution (the second appears after
//   the first is chosen). Focus + click opens the list; setting the value with the native
//   setter and an `input` event filters it; options are [role=option] with ids
//   «country-option-N» / «consularInstitution-option-N»; a click on the option chooses it
// - step 3: Autocomplete #service (same way; typing the whole name leaves the exact name and
//   its variants for children), then «Зачекайте, будь ласка, відбувається перевірка», then
//   two checkboxes with the same id #whoReceivesService: «Для себе» and «Для своєї дитини,
//   підопічного». Boxes clicked during the check are lost: wait until the check is over
// - «Далі» is #next-step-button on all three steps; it saves the step and runs its checks
// var, not const: the background injects this file again into open tabs after a reload
var EconsulCreator = (() => {
    const STEP_APPLICANT = 'applicantInfo';
    const STEP_PLACE = 'placeOfVisitInfo';
    const STEP_SERVICE = 'consularServiceInfo';
    const STEP_CALENDAR = 'dateAndTimeVisitInfo';
    const CHECKING_RE = /Зачекайте|відбувається перевірка/i;
    const UNAVAILABLE_RE = /наразі недоступний|Сервіс недоступний/i;
    const FOR_SELF_RE = /^Для себе$/;

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

    // /tasks/create/{workflow}/{template} is not a step: the site first creates the task and
    // then moves to /tasks/{taskId}/applicantInfo
    function currentStep() {
        const match = location.pathname.match(/^\/tasks\/(?!create\/)[^/]+\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    function mainText() {
        const main = document.querySelector('main');
        return main ? main.innerText : '';
    }

    // Resolves once `root` has not changed for quietMs (or after maxMs): the site renders a
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

    const settle = () => waitForQuiet(document.querySelector('main') || document.body, 1200, 10000);

    // «Генеральне консульство України у Г'юстоні» in the app and on the site may differ in the
    // apostrophe, case and spaces
    function normalize(text) {
        return String(text).replace(/[’ʼ‘`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

    // Chooses `text` in the MUI Autocomplete #id: opens the list, types the name to filter it
    // and clicks the option whose text is exactly the name. Returns null or an error code
    async function pickOption(id, text, notFound) {
        const input = await waitFor(() => document.getElementById(id), 60000);
        if (!input) return notFound + '-missing';
        const want = normalize(text);
        if (normalize(input.value) === want) return null; // already chosen
        input.focus();
        input.click();
        await sleep(300);
        nativeValue.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const option = await waitFor(() => [...document.querySelectorAll(`[role=option][id^="${id}-option-"]`)]
            .find(o => normalize(o.textContent) === want), 60000);
        if (!option) return notFound;
        option.click();
        const chosen = await waitFor(() => normalize(document.getElementById(id)?.value || '') === want, 5000);
        return chosen ? null : notFound;
    }

    function clickNext() {
        const next = document.getElementById('next-step-button');
        if (!next || next.disabled) return false;
        next.click();
        return true;
    }

    // Presses «Далі» and waits for the address to leave `step`; the site may ignore a click made
    // before the form is complete, so it retries
    async function advance(step, log) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await settle();
            if (currentStep() !== step) return null;
            if (UNAVAILABLE_RE.test(mainText())) return 'unavailable';
            const pressed = await waitFor(clickNext, 30000);
            if (!pressed) return 'next-disabled';
            log(`${step}: Далі (${attempt})`);
            const moved = await waitFor(() => currentStep() !== step, 45000);
            if (moved) return null;
        }
        return 'step-stuck';
    }

    async function fillApplicant(log) {
        const box = await waitFor(() => document.getElementById('confirmation'), 90000);
        if (!box) return 'form-not-loaded';
        await settle();
        // The profile fills the fields: without them there is nothing to confirm
        const filled = ['birthDate-day', 'birthDate-year'].every(name => (document.querySelector(`[name="${name}"]`) || {}).value)
            && [...document.querySelectorAll('input[type=radio]')].some(r => r.checked);
        if (!filled) return 'applicant-incomplete';
        if (!box.checked) {
            log('applicantInfo: consent checkbox');
            box.click();
            if (!await waitFor(() => document.getElementById('confirmation')?.checked, 5000)) return 'consent-not-set';
        }
        return advance(STEP_APPLICANT, log);
    }

    async function fillPlace(selection, log) {
        log(`placeOfVisitInfo: ${selection.countryName} / ${selection.institutionName}`);
        let error = await pickOption('country', selection.countryName, 'country-not-found');
        if (error) return error;
        error = await pickOption('consularInstitution', selection.institutionName, 'institution-not-found');
        if (error) return error;
        return advance(STEP_PLACE, log);
    }

    // «Для себе»: the box is re-rendered after the checks, so look it up again every time
    function selfBox() {
        return [...document.querySelectorAll('input[id=whoReceivesService]')]
            .find(b => FOR_SELF_RE.test((b.closest('label') || b.parentElement).textContent.trim()));
    }

    async function fillService(selection, log) {
        log(`consularServiceInfo: ${selection.serviceName}`);
        const error = await pickOption('service', selection.serviceName, 'service-not-found');
        if (error) return error;
        // The site checks the service ("Зачекайте…"); boxes clicked meanwhile are reset
        await sleep(1500);
        if (!await waitFor(() => !CHECKING_RE.test(mainText()), 180000)) return 'check-timeout';
        await settle();
        if (UNAVAILABLE_RE.test(mainText())) return 'unavailable';
        for (let attempt = 1; attempt <= 3; attempt++) {
            const box = await waitFor(selfBox, 30000);
            if (!box) return 'form-not-loaded';
            if (box.checked) break;
            box.click();
            if (await waitFor(() => selfBox()?.checked, 3000)) break;
            if (attempt === 3) return 'self-not-set';
        }
        return advance(STEP_SERVICE, log);
    }

    // Walks the steps from wherever the page is to step 4. selection: { countryName,
    // institutionName, serviceName } of the app. Returns {} on success or { error }
    async function createDraft(selection, log) {
        for (let i = 0; i < 6; i++) {
            const step = await waitFor(() => currentStep(), 90000);
            if (!step) return { error: 'form-not-loaded' };
            if (step === STEP_CALENDAR) return {};
            let error;
            if (step === STEP_APPLICANT) error = await fillApplicant(log);
            else if (step === STEP_PLACE) error = await fillPlace(selection, log);
            else if (step === STEP_SERVICE) error = await fillService(selection, log);
            else return { error: 'wrong-step' };
            if (error) return { error };
        }
        return { error: 'step-stuck' };
    }

    return { createDraft, currentStep, CALENDAR_STEP: STEP_CALENDAR };
})();
