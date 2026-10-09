import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ScheduleLogEntry } from '../../contracts/schedule-log.ts';
import { scheduleChanges } from '../../db/schema/index.ts';
import { createTestDb } from '../../test/db.ts';
import { createScheduleLogRepository } from './repository.ts';

const { db, close, truncate } = createTestDb();
const repository = createScheduleLogRepository(db);

const baseline: ScheduleLogEntry = {
    time: '2026-10-09T09:00:00.000Z',
    institutionCode: 'NYC',
    institution: 'New York',
    type: 'baseline',
    changes: [],
};
const changed: ScheduleLogEntry = {
    time: '2026-10-09T10:00:00.000Z',
    institutionCode: 'NYC',
    institution: 'New York',
    type: 'changed',
    previousCheckAt: '2026-10-09T09:00:00.000Z',
    changes: ['added 2026-10-12'],
};

beforeEach(() => truncate('schedule_changes'));
afterAll(() => close());

describe('ScheduleLogRepository', () => {
    it('inserts a batch and ignores a repeat of the same entries', async () => {
        expect(await repository.insertMany([baseline, changed])).toBe(2);
        expect(await repository.insertMany([baseline, changed])).toBe(0);
        expect(await db.select().from(scheduleChanges)).toHaveLength(2);
    });

    it('stores previousCheckAt of a changed entry and null for a baseline', async () => {
        await repository.insertMany([baseline, changed]);
        const rows = await db.select().from(scheduleChanges).orderBy(scheduleChanges.id);
        expect(rows[0]?.previousCheckAt).toBeNull();
        expect(rows[1]?.previousCheckAt?.toISOString()).toBe(changed.previousCheckAt);
        expect(rows[1]?.checkedAt.toISOString()).toBe(changed.time);
        expect(rows[1]?.changes).toEqual(changed.changes);
    });

    it('returns 0 for an empty batch', async () => {
        expect(await repository.insertMany([])).toBe(0);
    });

    describe('list', () => {
        const entries: ScheduleLogEntry[] = [0, 1, 2, 3].map((i) => ({
            time: `2026-10-09T1${i}:00:00.000Z`,
            institutionCode: i % 2 === 0 ? 'NYC' : 'CHI',
            institution: i % 2 === 0 ? 'New York' : 'Chicago',
            type: 'changed',
            previousCheckAt: `2026-10-09T0${i}:00:00.000Z`,
            changes: [`change ${i}`],
        }));

        it('returns newest first as ISO strings with a cursor when the page is full', async () => {
            await repository.insertMany(entries);
            const page = await repository.list({ limit: 2 });
            expect(page.entries.map((e) => e.changes[0])).toEqual(['change 3', 'change 2']);
            expect(page.entries[0]?.time).toBe(entries[3]?.time);
            expect(page.entries[0]?.previousCheckAt).toBe(entries[3]?.previousCheckAt);
            expect(typeof page.entries[0]?.receivedAt).toBe('string');
            expect(page.nextCursor).toBe(page.entries[1]?.id);
        });

        it('continues after the cursor and ends with a null cursor', async () => {
            await repository.insertMany(entries);
            const first = await repository.list({ limit: 3 });
            const rest = await repository.list({ limit: 3, before: first.nextCursor! });
            expect(rest.entries.map((e) => e.changes[0])).toEqual(['change 0']);
            expect(rest.nextCursor).toBeNull();
        });

        it('filters by institution and time range [from, to)', async () => {
            await repository.insertMany(entries);
            const byInstitution = await repository.list({ limit: 10, institutionCode: 'CHI' });
            expect(byInstitution.entries.map((e) => e.changes[0])).toEqual(['change 3', 'change 1']);
            const byTime = await repository.list({ limit: 10, from: entries[1]!.time, to: entries[3]!.time });
            expect(byTime.entries.map((e) => e.changes[0])).toEqual(['change 2', 'change 1']);
        });

        it('omits previousCheckAt for a baseline', async () => {
            await repository.insertMany([baseline]);
            const page = await repository.list({ limit: 10 });
            expect(page.entries[0]).not.toHaveProperty('previousCheckAt');
        });
    });

    it('listAll returns entries oldest first in the JSONL shape', async () => {
        await repository.insertMany([changed, baseline]);
        expect(await repository.listAll()).toEqual([baseline, changed]);
    });
});
