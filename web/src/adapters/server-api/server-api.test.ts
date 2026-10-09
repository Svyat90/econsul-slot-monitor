import { describe, expect, it, vi } from 'vitest';
import { createServerApi } from './server-api.ts';

const entry = {
    time: '2026-01-01T00:00:00.000Z',
    institutionCode: 'X',
    institution: 'Consulate',
    type: 'baseline' as const,
    changes: ['first snapshot'],
};

describe('server api', () => {
    it('POSTs the entry to /schedule-log', () => {
        const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
        createServerApi(fetchFn as unknown as typeof fetch).recordScheduleChange(entry);
        expect(fetchFn).toHaveBeenCalledWith('/schedule-log', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(entry),
        });
    });

    it('does not throw when fetch rejects or throws', async () => {
        const rejecting = vi.fn(async () => { throw new Error('offline'); });
        const throwing = vi.fn(() => { throw new Error('sync'); });
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        expect(() => createServerApi(rejecting as unknown as typeof fetch).recordScheduleChange(entry)).not.toThrow();
        expect(() => createServerApi(throwing as unknown as typeof fetch).recordScheduleChange(entry)).not.toThrow();
        await new Promise((r) => setTimeout(r, 10));
        process.off('unhandledRejection', unhandled);
        expect(unhandled).not.toHaveBeenCalled();
    });
});
