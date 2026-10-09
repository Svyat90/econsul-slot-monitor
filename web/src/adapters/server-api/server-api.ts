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
    items: unknown[];
    delayMs: number;
    timer: TimerHandle | null;
    sending: Promise<void> | null;
};

export function createServerApi(deps: ServerApiDeps = {}): ServerApi & { flush(): Promise<void> } {
    const fetchFn: typeof fetch = deps.fetchFn ?? ((...args) => fetch(...args));
    const scheduler = deps.scheduler ?? timerScheduler;
    const flushMs = deps.flushMs ?? 5000;
    const maxQueued = deps.maxQueued ?? 2000;

    const makeQueue = (path: string): Queue => ({ path, items: [], delayMs: flushMs, timer: null, sending: null });
    const scheduleChanges = makeQueue('/api/schedule-log');
    const requests = makeQueue('/api/request-log');
    const checks = makeQueue('/api/checks');
    const reservations = makeQueue('/api/reservation-log');
    const queues = [scheduleChanges, requests, checks, reservations];

    // true: sent (or dropped for good), keep going; false: keep the batch and retry later
    async function sendBatch(queue: Queue): Promise<boolean> {
        const batch = queue.items.slice(0, BATCH_MAX);
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

    function enqueue(queue: Queue, entries: readonly unknown[]): void {
        try {
            queue.items.push(...entries);
            if (queue.items.length > maxQueued) queue.items.splice(0, queue.items.length - maxQueued);
            if (queue.items.length >= FLUSH_AT) void drain(queue);
            else arm(queue);
        } catch {
            /* never slow or break monitoring */
        }
    }

    return {
        recordScheduleChange: (entry) => enqueue(scheduleChanges, [entry]),
        recordRequest: (entry) => enqueue(requests, [entry]),
        recordCheck: (entry) => enqueue(checks, [entry]),
        recordReservations: (events) => enqueue(reservations, events),
        async flush() {
            await Promise.all(queues.map((queue) => drain(queue)));
        },
    };
}
