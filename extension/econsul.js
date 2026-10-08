// Content script on https://e-consul.gov.ua/*. Reads the session token the site keeps in
// localStorage.token (same origin as the page) and passes it to the background. Checks the
// token with GET my.e-consul.gov.ua/auth/me when the background asks (every 10–15 min).
// Notices when the tab shows an application (/tasks/{taskId}/…): that is the draft.
// Requests go from the page's origin, like the site's own requests.
//
// It only reads: no clicks, no form changes, no booking requests. The only API calls are
// GET auth/me and GET tasks/{taskId}, which the site itself makes when it opens a task.

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

    chrome.runtime.onMessage.addListener(message => {
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
