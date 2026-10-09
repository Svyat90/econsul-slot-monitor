// Display model of the calendar and the day panel. It is built from the same data as the free-slot
// calculation (buildScheduleDays, collectNonWorking, the reserved slots) and tells, for every slot
// of a working day, whether it is free, reserved or inside a non-working interval.
import type { ReservedSlot, ScheduleRow } from '@/domain/contracts/econsul.ts';
import type { Institution, Locations } from '@/domain/contracts/locations.ts';
import type { SlotKey } from '@/domain/monitoring/slots-diff.ts';
import { calculateFreeSlots, collectNonWorking } from '@/domain/slots/free-slots.ts';
import { buildScheduleDays, holidaySet, serviceScheduleRows } from '@/domain/slots/schedule-days.ts';
import {
    consulateOffset,
    minutesToTime,
    parseDateFromISO,
    parseTimeFromISO,
    ukrainianDayMap,
    type DateKey,
} from '@/domain/slots/time.ts';

// The same fallbacks as run-check.ts
const DEFAULT_SLOT_MINUTES = 10;
const DEFAULT_NUMBER_WEEKS = 25;

export type TileStatus = 'free' | 'reserved' | 'nonworking';
export type DayTile = { time: string; status: TileStatus };

export type DayModel = {
    dateKey: DateKey;
    hours: string; // "09:00–12:00", several intervals joined with ", "
    tiles: DayTile[];
    free: number;
    reserved: number;
    nonWorking: number;
    nonWorkingRanges: string[]; // "11:30–12:00"
};

export type DayModels = {
    byDate: Record<DateKey, DayModel>;
    freeKeys: SlotKey[];
    nonWorkingCount: number; // non-working intervals of the schedule, as the summary counts them
    workingWeekdays: ReadonlySet<number>; // weekdays (0 = Sunday) on which the service receives visitors
    holidays: ReadonlySet<DateKey>;
};

export type DayModelsInput = {
    rows: readonly ScheduleRow[];
    reserved: readonly ReservedSlot[];
    serviceCode: string;
    institution: Pick<Institution, 'timeZone' | 'numberWeeks' | 'serviceMinutes'>;
    holidays: Locations['holidays'];
    nowMs: number;
    localDateKey: (ms: number) => DateKey;
    browserOffsetMinutes: number;
};

type Block = { start: number; end: number };

const STATUS_RANK: Record<TileStatus, number> = { free: 0, reserved: 1, nonworking: 2 };

function blocksByConsulDate(items: readonly { consulIpnHash: string; from: string; to: string }[]): Record<string, Block[]> {
    const result: Record<string, Block[]> = {};
    items.forEach(({ consulIpnHash, from, to }) => {
        const key = `${consulIpnHash}|${parseDateFromISO(from)}`;
        (result[key] ??= []).push({ start: parseTimeFromISO(from).totalMinutes, end: parseTimeFromISO(to).totalMinutes });
    });
    return result;
}

