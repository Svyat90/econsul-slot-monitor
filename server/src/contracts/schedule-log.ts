import { z } from 'zod';
import { batchOf, historyQuerySchema, pageOf, storedFields } from './common.ts';

// One line of the old logs/schedule-changes.jsonl; strict so a stray key (e.g. `token`) is rejected.
export const scheduleLogEntrySchema = z.object({
    time: z.iso.datetime({ offset: true }),
    institutionCode: z.string().min(1),
    institution: z.string().min(1),
    type: z.enum(['baseline', 'changed']),
    previousCheckAt: z.iso.datetime({ offset: true }).optional(),
    changes: z.array(z.string()),
}).strict();

export type ScheduleLogEntry = z.infer<typeof scheduleLogEntrySchema>;

// POST /api/schedule-log: a batch of the same entries (client_id is derived from the entry itself).
export const scheduleLogBatchSchema = batchOf(scheduleLogEntrySchema);
export const scheduleLogQuerySchema = historyQuerySchema;
export const storedScheduleLogEntrySchema = z.object({ ...storedFields }).extend(scheduleLogEntrySchema.shape);
export const scheduleLogPageSchema = pageOf(storedScheduleLogEntrySchema);

export type StoredScheduleLogEntry = z.infer<typeof storedScheduleLogEntrySchema>;
