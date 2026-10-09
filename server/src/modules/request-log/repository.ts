import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { requestLogPageSchema, RequestLogEntry, RequestLogQuery, StoredRequestLogEntry } from '../../contracts/request-log.ts';
import type { Db } from '../../db/client.ts';
import { econsulRequests } from '../../db/schema/index.ts';

type Page<T> = Omit<z.infer<typeof requestLogPageSchema>, 'entries'> & { entries: T[] };

export interface RequestLogRepository {
    // Returns how many entries were really inserted (repeats are skipped).
    insertMany(entries: RequestLogEntry[]): Promise<number>;
    list(query: RequestLogQuery): Promise<Page<StoredRequestLogEntry>>;
}

export function createRequestLogRepository(db: Db): RequestLogRepository {
    return {
        async insertMany(entries) {
            if (entries.length === 0) return 0;
            const rows = entries.map((entry) => ({ ...entry, startedAt: new Date(entry.startedAt) }));
            const inserted = await db
                .insert(econsulRequests)
                .values(rows)
                .onConflictDoNothing({ target: econsulRequests.clientId })
                .returning({ id: econsulRequests.id });
            return inserted.length;
        },

        async list(query) {
            const conditions: (SQL | undefined)[] = [
                query.from ? gte(econsulRequests.startedAt, new Date(query.from)) : undefined,
                query.to ? lte(econsulRequests.startedAt, new Date(query.to)) : undefined,
                query.institutionCode ? eq(econsulRequests.institutionCode, query.institutionCode) : undefined,
                query.method ? eq(econsulRequests.method, query.method) : undefined,
                query.outcome ? eq(econsulRequests.outcome, query.outcome) : undefined,
                query.source ? eq(econsulRequests.source, query.source) : undefined,
                query.before ? lt(econsulRequests.id, query.before) : undefined,
            ];
            const rows = await db
                .select()
                .from(econsulRequests)
                .where(and(...conditions))
                .orderBy(desc(econsulRequests.id))
                .limit(query.limit);
            const entries = rows.map((row): StoredRequestLogEntry => ({
                ...row,
                filters: row.filters as StoredRequestLogEntry['filters'],
                source: row.source as StoredRequestLogEntry['source'],
                startedAt: row.startedAt.toISOString(),
                receivedAt: row.receivedAt.toISOString(),
            }));
            const nextCursor = entries.length === query.limit ? (entries[entries.length - 1]?.id ?? null) : null;
            return { entries, nextCursor };
        },
    };
}
