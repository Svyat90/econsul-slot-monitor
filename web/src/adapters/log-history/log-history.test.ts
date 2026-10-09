import { describe, expect, it, vi } from 'vitest';
import { createLogHistory } from './log-history.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('log history', () => {
    it('GETs a page with the query in the URL and skips undefined values', async () => {
        const page = { entries: [], nextCursor: null };
        const fetchFn = vi.fn(async () => json(page));
        const result = await createLogHistory(fetchFn as never).checks({ onlyNew: true, kind: undefined, limit: 50, before: 7 });
        expect(result).toEqual(page);
        expect(fetchFn).toHaveBeenCalledWith('/api/checks?onlyNew=true&limit=50&before=7');
    });

    it('reads the summary and the other logs from their endpoints', async () => {
        const fetchFn = vi.fn(async () => json({}));
        const history = createLogHistory(fetchFn as never);
        await history.summary({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', institutionCode: 'X' });
        await history.reservations({});
        await history.scheduleChanges({ limit: 10 });
        await history.extensionEvents({ type: 'selection.selected', limit: 5 });
        expect(fetchFn.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
            '/api/summary?from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-02T00%3A00%3A00.000Z&institutionCode=X',
            '/api/reservation-log',
            '/api/schedule-log?limit=10',
            '/api/extension-events?type=selection.selected&limit=5',
        ]);
        expect(history.scheduleLogDownloadUrl()).toBe('/api/schedule-log.jsonl');
    });

    it('throws on an HTTP error, a 503 included', async () => {
        const fetchFn = vi.fn(async () => json({ error: 'Database unavailable' }, 503));
        await expect(createLogHistory(fetchFn as never).summary({ from: 'a', to: 'b' })).rejects.toThrow('503');
    });

    it('throws when the network fails', async () => {
        const fetchFn = vi.fn(async () => { throw new TypeError('offline'); });
        await expect(createLogHistory(fetchFn as never).reservations({})).rejects.toThrow('offline');
    });
});
