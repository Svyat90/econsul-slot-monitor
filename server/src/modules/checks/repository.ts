import { and, count, desc, eq, gt, gte, lt, ne, type SQL } from 'drizzle-orm';
import type { CheckEntry, CheckQuery, StoredCheckEntry } from '../../contracts/checks.ts';
import type { Db } from '../../db/client.ts';
import { monitorChecks } from '../../db/schema/index.ts';

export interface CheckPage {
    entries: StoredCheckEntry[];
    nextCursor: number | null;
    total: number;
}

export interface ChecksRepository {
    // Returns how many entries were really inserted (repeats are skipped).
    insertMany(entries: CheckEntry[]): Promise<number>;
    list(query: CheckQuery): Promise<CheckPage>;
}

export function createChecksRepository(db: Db): ChecksRepository {
    return {
        async insertMany(entries) {
            if (entries.length === 0) return 0;
            const rows = entries.map((entry) => ({
                clientId: entry.clientId,
                startedAt: new Date(entry.startedAt),
                durationMs: entry.durationMs,
                kind: entry.kind,
                checkSeq: entry.checkSeq,
                institutionCode: entry.institutionCode,
                serviceCode: entry.serviceCode,
                outcome: entry.outcome,
                freeCount: entry.freeCount,
                newCount: entry.newCount,
                outOfRangeCount: entry.outOfRangeCount,
                newSlots: entry.newSlots,
                tabSessionId: entry.tabSessionId,
                appVersion: entry.appVersion,
                errorMessage: entry.errorMessage,
            }));
            const inserted = await db
                .insert(monitorChecks)
                .values(rows)
                .onConflictDoNothing({ target: monitorChecks.clientId })
                .returning({ id: monitorChecks.id });
            return inserted.length;
        },

        async list(query) {
            const filters: (SQL | undefined)[] = [
                query.from ? gte(monitorChecks.startedAt, new Date(query.from)) : undefined,
                query.to ? lt(monitorChecks.startedAt, new Date(query.to)) : undefined,
                query.institutionCode ? eq(monitorChecks.institutionCode, query.institutionCode) : undefined,
                query.kind ? eq(monitorChecks.kind, query.kind) : undefined,
                query.outcome ? eq(monitorChecks.outcome, query.outcome) : undefined,
                query.onlyNew ? gt(monitorChecks.newCount, 0) : undefined,
                query.failed ? ne(monitorChecks.outcome, 'ok') : undefined,
            ];
            const cursor = query.before ? lt(monitorChecks.id, query.before) : undefined;
            const [rows, [counted]] = await Promise.all([
                db
                    .select()
                    .from(monitorChecks)
                    .where(and(...filters, cursor))
                    .orderBy(desc(monitorChecks.id))
                    .limit(query.limit)
                    .offset(query.offset ?? 0),
                db
                    .select({ total: count() })
                    .from(monitorChecks)
                    .where(and(...filters)),
            ]);
            const entries: StoredCheckEntry[] = rows.map((row) => ({
                id: row.id,
                receivedAt: row.receivedAt.toISOString(),
                clientId: row.clientId,
                startedAt: row.startedAt.toISOString(),
                durationMs: row.durationMs,
                kind: row.kind,
                checkSeq: row.checkSeq,
                institutionCode: row.institutionCode,
                serviceCode: row.serviceCode,
                outcome: row.outcome,
                freeCount: row.freeCount,
                newCount: row.newCount,
                outOfRangeCount: row.outOfRangeCount,
                newSlots: row.newSlots,
                tabSessionId: row.tabSessionId,
                appVersion: row.appVersion,
                errorMessage: row.errorMessage,
            }));
            const last = entries.at(-1);
            return { entries, nextCursor: entries.length === query.limit && last ? last.id : null, total: counted?.total ?? 0 };
        },
    };
}
