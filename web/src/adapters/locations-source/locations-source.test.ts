import { describe, expect, it, vi } from 'vitest';
import { createLocationsSource } from './locations-source.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('locations source', () => {
    it('GETs /api/locations and parses it', async () => {
        const raw = {
            holidays: { all: ['2026-01-01'], byService: {} },
            services: { '1': 'Service' },
            institutions: [{ code: 'X', name: 'Consulate', countryCode: 'PL', country: 'Poland', timeZone: 'GMT+01:00', numberWeeks: 4, serviceMinutes: { '1': 20 } }],
        };
        const fetchFn = vi.fn(async () => json(raw));
        const locations = await createLocationsSource(fetchFn as unknown as typeof fetch).load();
        expect(fetchFn).toHaveBeenCalledWith('/api/locations');
        expect(locations.institutions[0]?.code).toBe('X');
    });

    it('rejects on HTTP error and on a wrong shape', async () => {
        await expect(createLocationsSource((async () => json({}, 500)) as unknown as typeof fetch).load()).rejects.toThrow();
        await expect(createLocationsSource((async () => json({ nope: 1 })) as unknown as typeof fetch).load()).rejects.toThrow();
    });
});
