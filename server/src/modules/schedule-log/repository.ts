import { and, asc, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { HistoryQuery } from '../../contracts/common.ts';
import type { ScheduleLogEntry, scheduleLogPageSchema } from '../../contracts/schedule-log.ts';
import type { Db } from '../../db/client.ts';
import { scheduleChanges } from '../../db/schema/index.ts';
import { scheduleLogClientId } from './client-id.ts';

export type ScheduleLogPage = z.infer<typeof scheduleLogPageSchema>;

export interface ScheduleLogRepository {
    // Returns how many entries were really inserted (repeats are skipped).
    insertMany(entries: ScheduleLogEntry[]): Promise<number>;
    // Newest first; `nextCursor` is the smallest id of a full page, else null.
    list(query: HistoryQuery): Promise<ScheduleLogPage>;
    // Every entry, oldest first, in the shape of a line of the old schedule-changes.jsonl.
    listAll(): Promise<ScheduleLogEntry[]>;
}

type ScheduleRow = typeof scheduleChanges.$inferSelect;

function toEntry(row: ScheduleRow): ScheduleLogEntry {
    return {
        time: row.checkedAt.toISOString(),
        institutionCode: row.institutionCode,
        institution: row.institution,
        type: row.type,
        ...(row.previousCheckAt ? { previousCheckAt: row.previousCheckAt.toISOString() } : {}),
        changes: row.changes,
    };
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

        async list(query) {
            const conditions: SQL[] = [];
            if (query.institutionCode) conditions.push(eq(scheduleChanges.institutionCode, query.institutionCode));
            if (query.from) conditions.push(gte(scheduleChanges.checkedAt, new Date(query.from)));
            if (query.to) conditions.push(lt(scheduleChanges.checkedAt, new Date(query.to)));
            if (query.before !== undefined) conditions.push(lt(scheduleChanges.id, query.before));
            const rows = await db
                .select()
                .from(scheduleChanges)
                .where(and(...conditions))
                .orderBy(desc(scheduleChanges.id))
                .limit(query.limit);
            const entries = rows.map((row) => ({
                ...toEntry(row),
                id: row.id,
                receivedAt: row.receivedAt.toISOString(),
            }));
            const last = entries.at(-1);
            return { entries, nextCursor: entries.length === query.limit && last ? last.id : null };
        },

        async listAll() {
            const rows = await db.select().from(scheduleChanges).orderBy(asc(scheduleChanges.checkedAt), asc(scheduleChanges.id));
            return rows.map(toEntry);
        },
    };
}
