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
});
