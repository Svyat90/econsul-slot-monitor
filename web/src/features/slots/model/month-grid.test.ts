import { describe, expect, it } from 'vitest';
import type { DayModel, DayModels } from './day-tiles.ts';
import { buildMonthGrid, defaultDay, shiftMonth, summaryText } from './month-grid.ts';

const day = (dateKey: string, free: number, reserved: number, nonWorking: number): DayModel => ({
    dateKey,
    hours: '09:00–12:00',
    tiles: Array.from({ length: free + reserved + nonWorking }, (_, i) => ({ time: `09:${i}`, status: 'free' as const })),
    free,
    reserved,
    nonWorking,
    nonWorkingRanges: [],
});

const models: DayModels = {
    byDate: { '2027-03-30': day('2027-03-30', 3, 6, 1), '2027-03-31': day('2027-03-31', 0, 9, 1) },
    freeKeys: ['2027-03-30 09:00', '2027-03-30 09:10', '2027-03-30 09:20'],
    nonWorkingCount: 300,
    workingWeekdays: new Set([1, 2, 3, 4, 5]),
    holidays: new Set(['2027-04-05']),
};
const range = { from: null, to: '2027-03-30' };

describe('buildMonthGrid', () => {
    const grid = buildMonthGrid({ year: 2027, month: 3, models, today: '2027-03-01', range });
    const cell = (n: number) => grid.cells.find((c) => c.kind !== 'blank' && c.day === n);

    it('starts on Monday and pads to whole weeks', () => {
        expect(grid.title).toBe('Березень 2027');
        expect(grid.cells.length % 7).toBe(0);
        expect(grid.cells[0]).toMatchObject({ day: 1 }); // 1 March 2027 is a Monday
        const april = buildMonthGrid({ year: 2027, month: 4, models, today: '2027-03-01', range });
        expect(april.cells.slice(0, 4).map((c) => c.kind)).toEqual(['blank', 'blank', 'blank', 'future']); // 1 April is a Thursday
    });

    it('shows open days with the free count and bar shares, and dims days out of the range', () => {
        expect(cell(30)).toMatchObject({ kind: 'open', free: 3, reservedPercent: 60, nonWorkingPercent: 10, outOfRange: false });
        expect(cell(31)).toMatchObject({ kind: 'open', free: 0, outOfRange: true });
    });

    it('marks working days past the horizon as future and the rest as closed', () => {
        const april = buildMonthGrid({ year: 2027, month: 4, models, today: '2027-03-01', range });
        const byDay = (n: number) => april.cells.find((c) => c.kind !== 'blank' && c.day === n);
        expect(byDay(1)).toMatchObject({ kind: 'future' });
        expect(byDay(3)).toMatchObject({ kind: 'closed' }); // Saturday
        expect(byDay(5)).toMatchObject({ kind: 'closed' }); // holiday
    });
});

describe('month helpers', () => {
    it('moves across a year boundary', () => {
        expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
        expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
    });
    it('writes the summary line', () => {
        expect(summaryText({ models, range, reservedCount: 1828 })).toBe(
            'Вільних у діапазоні: 3 · поза діапазоном: 0 · зайнятих: 1\u00a0828 · неробочих проміжків: 300 · відкриті дні 30.03.2027–31.03.2027',
        );
    });
    it('picks the first day with free slots in the range', () => {
        expect(defaultDay(models, range)).toBe('2027-03-30');
    });
});
