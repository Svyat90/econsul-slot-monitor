import { describe, expect, it } from 'vitest';
import type { ScheduleLogEntry } from '../../contracts/schedule-log.ts';
import { scheduleLogClientId } from './client-id.ts';

const entry: ScheduleLogEntry = {
    time: '2026-10-09T10:00:00.000Z',
    institutionCode: 'NYC',
    institution: 'New York',
    type: 'changed',
    previousCheckAt: '2026-10-09T09:00:00.000Z',
    changes: ['added 2026-10-12'],
};

describe('scheduleLogClientId', () => {
    it('returns the same UUID for the same entry, whatever the key order', () => {
        const reordered: ScheduleLogEntry = {
            changes: entry.changes,
            institution: entry.institution,
            type: entry.type,
            time: entry.time,
            institutionCode: entry.institutionCode,
            previousCheckAt: entry.previousCheckAt,
        };
        expect(scheduleLogClientId(entry)).toBe(scheduleLogClientId(reordered));
        expect(scheduleLogClientId(entry)).toBe(scheduleLogClientId({ ...entry }));
    });

    it('returns another UUID when the time differs', () => {
        expect(scheduleLogClientId({ ...entry, time: '2026-10-09T10:00:01.000Z' })).not.toBe(scheduleLogClientId(entry));
    });

    it('has the UUID format', () => {
        expect(scheduleLogClientId(entry)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});
