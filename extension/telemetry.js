// Journal of the extension for the local server (loaded into the service worker with
// importScripts): its own requests to e-Consul (POST /api/request-log) and its events
// (POST /api/extension-events). Contracts: server/src/contracts/{request-log,extension-events}.ts.
//
// The service worker sleeps, so records wait in chrome.storage.local (telemetryQueue, at most
// QUEUE_MAX, the oldest are dropped) and go out in batches after each record and on the `tick`
// alarm. A record never holds the token, a URL with it or applicant data; writing to the journal
// never throws and never blocks the extension's work.
const Telemetry = (() => {
    const API = 'http://localhost:4000';
    const QUEUE_KEY = 'telemetryQueue';
    const QUEUE_MAX = 2000;
    const BATCH_MAX = 100;
    const VERSION = chrome.runtime.getManifest().version;
    const SESSION_ID = crypto.randomUUID(); // one per service worker start
    const ENDPOINTS = { request: '/api/request-log', event: '/api/extension-events' };
    const SECRET_KEY = /token|authorization|cookie|password|jwt/i;

    // Storage reads and writes of the queue run one at a time
    let chain = Promise.resolve();
    function exclusive(fn) {
        const run = chain.then(fn);
        chain = run.catch(() => {});
        return run;
    }

    async function readQueue() {
        const { [QUEUE_KEY]: queue } = await chrome.storage.local.get(QUEUE_KEY);
        return Array.isArray(queue) ? queue : [];
    }

    function push(kind, record) {
        return exclusive(async () => {
            const queue = await readQueue();
            queue.push({ kind, record });
            await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-QUEUE_MAX) });
        }).then(flush, () => {});
    }

    // Flat map of small values, at most 20 keys, no key that could carry a secret
    function cleanPayload(payload) {
        const clean = {};
        for (const [key, value] of Object.entries(payload || {})) {
            if (Object.keys(clean).length >= 20 || SECRET_KEY.test(key) || key.length > 50) continue;
            if (typeof value === 'string') clean[key] = value.slice(0, 500);
            else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
            else if (typeof value === 'boolean' || value === null) clean[key] = value;
        }
        return clean;
    }

    // type: one of extensionEventTypes of the contract; opts: { jobId, test }
    function event(type, payload = {}, opts = {}) {
        return push('event', {
            clientId: crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
            type,
            jobId: opts.jobId ? String(opts.jobId).slice(0, 100) : null,
            payload: cleanPayload(payload),
            extensionVersion: VERSION,
            test: !!opts.test
        });
    }

    // One own request to e-Consul. kind: 'auth' | 'tasks'; status: HTTP status, 0 without a response
    function request({ kind, startedAt, durationMs, status }) {
        const network = status === 0;
        const outcome = network ? 'network_error'
            : status >= 200 && status < 300 ? 'ok'
            : status === 401 || status === 403 ? 'session_expired'
            : 'unavailable';
        return push('request', {
            clientId: crypto.randomUUID(),
            startedAt: new Date(startedAt).toISOString(),
            durationMs,
            service: kind,
            method: kind === 'auth' ? 'GET auth/me' : kind === 'document' ? 'GET documents/:id' : 'GET tasks/:id', // never the id
            institutionCode: null,
            filters: {},
            httpStatus: network ? null : status,
            outcome,
            itemsCount: null,
            responseBytes: null,
            checkKind: null,
            checkSeq: null,
            source: 'extension',
            tabSessionId: SESSION_ID,
            appVersion: VERSION,
            errorMessage: network ? 'network_error' : null
        });
    }

    // Sends the queue in batches; 2xx removes a batch, network/5xx keeps it for the next try,
    // 4xx throws it away (it would be refused again)
    let flushing = null;
    function flush() {
        if (!flushing) flushing = send().catch(() => {}).finally(() => { flushing = null; });
        return flushing;
    }

    async function send() {
        for (const kind of Object.keys(ENDPOINTS)) {
            for (;;) {
                const batch = (await exclusive(readQueue)).filter(item => item.kind === kind).slice(0, BATCH_MAX);
                if (!batch.length) break;
                let status = 0;
                try {
                    const response = await fetch(API + ENDPOINTS[kind], {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ entries: batch.map(item => item.record) })
                    });
                    status = response.status;
                } catch (e) {
                    return; // the server is not running: try again on the next tick
                }
                if (status >= 500 || status < 200 || (status >= 300 && status < 400)) return;
                const sent = new Set(batch.map(item => item.record.clientId));
                await exclusive(async () => {
                    const queue = await readQueue();
                    await chrome.storage.local.set({ [QUEUE_KEY]: queue.filter(item => !sent.has(item.record.clientId)) });
                });
            }
        }
    }

    return { event, request, flush };
})();
