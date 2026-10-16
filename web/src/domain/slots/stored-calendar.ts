// The calendar the server saved (GET /api/calendar-snapshots/latest) in the shape the Slots page
// draws from: schedule rows and reserved slots, with the times it is as fresh as.
import type { CalendarLatest } from '@contracts/calendar-snapshots.ts';
import { z } from 'zod';
import { scheduleRowSchema, type ReservedSlot, type ScheduleRow } from '../contracts/econsul.ts';
import { expandReserved } from './calendar-snapshot.ts';

export type StoredCalendar = {
    rows: ScheduleRow[];
    reserved: ReservedSlot[];
    observedAt: number; // when this state was first seen
    checkedAt: number; // the newest successful check of the institution and service (>= observedAt)
};

const rowsSchema = z.array(scheduleRowSchema);

// null: nothing saved yet, or saved rows that no longer look like a schedule (the page then asks to run the monitor)
export function storedCalendarOf(latest: CalendarLatest): StoredCalendar | null {
    const { snapshot, lastCheckAt } = latest;
    if (!snapshot) return null;
    const rows = rowsSchema.safeParse(snapshot.schedule);
    if (!rows.success) return null;
    const observedAt = Date.parse(snapshot.observedAt);
    const checked = lastCheckAt ? Date.parse(lastCheckAt) : observedAt;
    return {
        rows: rows.data,
        reserved: expandReserved(snapshot.reserved),
        observedAt,
        checkedAt: Math.max(observedAt, Number.isNaN(checked) ? observedAt : checked),
    };
}
