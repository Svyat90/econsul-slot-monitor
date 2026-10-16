// ServerApi: fire-and-forget writes to our own server's logs. Never throws, never awaited by
// callers. Each log has a bounded in-memory queue that is sent in batches (contracts' batchOf:
// 1–100 entries) every flushMs, at once at FLUSH_AT entries, and retried later while the server
// or the database is down (503 / network error).
import type { Scheduler, ServerApi, TimerHandle } from '@/application/ports.ts';

const BATCH_MAX = 100; // POST body limit in the contracts
const FLUSH_AT = 20;
const MAX_DELAY_MS = 60_000;

// Adapters are leaves (no imports between them), so the default scheduler is local.
const timerScheduler: Scheduler = {
    setTimeout: (callback, delayMs) => ({ id: globalThis.setTimeout(callback, delayMs) }),
    setInterval: (callback, everyMs) => ({ id: globalThis.setInterval(callback, everyMs) }),
    clear(handle) {
        if (handle) globalThis.clearTimeout(handle.id as ReturnType<typeof setTimeout>);
    },
};

export type ServerApiDeps = {
    fetchFn?: typeof fetch;
    scheduler?: Scheduler;
    flushMs?: number;
    maxQueued?: number;
};

type Queue = {
    path: string;
    batchMax: number; // entries per POST: a calendar snapshot is ~100 KB, the body limit is 1 MB
    maxQueued: number;
    items: unknown[];
    delayMs: number;
    timer: TimerHandle | null;
    sending: Promise<void> | null;
};

export type ServerApiHandle = ServerApi & {
    flush(): Promise<void>;
    // Called after a batch of checks, reservations or schedule changes reached the server: the
    // history GET endpoints now return those entries. Returns the unsubscribe function.
    onSent(listener: () => void): () => void;
};

export function createServerApi(deps: ServerApiDeps = {}): ServerApiHandle {
    const fetchFn: typeof fetch = deps.fetchFn ?? ((...args) => fetch(...args));
    const scheduler = deps.scheduler ?? timerScheduler;
    const flushMs = deps.flushMs ?? 5000;
    const maxQueued = deps.maxQueued ?? 2000;

    const makeQueue = (path: string, options: { batchMax?: number; maxQueued?: number } = {}): Queue => ({
        path,
        batchMax: options.batchMax ?? BATCH_MAX,
        maxQueued: options.maxQueued ?? maxQueued,
        items: [],
        delayMs: flushMs,
        timer: null,
        sending: null,
    });
    const scheduleChanges = makeQueue('/api/schedule-log');
    const requests = makeQueue('/api/request-log');
    const checks = makeQueue('/api/checks');
    const reservations = makeQueue('/api/reservation-log');
    // snapshots are heavy: three per POST, and only the newest few are kept while the server is down
    const calendars = makeQueue('/api/calendar-snapshots', { batchMax: 3, maxQueued: 5 });
    const queues = [scheduleChanges, requests, checks, reservations, calendars];
    const sentListeners = new Set<() => void>();
    // the request log is not shown on the Monitoring page, so its batches do not notify
    const notifying = new Set<Queue>([scheduleChanges, checks, reservations, calendars]);

    function notifySent(queue: Queue): void {
        if (!notifying.has(queue)) return;
        for (const listener of sentListeners) {
            try {
                listener();
            } catch {
                /* a listener never breaks the log queue */
            }
        }
    }

    // true: sent (or dropped for good), keep going; false: keep the batch and retry later
    async function sendBatch(queue: Queue): Promise<boolean> {
        const batch = queue.items.slice(0, queue.batchMax);
        let status: number;
        try {
            const response = await fetchFn(queue.path, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ entries: batch }),
            });
            status = response.status;
        } catch {
            return false; // offline or fetch threw
        }
        if (status >= 500) return false; // 503 while the database is down; other 5xx may be transient too
        if (status >= 400) {
            // the server will never accept this batch: drop it, log no content
            console.warn(`server log ${queue.path}: batch of ${batch.length} rejected (${status}), dropped`);
        }
        queue.items.splice(0, batch.length);
        if (status < 400) notifySent(queue);
        return true;
    }

    function arm(queue: Queue): void {
        if (queue.timer || queue.items.length === 0) return;
        queue.timer = scheduler.setTimeout(() => {
            queue.timer = null;
            void drain(queue);
        }, queue.delayMs);
    }

    function drain(queue: Queue): Promise<void> {
        if (queue.sending) return queue.sending;
        // an empty queue must not run the async body: its `finally` would clear `sending` before
        // the promise is assigned below, leaving a settled promise that blocks every later send
        if (queue.items.length === 0) return Promise.resolve();
        if (queue.timer) {
            scheduler.clear(queue.timer);
            queue.timer = null;
        }
        queue.sending = (async () => {
            try {
                while (queue.items.length > 0) {
                    if (!(await sendBatch(queue))) {
                        queue.delayMs = Math.min(queue.delayMs * 2, MAX_DELAY_MS);
                        return;
                    }
                    queue.delayMs = flushMs;
                }
            } catch {
                /* the server log is best effort */
            } finally {
                queue.sending = null;
                arm(queue);
            }
        })();
        return queue.sending;
    }

    function enqueue(queue: Queue, entries: readonly unknown[], immediately = false): void {
        try {
            queue.items.push(...entries);
            if (queue.items.length > queue.maxQueued) queue.items.splice(0, queue.items.length - queue.maxQueued);
            if (immediately || queue.items.length >= FLUSH_AT) void drain(queue);
            else arm(queue);
        } catch {
            /* never slow or break monitoring */
        }
    }

    return {
        recordScheduleChange: (entry) => enqueue(scheduleChanges, [entry]),
        recordRequest: (entry) => enqueue(requests, [entry]),
        // a check is rare (every few minutes) and the page waits for it: no batching delay
        recordCheck: (entry) => enqueue(checks, [entry], true),
        recordReservations: (events) => enqueue(reservations, events),
        // rare (only when something changed) and the page may read it right away: no batching delay
        recordCalendar: (entry) => enqueue(calendars, [entry], true),
        onSent(listener) {
            sentListeners.add(listener);
            return () => void sentListeners.delete(listener);
        },
        async flush() {
            await Promise.all(queues.map((queue) => drain(queue)));
        },
    };
}
