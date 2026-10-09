import { describe, expect, it } from 'vitest';
import type { Release } from '@/domain/monitoring/schedule.ts';
import { buildReleasesView, formatCountdown, formatDayLabel, formatGmt } from './releases-view.ts';

// Browser at UTC+3 (+180 min), consulate at GMT-06:00
const base = { browserOffsetMinutes: 180, consulateOffset: '-06:00', slotMinutes: 10 };

// 2026-10-10 07:00 UTC = 10:00 browser = 01:00 consulate... use 09:00 consulate = 15:00 UTC = 18:00 browser
const at = Date.UTC(2026, 9, 10, 15, 0, 0);
const rel = (offsetDays: number, days: Release['days']): Release => ({ at: at + offsetDays * 86400000, opening: '09:00', days });
const first = rel(0, [{ dateKey: '2027-04-02', display: '09:00-12:00' }]);
const second = rel(3, [{ dateKey: '2027-04-05', display: '09:00-12:00' }]);
const third = rel(4, [{ dateKey: '2027-04-06', display: '09:00-12:00' }]);

describe('formatDayLabel', () => {
    it('writes the weekday and DD.MM', () => {
        expect(formatDayLabel('2027-03-31')).toBe('ср, 31.03');
        expect(formatDayLabel('2027-04-04')).toBe('нд, 04.04');
    });
});

describe('formatGmt', () => {
    it('uses a real minus sign', () => {
        expect(formatGmt('-06:00')).toBe('GMT−06:00');
        expect(formatGmt('+02:00')).toBe('GMT+02:00');
    });
});

describe('formatCountdown', () => {
    it('picks the unit', () => {
        expect(formatCountdown(45_000)).toBe('45 с');
        expect(formatCountdown(17 * 3600_000 + 12 * 60_000)).toBe('17 год 12 хв');
        expect(formatCountdown(50 * 3600_000)).toBe('2 д 2 год');
    });
});

describe('buildReleasesView', () => {
    it('returns null for no releases', () => {
        expect(buildReleasesView({ ...base, releases: [], nowMs: at - 3600_000 })).toBeNull();
    });

    it('describes the next opening in browser and consulate time', () => {
        const view = buildReleasesView({ ...base, releases: [first, second, third], nowMs: at - 3600_000 })!;
        expect(view.moment).toBe('сб, 10.10 о 18:00');
        expect(view.consulate).toBe('09:00 за часом консульства (GMT−06:00)');
        expect(view.opens).toBe('пт, 02.04.2027');
        expect(view.slotsText).toBe('18 слотів по 10 хв');
        expect(view.countdown).toBe('через 1 год 00 хв');
        expect(view.fastWindow).toBe('Часті перевірки 17:58–18:03');
        expect(view.active).toBe(false);
        expect(view.later).toEqual(['вт, 13.10 → пн, 05.04', 'ср, 14.10 → вт, 06.04']);
    });

    it('marks the active fast window', () => {
        const view = buildReleasesView({ ...base, releases: [first, second], nowMs: at + 60_000 })!;
        expect(view.active).toBe(true);
        expect(view.countdown).toBe('відкрито');
        expect(view.later).toEqual(['вт, 13.10 → пн, 05.04']);
    });

    it('counts seconds before opening', () => {
        const view = buildReleasesView({ ...base, releases: [first], nowMs: at - 30_000 })!;
        expect(view.countdown).toBe('через 30 с');
        expect(view.active).toBe(true);
    });
});
