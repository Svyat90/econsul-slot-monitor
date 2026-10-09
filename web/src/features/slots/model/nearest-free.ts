// What the «Найближчі вільні» card shows: the first days with free slots inside the date range.
import { inDateRange, type DateRange, type SlotKey } from '@/domain/monitoring/slots-diff.ts';
import { formatDayLabel } from './releases-view.ts';

export const NEAREST_DAYS = 4;

export type NearestFreeRow = { dateKey: string; label: string; times: string[] };
export type NearestFreeView = { rows: NearestFreeRow[]; rangeLabel: string };

const ddmm = (dateKey: string): string => `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}`;

function rangeLabel(range: DateRange): string {
    if (range.from && range.to) return `у діапазоні ${ddmm(range.from)}–${ddmm(range.to)}`;
    if (range.from) return `від ${ddmm(range.from)}`;
    if (range.to) return `до ${ddmm(range.to)}`;
    return '';
}

export function buildNearestFree(freeKeys: readonly SlotKey[], range: DateRange): NearestFreeView {
    const byDay = new Map<string, string[]>();
    [...freeKeys]
        .filter((key) => inDateRange(key, range))
        .sort()
        .forEach((key) => {
            const dateKey = key.slice(0, 10);
            byDay.set(dateKey, [...(byDay.get(dateKey) ?? []), key.slice(11, 16)]);
        });
    const rows = [...byDay]
        .slice(0, NEAREST_DAYS)
        .map(([dateKey, times]) => ({ dateKey, label: formatDayLabel(dateKey), times }));
    return { rows, rangeLabel: rangeLabel(range) };
}
