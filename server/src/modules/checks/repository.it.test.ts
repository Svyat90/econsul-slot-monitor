import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CheckEntry } from '../../contracts/checks.ts';
import { monitorChecks } from '../../db/schema/index.ts';
import { createTestDb } from '../../test/db.ts';
import { createChecksRepository } from './repository.ts';

const { db, close, truncate } = createTestDb();
const repository = createChecksRepository(db);

function check(n: number, patch: Partial<CheckEntry> = {}): CheckEntry {
    return {
        clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        startedAt: `2026-10-09T10:0${n}:00.000Z`,
        durationMs: 100,
        kind: 'scheduled',
        checkSeq: n,
        institutionCode: 'NYC',
        serviceCode: 'SRV',
        outcome: 'ok',
        freeCount: 2,
        newCount: 0,
        outOfRangeCount: 0,
        newSlots: [],
        tabSessionId: '22222222-2222-4222-8222-222222222222',
        appVersion: '0.1.0',
        errorMessage: null,
        ...patch,
    };
}

beforeEach(() => truncate('monitor_checks'));
afterAll(() => close());

describe('ChecksRepository', () => {
    it('inserts a batch and ignores a repeat', async () => {
        expect(await repository.insertMany([check(1), check(2)])).toBe(2);
        expect(await repository.insertMany([check(1), check(2)])).toBe(0);
        expect(await db.select().from(monitorChecks)).toHaveLength(2);
    });

    it('lists newest first with ISO dates and pages by cursor', async () => {
        await repository.insertMany([check(1), check(2), check(3)]);
        const first = await repository.list({ limit: 2 });
        expect(first.entries.map((e) => e.checkSeq)).toEqual([3, 2]);
        expect(first.entries[0]?.startedAt).toBe('2026-10-09T10:03:00.000Z');
        expect(typeof first.entries[0]?.receivedAt).toBe('string');
        expect(first.nextCursor).toBe(first.entries[1]?.id);
        const second = await repository.list({ limit: 2, before: first.nextCursor! });
        expect(second.entries.map((e) => e.checkSeq)).toEqual([1]);
        expect(second.nextCursor).toBeNull();
    });

    it('filters by kind, outcome, institution and time range', async () => {
        await repository.insertMany([
            check(1, { kind: 'fast', institutionCode: 'LON' }),
            check(2, { outcome: 'unavailable', freeCount: null, newCount: null, outOfRangeCount: null, errorMessage: 'HTTP 500' }),
            check(3),
        ]);
        expect((await repository.list({ limit: 10, kind: 'fast' })).entries.map((e) => e.checkSeq)).toEqual([1]);
        expect((await repository.list({ limit: 10, outcome: 'unavailable' })).entries.map((e) => e.checkSeq)).toEqual([2]);
        expect((await repository.list({ limit: 10, institutionCode: 'NYC' })).entries.map((e) => e.checkSeq)).toEqual([3, 2]);
        const ranged = await repository.list({ limit: 10, from: '2026-10-09T10:02:00.000Z', to: '2026-10-09T10:03:00.000Z' });
        expect(ranged.entries.map((e) => e.checkSeq)).toEqual([2]);
    });

    it('onlyNew keeps checks with new_count > 0 and returns their slots', async () => {
        const slots = [{ date: '2026-10-12', time: '10:30', consulIpnHash: 'abc' }];
        await repository.insertMany([check(1), check(2, { newCount: 1, newSlots: slots })]);
        const page = await repository.list({ limit: 10, onlyNew: true });
        expect(page.entries.map((e) => e.checkSeq)).toEqual([2]);
        expect(page.entries[0]?.newSlots).toEqual(slots);
    });
});
