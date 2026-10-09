import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { monitorChecks, reservationEvents } from '../../db/schema/index.ts';
import { createTestDb } from '../../test/db.ts';
import { createSummaryRepository } from './repository.ts';

const { db, close, truncate } = createTestDb();
const repository = createSummaryRepository(db);

const from = '2026-10-09T00:00:00.000Z';
const to = '2026-10-10T00:00:00.000Z';
const TAB = '11111111-1111-4111-8111-111111111111';
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function check(startedAt: string, over: Partial<typeof monitorChecks.$inferInsert> = {}): typeof monitorChecks.$inferInsert {
    return {
        clientId: uuid(), startedAt: new Date(startedAt), durationMs: 100, kind: 'scheduled', checkSeq: 1,
        institutionCode: 'NYC', serviceCode: 'S', outcome: 'ok', freeCount: 3, newCount: 0,
        tabSessionId: TAB, appVersion: '1.0.0', ...over,
    };
}
function reservation(detectedAt: string, kind: 'reserved' | 'released', institutionCode = 'NYC'): typeof reservationEvents.$inferInsert {
    return {
        clientId: uuid(), kind, institutionCode, consulIpnHash: 'h', slotFrom: new Date(detectedAt), slotTo: new Date(detectedAt),
        previousCheckAt: new Date(detectedAt), detectedAt: new Date(detectedAt), tabSessionId: TAB,
    };
}

beforeEach(() => truncate('monitor_checks', 'reservation_events'));
afterAll(() => close());

describe('SummaryRepository', () => {
    it('returns zeros and null for an empty day', async () => {
        expect(await repository.summary({ from, to })).toEqual({
            checks: { total: 0, fast: 0, failed: 0 },
            newFree: { total: 0, lastAt: null },
            reservations: { reserved: 0, released: 0 },
        });
    });

    it('counts checks, new slots and reservations inside [from, to)', async () => {
        await db.insert(monitorChecks).values([
            check('2026-10-09T08:00:00.000Z'),
            check('2026-10-09T09:00:00.000Z', { kind: 'fast', newCount: 2 }),
            check('2026-10-09T10:00:00.000Z', { kind: 'fast', newCount: 1 }),
            check('2026-10-09T11:00:00.000Z', { outcome: 'unavailable', freeCount: null, newCount: null }),
            check(from, { newCount: 4 }),
            check(to, { newCount: 100 }), // upper bound is exclusive
            check('2026-10-08T23:59:59.000Z', { newCount: 100 }),
        ]);
        await db.insert(reservationEvents).values([
            reservation('2026-10-09T09:00:00.000Z', 'reserved'),
            reservation('2026-10-09T09:30:00.000Z', 'reserved'),
            reservation('2026-10-09T10:00:00.000Z', 'released'),
            reservation(to, 'reserved'),
        ]);
        expect(await repository.summary({ from, to })).toEqual({
            checks: { total: 5, fast: 2, failed: 1 },
            newFree: { total: 7, lastAt: '2026-10-09T10:00:00.000Z' },
            reservations: { reserved: 2, released: 1 },
        });
    });

    it('filters by institutionCode', async () => {
        await db.insert(monitorChecks).values([
            check('2026-10-09T08:00:00.000Z', { newCount: 1 }),
            check('2026-10-09T09:00:00.000Z', { institutionCode: 'LON', newCount: 5 }),
        ]);
        await db.insert(reservationEvents).values([
            reservation('2026-10-09T09:00:00.000Z', 'reserved', 'LON'),
            reservation('2026-10-09T09:00:00.000Z', 'released'),
        ]);
        expect(await repository.summary({ from, to, institutionCode: 'LON' })).toEqual({
            checks: { total: 1, fast: 0, failed: 0 },
            newFree: { total: 5, lastAt: '2026-10-09T09:00:00.000Z' },
            reservations: { reserved: 1, released: 0 },
        });
    });
});
