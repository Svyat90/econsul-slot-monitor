// The month calendar (Monday first) and the summary line under it, from the day models.
import { inDateRange, type DateRange } from '@/domain/monitoring/slots-diff.ts';
import { dayOfWeek, type DateKey } from '@/domain/slots/time.ts';
import type { DayModels } from './day-tiles.ts';

export type MonthCell =
    | { kind: 'blank' }
    | { kind: 'closed'; dateKey: DateKey; day: number } // no reception: weekend, holiday, past
    | { kind: 'future'; dateKey: DateKey; day: number } // a working day beyond the booking horizon
    | {
          kind: 'open';
          dateKey: DateKey;
          day: number;
          free: number;
          reservedPercent: number;
          nonWorkingPercent: number;
          outOfRange: boolean;
      };

export type MonthGrid = { title: string; cells: MonthCell[] };

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

const pad = (n: number) => String(n).padStart(2, '0');

// month: 1-12
export function buildMonthGrid(input: { year: number; month: number; models: DayModels; today: DateKey; range: DateRange }): MonthGrid {
    const { year, month, models, today, range } = input;
    const first = `${year}-${pad(month)}-01`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const horizon = Object.keys(models.byDate).sort().at(-1) ?? null;
    const cells: MonthCell[] = Array.from({ length: (dayOfWeek(first) + 6) % 7 }, () => ({ kind: 'blank' }));
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${pad(month)}-${pad(day)}`;
        const model = models.byDate[dateKey];
        if (model) {
            const total = model.tiles.length || 1;
            cells.push({
                kind: 'open',
                dateKey,
                day,
                free: model.free,
                reservedPercent: Math.round((model.reserved / total) * 100),
                nonWorkingPercent: Math.round((model.nonWorking / total) * 100),
                outOfRange: !inDateRange(dateKey, range),
            });
        } else if (horizon && dateKey > horizon && dateKey > today && models.workingWeekdays.has(dayOfWeek(dateKey)) && !models.holidays.has(dateKey)) {
            cells.push({ kind: 'future', dateKey, day });
        } else {
            cells.push({ kind: 'closed', dateKey, day });
        }
    }
    while (cells.length % 7) cells.push({ kind: 'blank' });
    return { title: `${MONTHS[month - 1]} ${year}`, cells };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const index = year * 12 + (month - 1) + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const dotted = (dateKey: DateKey) => `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}.${dateKey.slice(0, 4)}`;
const number = (n: number) => n.toLocaleString('uk-UA');

// "Вільних у діапазоні: 18 · поза діапазоном: 1 · зайнятих: 1 828 · неробочих проміжків: 300 · відкриті дні 10.10.2026–01.04.2027"
export function summaryText(input: { models: DayModels; range: DateRange; reservedCount: number }): string {
    const { models, range, reservedCount } = input;
    const inRange = models.freeKeys.filter((key) => inDateRange(key, range)).length;
    const parts = [
        `Вільних у діапазоні: ${inRange}`,
        `поза діапазоном: ${models.freeKeys.length - inRange}`,
        `зайнятих: ${number(reservedCount)}`,
        `неробочих проміжків: ${number(models.nonWorkingCount)}`,
    ];
    const keys = Object.keys(models.byDate).sort();
    const open = keys.length ? ` · відкриті дні ${dotted(keys[0] ?? '')}–${dotted(keys.at(-1) ?? '')}` : '';
    return parts.join(' · ') + open;
}

// The first day with free slots in the range, otherwise the first open day
export function defaultDay(models: DayModels, range: DateRange): DateKey | null {
    const keys = Object.keys(models.byDate).sort();
    return keys.find((k) => (models.byDate[k]?.free ?? 0) > 0 && inDateRange(k, range)) ?? keys[0] ?? null;
}
