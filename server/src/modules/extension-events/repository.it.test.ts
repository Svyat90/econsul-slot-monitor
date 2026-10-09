import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExtensionEvent } from '../../contracts/extension-events.ts';
import { extensionEvents } from '../../db/schema/index.ts';
import { createTestDb } from '../../test/db.ts';
import { createExtensionEventsRepository } from './repository.ts';

const { db, close, truncate } = createTestDb();
const repository = createExtensionEventsRepository(db);

function event(n: number, patch: Partial<ExtensionEvent> = {}): ExtensionEvent {
    return {
        clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        occurredAt: `2026-10-09T10:0${n}:00.000Z`,
        type: 'selection.started',
        jobId: null,
        payload: { n },
        extensionVersion: '0.4.0',
        test: false,
        ...patch,
    };
}

beforeEach(() => truncate('extension_events'));
afterAll(() => close());

describe('ExtensionEventsRepository', () => {
    it('inserts a batch and ignores a repeat', async () => {
        expect(await repository.insertMany([event(1), event(2)])).toBe(2);
        expect(await repository.insertMany([event(1), event(2)])).toBe(0);
        expect(await db.select().from(extensionEvents)).toHaveLength(2);
    });

    it('lists newest first with ISO dates and pages by cursor', async () => {
        await repository.insertMany([event(1), event(2), event(3)]);
        const first = await repository.list({ limit: 2 });
        expect(first.entries.map((e) => e.payload)).toEqual([{ n: 3 }, { n: 2 }]);
        expect(first.entries[0]?.occurredAt).toBe('2026-10-09T10:03:00.000Z');
        expect(typeof first.entries[0]?.receivedAt).toBe('string');
        expect(first.nextCursor).toBe(first.entries[1]?.id);
        const second = await repository.list({ limit: 2, before: first.nextCursor! });
        expect(second.entries.map((e) => e.payload)).toEqual([{ n: 1 }]);
        expect(second.nextCursor).toBeNull();
    });

    it('filters by type, jobId and the [from, to) range', async () => {
        await repository.insertMany([
            event(1, { type: 'selection.selected', jobId: 'job-a' }),
            event(2, { type: 'booking.booked', jobId: 'job-b' }),
            event(3, { jobId: 'job-a' }),
        ]);
        const ns = async (q: Parameters<typeof repository.list>[0]) => (await repository.list(q)).entries.map((e) => e.payload.n);
        expect(await ns({ limit: 10, type: 'booking.booked' })).toEqual([2]);
        expect(await ns({ limit: 10, jobId: 'job-a' })).toEqual([3, 1]);
        expect(await ns({ limit: 10, from: '2026-10-09T10:02:00.000Z', to: '2026-10-09T10:03:00.000Z' })).toEqual([2]);
    });
});
