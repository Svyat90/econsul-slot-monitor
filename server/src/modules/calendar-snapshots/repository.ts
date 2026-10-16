import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type {
    CalendarLatest,
    CalendarSnapshot,
    CalendarSnapshotListItem,
    CalendarSnapshotQuery,
} from '../../contracts/calendar-snapshots.ts';
import type { Db } from '../../db/client.ts';
import { calendarSnapshots, monitorChecks } from '../../db/schema/index.ts';

export interface CalendarSnapshotRepository {
    // Returns how many snapshots were really inserted: repeats (same client id, or the same
    // hashes as the newest snapshot of that institution and service) are skipped.
    insertMany(entries: CalendarSnapshot[]): Promise<number>;
    // The newest snapshot of the scope with the time of the newest successful check.
    latest(scope: { institutionCode: string; serviceCode: string }): Promise<CalendarLatest>;
    // Newest first, without the payload; `observedAt` in [from, to).
    list(query: CalendarSnapshotQuery): Promise<{ entries: CalendarSnapshotListItem[]; nextCursor: number | null }>;
}

export function createCalendarSnapshotRepository(db: Db): CalendarSnapshotRepository {
    return {
        async insertMany(entries) {
            let inserted = 0;
            // One by one: a batch may hold several snapshots of one scope, each compared with the previous
            for (const entry of entries) {
                const [newest] = await db
                    .select({ scheduleHash: calendarSnapshots.scheduleHash, reservedHash: calendarSnapshots.reservedHash })
                    .from(calendarSnapshots)
                    .where(and(eq(calendarSnapshots.institutionCode, entry.institutionCode), eq(calendarSnapshots.serviceCode, entry.serviceCode)))
                    .orderBy(desc(calendarSnapshots.id))
                    .limit(1);
                if (newest && newest.scheduleHash === entry.scheduleHash && newest.reservedHash === entry.reservedHash) continue;
                const rows = await db
                    .insert(calendarSnapshots)
                    .values({
                        clientId: entry.clientId,
                        observedAt: new Date(entry.observedAt),
                        institutionCode: entry.institutionCode,
                        serviceCode: entry.serviceCode,
                        scheduleHash: entry.scheduleHash,
                        reservedHash: entry.reservedHash,
                        schedule: entry.schedule,
                        reserved: entry.reserved,
                        appVersion: entry.appVersion,
                    })
                    .onConflictDoNothing({ target: calendarSnapshots.clientId })
                    .returning({ id: calendarSnapshots.id });
                inserted += rows.length;
            }
            return inserted;
        },

        async latest({ institutionCode, serviceCode }) {
            const [row] = await db
                .select()
                .from(calendarSnapshots)
                .where(and(eq(calendarSnapshots.institutionCode, institutionCode), eq(calendarSnapshots.serviceCode, serviceCode)))
                .orderBy(desc(calendarSnapshots.id))
                .limit(1);
            const [check] = await db
                .select({ at: sql<Date | null>`max(${monitorChecks.startedAt})` })
                .from(monitorChecks)
                .where(and(
                    eq(monitorChecks.institutionCode, institutionCode),
                    eq(monitorChecks.serviceCode, serviceCode),
                    eq(monitorChecks.outcome, 'ok'),
                ));
            // max() of a timestamptz arrives as text from pg when it goes through sql<>
            const lastCheck = check?.at ? new Date(check.at) : null;
            return {
                snapshot: row
                    ? {
                          id: row.id,
                          receivedAt: row.receivedAt.toISOString(),
                          clientId: row.clientId,
                          observedAt: row.observedAt.toISOString(),
                          institutionCode: row.institutionCode,
                          serviceCode: row.serviceCode,
                          scheduleHash: row.scheduleHash,
                          reservedHash: row.reservedHash,
                          schedule: row.schedule,
                          reserved: row.reserved,
                          appVersion: row.appVersion,
                      }
                    : null,
                lastCheckAt: lastCheck ? lastCheck.toISOString() : null,
            };
        },

        async list(query) {
            const conditions: SQL[] = [];
            if (query.institutionCode) conditions.push(eq(calendarSnapshots.institutionCode, query.institutionCode));
            if (query.serviceCode) conditions.push(eq(calendarSnapshots.serviceCode, query.serviceCode));
            if (query.from) conditions.push(gte(calendarSnapshots.observedAt, new Date(query.from)));
            if (query.to) conditions.push(lt(calendarSnapshots.observedAt, new Date(query.to)));
            if (query.before) conditions.push(lt(calendarSnapshots.id, query.before));
            const rows = await db
                .select({
                    id: calendarSnapshots.id,
                    receivedAt: calendarSnapshots.receivedAt,
                    observedAt: calendarSnapshots.observedAt,
                    institutionCode: calendarSnapshots.institutionCode,
                    serviceCode: calendarSnapshots.serviceCode,
                    scheduleHash: calendarSnapshots.scheduleHash,
                    reservedHash: calendarSnapshots.reservedHash,
                    reservedCount: sql<number>`jsonb_array_length(${calendarSnapshots.reserved}->'slots')`,
                })
                .from(calendarSnapshots)
                .where(and(...conditions))
                .orderBy(desc(calendarSnapshots.id))
                .limit(query.limit);
            const entries = rows.map((row) => ({
                id: row.id,
                receivedAt: row.receivedAt.toISOString(),
                observedAt: row.observedAt.toISOString(),
                institutionCode: row.institutionCode,
                serviceCode: row.serviceCode,
                scheduleHash: row.scheduleHash,
                reservedHash: row.reservedHash,
                reservedCount: Number(row.reservedCount),
            }));
            const last = entries.at(-1);
            return { entries, nextCursor: entries.length === query.limit && last ? last.id : null };
        },
    };
}
