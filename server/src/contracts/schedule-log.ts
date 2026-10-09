import { z } from 'zod';

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
