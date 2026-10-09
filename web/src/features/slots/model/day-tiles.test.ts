import { describe, expect, it } from 'vitest';
import locationsJson from '../../../../../server/data/locations.json';
import chicago from '@/domain/__fixtures__/econsul/chicago-2026-10-09.json';
import type { ReservedSlot, ScheduleRow } from '@/domain/contracts/econsul.ts';
import { locationsSchema } from '@/domain/contracts/locations.ts';
import { utcOffsetDateKey } from '@/domain/slots/time.ts';
import { buildDayModels, daySummary, dayTitle, draftHint, recentForDay, type DayModelsInput } from './day-tiles.ts';

const locations = locationsSchema.parse(locationsJson);
const institution = locations.institutions.find((i) => i.code === chicago.institutionCode)!;
const rows = chicago.schedule.data.flatMap((entry) => (entry.data ? [entry.data as ScheduleRow] : []));
const reserved = (chicago.reserved?.data.reservedSlots ?? []) as ReservedSlot[];

const input: DayModelsInput = {
    rows,
    reserved,
    serviceCode: chicago.serviceCode,
    institution,
    holidays: locations.holidays,
    nowMs: chicago.recordedAtMs,
    localDateKey: utcOffsetDateKey(-5 * 60),
    browserOffsetMinutes: -300,
};

describe('buildDayModels', () => {
    const models = buildDayModels(input);

    it('has the same free slots as the free-slot calculation', () => {
        const fromTiles = Object.values(models.byDate).flatMap((d) => d.tiles.filter((t) => t.status === 'free').map((t) => `${d.dateKey} ${t.time}`));
        expect(fromTiles.sort()).toEqual([...models.freeKeys].sort());
    });

    it('counts every tile once and describes the day', () => {
        const day = Object.values(models.byDate)[0]!;
        expect(day.free + day.reserved + day.nonWorking).toBe(day.tiles.length);
        expect(daySummary(day)).toMatch(/^Прийом \d\d:\d\d–\d\d:\d\d.* · \d+ вільних · \d+ зайнятих · \d+ неробочих$/);
        expect(models.workingWeekdays.size).toBeGreaterThan(0);
    });

    it('marks a reserved slot as reserved and a non-working one as non-working', () => {
        const hasReserved = Object.values(models.byDate).some((d) => d.reserved > 0);
        expect(hasReserved).toBe(true);
        expect(Object.values(models.byDate).some((d) => d.nonWorkingRanges.length > 0)).toBe(true);
    });
});

describe('recentForDay', () => {
    const at = (h: number, m: number, dayShift = 0) => new Date(2026, 9, 9 + dayShift, h, m).toISOString();
    const nowMs = new Date(2026, 9, 9, 12, 0).getTime();
    it('keeps the events of the day, newest first, in the browser time', () => {
        const events = [
            { kind: 'reserved' as const, slotFrom: '2027-03-31T10:40:00-05:00', previousCheckAt: at(18, 3, -1), detectedAt: at(18, 5, -1) },
            { kind: 'released' as const, slotFrom: '2027-03-31T11:40:00-05:00', previousCheckAt: at(10, 41), detectedAt: at(10, 43) },
            { kind: 'reserved' as const, slotFrom: '2027-03-30T09:00:00-05:00', previousCheckAt: at(10, 41), detectedAt: at(10, 43) },
        ];
        expect(recentForDay(events, '2027-03-31', nowMs)).toEqual([
            { time: '11:40', text: 'звільнено сьогодні між 10:41 і 10:43 — скасування' },
            { time: '10:40', text: 'зарезервовано вчора між 18:03 і 18:05' },
        ]);
    });
});

describe('draftHint', () => {
    const nowMs = new Date(2026, 9, 9, 12, 0).getTime();
    it('says when the draft was made and when the site deletes it', () => {
        const savedAt = new Date(2026, 9, 9, 8, 45).getTime();
        expect(draftHint({ url: 'u', savedAt }, nowMs)).toBe('Чернетка: створено о 08:45 · видалиться завтра о 08:45');
    });
    it('warns about an expired draft and handles none', () => {
        const savedAt = new Date(2026, 9, 7, 8, 45).getTime();
        expect(draftHint({ url: 'u', savedAt }, nowMs)).toContain('уже видалив');
        expect(draftHint(null, nowMs)).toContain('Чернетки немає');
    });
});

describe('dayTitle', () => {
    it('spells the weekday, day, month and year in Ukrainian', () => {
        expect(dayTitle('2027-03-31')).toBe('середа, 31 березня 2027');
    });
});
