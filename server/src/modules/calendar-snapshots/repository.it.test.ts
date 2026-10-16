import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarSnapshot } from '../../contracts/calendar-snapshots.ts';
import { monitorChecks } from '../../db/schema/index.ts';
import { createTestDb } from '../../test/db.ts';
import { createCalendarSnapshotRepository } from './repository.ts';

const { db, close, truncate } = createTestDb();
const repository = createCalendarSnapshotRepository(db);

function snapshot(n: number, patch: Partial<CalendarSnapshot> = {}): CalendarSnapshot {
    return {
        clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        observedAt: `2026-10-16T10:0${n}:00.000Z`,
        institutionCode: 'CHI',
        serviceCode: '1',
        scheduleHash: 's1',
        reservedHash: `r${n}`,
        schedule: [{ consulIpnHash: 'h1' }],
        reserved: { consuls: ['h1'], slots: Array.from({ length: n }, (_, i) => [0, `2026-10-19T09:${String(i * 10).padStart(2, '0')}:00.00-05:00`, `2026-10-19T09:${String(i * 10 + 10).padStart(2, '0')}:00.00-05:00`] as [number, string, string]) },
        appVersion: '0.1.0',
        ...patch,
    };
}

beforeEach(() => truncate('calendar_snapshots', 'monitor_checks'));
afterAll(() => close());

describe('calendar snapshot repository', () => {
    it('stores a snapshot and gives it back as the latest of its scope, with the compact payload intact', async () => {
        expect(await repository.insertMany([snapshot(2)])).toBe(1);
        const { snapshot: latest } = await repository.latest({ institutionCode: 'CHI', serviceCode: '1' });
        expect(latest).toMatchObject({ institutionCode: 'CHI', scheduleHash: 's1', reservedHash: 'r2', schedule: [{ consulIpnHash: 'h1' }] });
        expect(latest?.reserved.slots).toHaveLength(2);
        expect(latest?.observedAt).toBe('2026-10-16T10:02:00.000Z');
    });

    it('skips a repeat of the newest snapshot (same hashes) and the same client id, but stores a change', async () => {
        await repository.insertMany([snapshot(1)]);
        expect(await repository.insertMany([snapshot(2, { reservedHash: 'r1' })])).toBe(0); // same hashes as the newest
        expect(await repository.insertMany([snapshot(1)])).toBe(0); // same client id
        expect(await repository.insertMany([snapshot(3)])).toBe(1); // reserved changed
        expect(await repository.insertMany([snapshot(4, { reservedHash: 'r1' })])).toBe(1); // back to an older state is a change too
        const page = await repository.list({ limit: 10 });
        expect(page.entries.map((e) => e.reservedHash)).toEqual(['r1', 'r3', 'r1']);
    });

    it('compares inside one batch and per scope', async () => {
        const inserted = await repository.insertMany([snapshot(1), snapshot(2, { reservedHash: 'r1' }), snapshot(3, { serviceCode: '2', reservedHash: 'r1' })]);
        expect(inserted).toBe(2); // the second repeats the first; another service has its own history
        expect((await repository.latest({ institutionCode: 'CHI', serviceCode: '2' })).snapshot?.serviceCode).toBe('2');
        expect((await repository.latest({ institutionCode: 'NYC', serviceCode: '1' })).snapshot).toBeNull();
    });

    it('latest carries the time of the newest successful check of the scope', async () => {
        await repository.insertMany([snapshot(1)]);
        const check = (n: number, outcome: 'ok' | 'unavailable', serviceCode = '1') => ({
            clientId: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            startedAt: new Date(`2026-10-16T11:0${n}:00.000Z`),
            durationMs: 100, kind: 'scheduled' as const, checkSeq: n, institutionCode: 'CHI', serviceCode, outcome,
            freeCount: outcome === 'ok' ? 1 : null, tabSessionId: '22222222-2222-4222-8222-222222222222', appVersion: '0.1.0',
        });
        await db.insert(monitorChecks).values([check(1, 'ok'), check(2, 'unavailable'), check(3, 'ok', '2')]);
        expect((await repository.latest({ institutionCode: 'CHI', serviceCode: '1' })).lastCheckAt).toBe('2026-10-16T11:01:00.000Z');
        expect((await repository.latest({ institutionCode: 'CHI', serviceCode: '9' })).lastCheckAt).toBeNull();
    });

    it('list: newest first, counts the reserved slots, filters by scope, pages by cursor', async () => {
        await repository.insertMany([snapshot(1), snapshot(2), snapshot(3), snapshot(4, { serviceCode: '2' })]);
        const page = await repository.list({ institutionCode: 'CHI', serviceCode: '1', limit: 2 });
        expect(page.entries.map((e) => [e.reservedHash, e.reservedCount])).toEqual([['r3', 3], ['r2', 2]]);
        expect(page.nextCursor).toBe(page.entries.at(-1)?.id);
        const next = await repository.list({ institutionCode: 'CHI', serviceCode: '1', limit: 2, before: page.nextCursor ?? undefined });
        expect(next.entries.map((e) => e.reservedHash)).toEqual(['r1']);
        expect(next.nextCursor).toBeNull();
    });
});