export function buildDayModels(input: DayModelsInput): DayModels {
    const { rows, reserved, serviceCode, institution, nowMs } = input;
    const slotMinutes = institution.serviceMinutes[serviceCode] || DEFAULT_SLOT_MINUTES;
    const holidays = holidaySet(input.holidays, serviceCode);
    const nonWorking = collectNonWorking(rows, serviceCode);
    const sampleIsos = [...nonWorking.map((z) => z.from), ...reserved.map((slot) => slot.receptionDateAndTimeFrom)];
    const days = buildScheduleDays(
        {
            rows,
            serviceCode,
            numberWeeks: institution.numberWeeks || DEFAULT_NUMBER_WEEKS,
            offset: consulateOffset(institution.timeZone, sampleIsos, input.browserOffsetMinutes),
            holidays,
            localDateKey: input.localDateKey,
        },
        nowMs,
    );
    const free = calculateFreeSlots({ days, nonWorking, reserved, slotMinutes });
    const reservedBlocks = blocksByConsulDate(
        reserved.map((s) => ({ consulIpnHash: s.consulIpnHash, from: s.receptionDateAndTimeFrom, to: s.receptionDateAndTimeTo })),
    );

    const tilesByDate: Record<DateKey, Map<number, TileStatus>> = {};
    const hoursByDate: Record<DateKey, Set<string>> = {};
    const rangesByDate: Record<DateKey, Set<string>> = {};
    days.forEach((day) => {
        const tiles = (tilesByDate[day.dateKey] ??= new Map());
        (hoursByDate[day.dateKey] ??= new Set()).add(`${minutesToTime(day.startMinutes)}–${minutesToTime(day.endMinutes)}`);
        const reservedHere = reservedBlocks[`${day.consulIpnHash}|${day.dateKey}`] ?? [];
        for (let t = day.startMinutes; t + slotMinutes <= day.endMinutes; t += slotMinutes) {
            const key = `${day.dateKey} ${minutesToTime(t)}`;
            const status: TileStatus = free.slotConsuls[key]?.includes(day.consulIpnHash)
                ? 'free'
                : reservedHere.some((b) => t + slotMinutes > b.start && t < b.end)
                  ? 'reserved'
                  : 'nonworking';
            // a slot several consuls offer is free when any of them has it free
            const prev = tiles.get(t);
            if (prev === undefined || STATUS_RANK[status] < STATUS_RANK[prev]) tiles.set(t, status);
        }
    });
    nonWorking.forEach((z) => {
        const dateKey = parseDateFromISO(z.from);
        if (!days.some((d) => d.dateKey === dateKey && d.consulIpnHash === z.consulIpnHash)) return;
        const from = minutesToTime(parseTimeFromISO(z.from).totalMinutes);
        const to = minutesToTime(parseTimeFromISO(z.to).totalMinutes);
        (rangesByDate[dateKey] ??= new Set()).add(`${from}–${to}`);
    });

    const byDate: Record<DateKey, DayModel> = {};
    Object.entries(tilesByDate).forEach(([dateKey, tiles]) => {
        const sorted = [...tiles.entries()].sort((a, b) => a[0] - b[0]);
        const count = (status: TileStatus) => sorted.filter(([, s]) => s === status).length;
        byDate[dateKey] = {
            dateKey,
            hours: [...(hoursByDate[dateKey] ?? [])].sort().join(', '),
            tiles: sorted.map(([t, status]) => ({ time: minutesToTime(t), status })),
            free: count('free'),
            reserved: count('reserved'),
            nonWorking: count('nonworking'),
            nonWorkingRanges: [...(rangesByDate[dateKey] ?? [])].sort(),
        };
    });

    const workingWeekdays = new Set<number>();
    serviceScheduleRows(rows, serviceCode).forEach((row) =>
        (row.receptionCitizensTime ?? []).forEach((h) => {
            const weekday = ukrainianDayMap[h.workingDays.toLowerCase()];
            if (weekday !== undefined) workingWeekdays.add(weekday);
        }),
    );
    return { byDate, freeKeys: free.keys, nonWorkingCount: nonWorking.length, workingWeekdays, holidays };
}

// "Прийом 09:00–12:00 · 4 вільних · 12 зайнятих · 2 неробочих"
export function daySummary(day: DayModel): string {
    return `Прийом ${day.hours} · ${day.free} вільних · ${day.reserved} зайнятих · ${day.nonWorking} неробочих`;
}

export type RecentReservation = { time: string; text: string };

// "сьогодні", "вчора" or "dd.mm" for a moment, in the browser's time zone
function dayWord(ms: number, nowMs: number): string {
    const startOfDay = (value: number) => new Date(new Date(value).setHours(0, 0, 0, 0)).getTime();
    const days = Math.round((startOfDay(nowMs) - startOfDay(ms)) / 86_400_000);
    if (days === 0) return 'сьогодні';
    if (days === 1) return 'вчора';
    if (days === -1) return 'завтра';
    const date = new Date(ms);
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function clockOf(ms: number): string {
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

type ReservationLike = { kind: 'reserved' | 'released'; slotFrom: string; previousCheckAt: string; detectedAt: string };

// Recent reservation events of one day, newest first: "зарезервовано сьогодні між 10:41 і 10:43"
export function recentForDay(events: readonly ReservationLike[], dateKey: DateKey, nowMs: number): RecentReservation[] {
    return events
        .filter((e) => parseDateFromISO(e.slotFrom) === dateKey)
        .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
        .map((e) => {
            const from = Date.parse(e.previousCheckAt);
            const to = Date.parse(e.detectedAt);
            const verb = e.kind === 'reserved' ? 'зарезервовано' : 'звільнено';
            const tail = e.kind === 'released' ? ' — скасування' : '';
            return {
                time: e.slotFrom.slice(11, 16),
                text: `${verb} ${dayWord(to, nowMs)} між ${clockOf(from)} і ${clockOf(to)}${tail}`,
            };
        });
}

type DraftLike = { url: string; savedAt: number; expiresAt?: number | null };
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function dayAndClock(ms: number, nowMs: number): string {
    const word = dayWord(ms, nowMs);
    return word === 'сьогодні' ? `о ${clockOf(ms)}` : `${word} о ${clockOf(ms)}`;
}

// "Чернетка: створено о 08:45 · видалиться завтра о 08:45"; the site deletes a draft ~24 h after
// it is saved, the extension knows the exact time (expiresAt)
export function draftHint(draft: DraftLike | null, nowMs: number): string {
    if (!draft) return 'Чернетки немає: «Відкрити чернетку» відкриє нову заявку.';
    const deletesAt = draft.expiresAt ?? draft.savedAt + DRAFT_TTL_MS;
    const created = `створено ${dayAndClock(draft.savedAt, nowMs)}`;
    if (nowMs >= deletesAt) return `Чернетка: ${created} · сайт, імовірно, уже видалив її`;
    return `Чернетка: ${created} · видалиться ${dayAndClock(deletesAt, nowMs)}`;
}
