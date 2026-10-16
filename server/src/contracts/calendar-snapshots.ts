import { z } from 'zod';
import { batchOf, historyQuerySchema, isoDateTime, pageOf, storedFields } from './common.ts';

// A snapshot of what the Slots page draws: the schedule of an institution and the reserved
// slots of one service, as the app saw them. The app sends one only when something changed since
// the last one it sent; the server also skips an exact repeat of the newest snapshot. With the
// snapshots the page shows the last known calendar without the monitor running.
//
// `schedule` are the rows of GET /schedule as the site returns them (consul hashes, working
// hours, services: nothing personal); the app checks their shape when it reads them back.
// `reserved` is compact: slots point into `consuls`, so a hash is written once.
const SECRET_KEY = /token|authorization|cookie|password|jwt/i;

export const reservedSnapshotSchema = z.object({
    consuls: z.array(z.string().min(1).max(100)).max(100),
    slots: z.array(z.tuple([z.number().int().min(0).max(99), z.string().min(1).max(40), z.string().min(1).max(40)])).max(20_000),
}).strict();

export const calendarSnapshotSchema = z.object({
    clientId: z.uuid(),
    observedAt: isoDateTime,
    institutionCode: z.string().min(1).max(50),
    serviceCode: z.string().min(1).max(50),
    scheduleHash: z.string().min(1).max(64),
    reservedHash: z.string().min(1).max(64),
    schedule: z.array(z.record(z.string(), z.unknown()).refine((row) => !Object.keys(row).some((k) => SECRET_KEY.test(k)), { message: 'row key looks like a secret' })).max(200),
    reserved: reservedSnapshotSchema,
    appVersion: z.string().min(1).max(20),
}).strict();

export const calendarSnapshotBatchSchema = batchOf(calendarSnapshotSchema);

export const storedCalendarSnapshotSchema = z.object({ ...storedFields }).extend(calendarSnapshotSchema.shape);

// GET /api/calendar-snapshots/latest?institutionCode&serviceCode
export const calendarLatestQuerySchema = z.object({
    institutionCode: z.string().min(1),
    serviceCode: z.string().min(1),
}).strict();
export const calendarLatestSchema = z.object({
    snapshot: storedCalendarSnapshotSchema.nullable(),
    // the newest successful check of this institution and service: the snapshot is as fresh as this
    lastCheckAt: isoDateTime.nullable(),
});

// GET /api/calendar-snapshots: the history without the payload
export const calendarSnapshotListItemSchema = z.object({
    ...storedFields,
    observedAt: isoDateTime,
    institutionCode: z.string(),
    serviceCode: z.string(),
    scheduleHash: z.string(),
    reservedHash: z.string(),
    reservedCount: z.number().int().nonnegative(),
});
export const calendarSnapshotQuerySchema = historyQuerySchema.extend({ serviceCode: z.string().min(1).optional() }).strict();
export const calendarSnapshotPageSchema = pageOf(calendarSnapshotListItemSchema);

export type CalendarSnapshot = z.infer<typeof calendarSnapshotSchema>;
export type StoredCalendarSnapshot = z.infer<typeof storedCalendarSnapshotSchema>;
export type CalendarLatest = z.infer<typeof calendarLatestSchema>;
export type CalendarSnapshotListItem = z.infer<typeof calendarSnapshotListItemSchema>;
export type CalendarSnapshotQuery = z.infer<typeof calendarSnapshotQuerySchema>;
