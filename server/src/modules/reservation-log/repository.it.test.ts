import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReservationEvent } from '../../contracts/reservation-log.ts';
import { reservationEvents } from '../../db/schema/index.ts';
import { createTestDb } from '../../test/db.ts';
import { createReservationLogRepository } from './repository.ts';

const { db, close, truncate } = createTestDb();
const repository = createReservationLogRepository(db);

function event(n: number, patch: Partial<ReservationEvent> = {}): ReservationEvent {
    const minute = String(n).padStart(2, '0');
    return {
        clientId: `00000000-0000-4000-8000-0000000000${minute}`,
        kind: 'reserved',
        institutionCode: 'NYC',
        consulIpnHash: 'hash-1',
        slotFrom: '2026-10-12T09:00:00+03:00',
        slotTo: '2026-10-12T09:15:00+03:00',
        previousCheckAt: `2026-10-09T10:${minute}:00.000Z`,
        detectedAt: `2026-10-09T11:${minute}:00.000Z`,
        tabSessionId: '11111111-1111-4111-8111-111111111111',
        ...patch,
    };
}

beforeEach(() => truncate('reservation_events'));
afterAll(() => close());

describe('ReservationLogRepository', () => {
    it('inserts a batch and ignores a repeat; empty batch is 0', async () => {
        expect(await repository.insertMany([event(1), event(2)])).toBe(2);
        expect(await repository.insertMany([event(1), event(2)])).toBe(0);
        expect(await repository.insertMany([])).toBe(0);
        expect(await db.select().from(reservationEvents)).toHaveLength(2);
    });

    it('lists newest first with ISO dates and no cursor on a short page', async () => {
        await repository.insertMany([event(1), event(2)]);
        const page = await repository.list({ limit: 100 });
        expect(page.entries.map((e) => e.clientId)).toEqual([event(2).clientId, event(1).clientId]);
        expect(page.entries[0]?.detectedAt).toBe('2026-10-09T11:02:00.000Z');
        expect(page.entries[0]?.slotFrom).toBe('2026-10-12T06:00:00.000Z');
        expect(typeof page.entries[0]?.receivedAt).toBe('string');
        expect(page.nextCursor).toBeNull();
    });

    it('pages by cursor: full page gives the smallest id, before continues', async () => {
        await repository.insertMany([event(1), event(2), event(3)]);
        const first = await repository.list({ limit: 2 });
        expect(first.entries).toHaveLength(2);
        expect(first.nextCursor).toBe(first.entries[1]?.id);
        const second = await repository.list({ limit: 2, before: first.nextCursor ?? undefined });
        expect(second.entries.map((e) => e.clientId)).toEqual([event(1).clientId]);
        expect(second.nextCursor).toBeNull();
    });

    it('filters by kind, institution and detectedAt range [from, to)', async () => {
        await repository.insertMany([
            event(1),
            event(2, { kind: 'released' }),
            event(3, { institutionCode: 'LAX' }),
        ]);
        expect((await repository.list({ limit: 100, kind: 'released' })).entries).toHaveLength(1);
        expect((await repository.list({ limit: 100, institutionCode: 'LAX' })).entries).toHaveLength(1);
        const ranged = await repository.list({
            limit: 100,
            from: '2026-10-09T11:02:00.000Z',
            to: '2026-10-09T11:03:00.000Z',
        });
        expect(ranged.entries.map((e) => e.clientId)).toEqual([event(2).clientId]);
    });
});
