import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scheduler, TimerHandle } from '@/application/ports.ts';
import { createServerApi } from './server-api.ts';

const scheduleEntry = {
    time: '2026-01-01T00:00:00.000Z',
    institutionCode: 'X',
    institution: 'Consulate',
    type: 'baseline' as const,
    changes: ['first snapshot'],
};

const requestEntry = (n: number) => ({
    clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    method: 'getSchedule',
}) as never;

type Pending = { callback: () => void; delayMs: number; handle: TimerHandle; cleared: boolean };

function fakeScheduler() {
    const pending: Pending[] = [];
    const scheduler: Scheduler = {
        setTimeout(callback, delayMs) {
            const handle = { id: pending.length };
            pending.push({ callback, delayMs, handle, cleared: false });
            return handle;
        },
        setInterval() {
            throw new Error('not used');
        },
        clear(handle) {
            const found = pending.find((p) => p.handle === handle);
            if (found) found.cleared = true;
        },
    };
    const live = () => pending.filter((p) => !p.cleared);
    return { scheduler, pending, live };
}

const ok = () => new Response(null, { status: 204 });
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as { entries: unknown[] };

afterEach(() => vi.restoreAllMocks());

describe('server api batches', () => {
    it('sends schedule changes as a batch to /api/schedule-log on the flush timer', async () => {
        const fetchFn = vi.fn(async () => ok());
        const { scheduler, live } = fakeScheduler();
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler, flushMs: 5000 });
        api.recordScheduleChange(scheduleEntry);
        expect(fetchFn).not.toHaveBeenCalled();
        expect(live()[0]?.delayMs).toBe(5000);
        live()[0]!.callback();
        await api.flush();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/schedule-log');
        expect(init.method).toBe('POST');
        expect(bodyOf([url, init]).entries).toEqual([scheduleEntry]);
    });

    it('routes each log to its own endpoint', async () => {
        const fetchFn = vi.fn(async () => ok());
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler });
        api.recordRequest(requestEntry(1));
        api.recordCheck({ clientId: 'c' } as never);
        api.recordReservations([{ clientId: 'r1' } as never, { clientId: 'r2' } as never]);
        await api.flush();
        const urls = fetchFn.mock.calls.map((c) => (c as unknown[])[0]).sort();
        expect(urls).toEqual(['/api/checks', '/api/request-log', '/api/reservation-log']);
        const reservation = fetchFn.mock.calls.find((c) => (c as unknown[])[0] === '/api/reservation-log')!;
        expect(bodyOf(reservation as unknown[]).entries).toHaveLength(2);
    });

    it('notifies listeners once a check batch has reached the server, not for the request log', async () => {
        const fetchFn = vi.fn(async () => ok());
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler });
        const sent = vi.fn();
        const off = api.onSent(sent);
        api.recordRequest(requestEntry(1));
        await api.flush();
        expect(sent).not.toHaveBeenCalled();
        api.recordCheck({ clientId: 'c' } as never);
        await api.flush();
        expect(sent).toHaveBeenCalledTimes(1);
        off();
        api.recordCheck({ clientId: 'd' } as never);
        await api.flush();
        expect(sent).toHaveBeenCalledTimes(1);
    });

    it('does not notify while the server is down', async () => {
        const fetchFn = vi.fn(async () => new Response(null, { status: 503 }));
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler });
        const sent = vi.fn();
        api.onSent(sent);
        api.recordCheck({ clientId: 'c' } as never);
        await api.flush();
        expect(sent).not.toHaveBeenCalled();
    });

    it('sends a check at once, without waiting for the flush timer', async () => {
        const fetchFn = vi.fn(async () => ok());
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler });
        api.recordCheck({ clientId: 'c' } as never);
        await Promise.resolve();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('/api/checks');
    });

    it('flushes at once when 20 entries are queued', () => {
        const fetchFn = vi.fn(async () => ok());
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler });
        for (let i = 0; i < 19; i++) api.recordRequest(requestEntry(i));
        expect(fetchFn).not.toHaveBeenCalled();
        api.recordRequest(requestEntry(19));
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(bodyOf(fetchFn.mock.calls[0] as unknown as unknown[]).entries).toHaveLength(20);
    });

    it('splits more than 100 entries into batches of at most 100', async () => {
        const fetchFn = vi.fn(async () => ok());
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler, maxQueued: 500 });
        api.recordReservations(Array.from({ length: 250 }, (_, i) => requestEntry(i)));
        await api.flush();
        const sizes = fetchFn.mock.calls.map((c) => bodyOf(c as unknown as unknown[]).entries.length);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(250);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    });

    it('keeps entries after a 503 and a network error, retrying with a doubled delay', async () => {
        const fetchFn = vi
            .fn<() => Promise<Response>>()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(ok());
        const { scheduler, live } = fakeScheduler();
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler, flushMs: 5000 });
        api.recordReservations([{ clientId: 'c' } as never]);
        live()[0]!.callback();
        await api.flush(); // flush() joins the in-flight send
        expect(live().at(-1)!.delayMs).toBe(10000);
        live().at(-1)!.callback();
        await api.flush();
        expect(live().at(-1)!.delayMs).toBe(20000);
        live().at(-1)!.callback();
        await api.flush();
        expect(fetchFn).toHaveBeenCalledTimes(3);
        expect(bodyOf(fetchFn.mock.calls[2] as unknown as unknown[]).entries).toEqual([{ clientId: 'c' }]);
    });

    it('caps the retry delay at 60 s', async () => {
        const fetchFn = vi.fn(async () => new Response(null, { status: 503 }));
        const { scheduler, live } = fakeScheduler();
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler, flushMs: 5000 });
        api.recordReservations([{ clientId: 'c' } as never]);
        for (let i = 0; i < 6; i++) {
            live().at(-1)!.callback();
            await api.flush();
        }
        expect(live().at(-1)!.delayMs).toBe(60000);
    });

    it('drops the oldest entries over maxQueued', async () => {
        const fetchFn = vi.fn(async () => ok());
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler, maxQueued: 3, flushMs: 5000 });
        // keep the queue from flushing by failing the immediate flush at 20? maxQueued 3 < 20, so none starts
        for (let i = 1; i <= 5; i++) api.recordReservations([{ clientId: String(i) } as never]);
        await api.flush();
        expect(bodyOf(fetchFn.mock.calls[0] as unknown as unknown[]).entries).toEqual([{ clientId: '3' }, { clientId: '4' }, { clientId: '5' }]);
    });

    it('drops a batch the server rejects with 422 and warns without its content', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchFn = vi.fn(async () => new Response('{"error":"bad"}', { status: 422 }));
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler: fakeScheduler().scheduler });
        api.recordCheck({ clientId: 'secret-ish' } as never);
        await api.flush();
        await api.flush();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-ish');
    });

    it('never throws or leaves an unhandled rejection when fetch throws', async () => {
        const throwing = vi.fn(() => { throw new Error('sync'); });
        const api = createServerApi({ fetchFn: throwing as never, scheduler: fakeScheduler().scheduler });
        expect(() => api.recordScheduleChange(scheduleEntry)).not.toThrow();
        await expect(api.flush()).resolves.toBeUndefined();
    });

    it('sends a calendar snapshot at once, three to a POST, and keeps only the newest five while the server is down', async () => {
        const snapshot = (n: number) => ({ clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` }) as never;
        const fetchFn = vi.fn(async () => ok());
        const { scheduler } = fakeScheduler();
        const api = createServerApi({ fetchFn: fetchFn as never, scheduler });
        api.recordCalendar(snapshot(1));
        await api.flush();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe('/api/calendar-snapshots');
        expect(bodyOf(fetchFn.mock.calls[0] as unknown[]).entries).toHaveLength(1);

        const down = vi.fn(async () => new Response(null, { status: 503 }));
        const offline = createServerApi({ fetchFn: down as never, scheduler: fakeScheduler().scheduler });
        for (let n = 1; n <= 8; n++) offline.recordCalendar(snapshot(n));
        await offline.flush(); // the first attempt carried what was queued at that moment
        await offline.flush(); // the retry: the newest five, three to a POST
        const calls = down.mock.calls.map((c) => bodyOf(c as unknown[]).entries as { clientId: string }[]);
        expect(Math.max(...calls.map((entries) => entries.length))).toBe(3); // the batch limit of this log
        const last = calls.at(-1)!;
        // only the newest five (4–8) stay queued: 1–3 were dropped
        expect(last.map((e) => e.clientId.slice(-1))).toEqual(['4', '5', '6']);
    });
});
