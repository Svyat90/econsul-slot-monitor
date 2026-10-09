import type { ScheduleLogEntry } from '../../contracts/schedule-log.ts';
import type { Db } from '../../db/client.ts';
import { scheduleChanges } from '../../db/schema/index.ts';
import { scheduleLogClientId } from './client-id.ts';

export interface ScheduleLogRepository {
    // Returns how many entries were really inserted (repeats are skipped).
    insertMany(entries: ScheduleLogEntry[]): Promise<number>;
}

export function createScheduleLogRepository(db: Db): ScheduleLogRepository {
    return {
        async insertMany(entries) {
            if (entries.length === 0) return 0;
            const rows = entries.map((entry) => ({
                clientId: scheduleLogClientId(entry),
                checkedAt: new Date(entry.time),
                institutionCode: entry.institutionCode,
                institution: entry.institution,
                type: entry.type,
                previousCheckAt: entry.previousCheckAt ? new Date(entry.previousCheckAt) : null,
                changes: entry.changes,
            }));
            const inserted = await db
                .insert(scheduleChanges)
                .values(rows)
                .onConflictDoNothing({ target: scheduleChanges.clientId })
                .returning({ id: scheduleChanges.id });
            return inserted.length;
        },
    };
}
