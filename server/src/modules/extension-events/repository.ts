import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { ExtensionEvent, ExtensionEventQuery, StoredExtensionEvent } from '../../contracts/extension-events.ts';
import type { Db } from '../../db/client.ts';
import { extensionEvents } from '../../db/schema/index.ts';

export interface ExtensionEventPage {
    entries: StoredExtensionEvent[];
    nextCursor: number | null;
}

export interface ExtensionEventsRepository {
    // Returns how many events were really inserted (repeats are skipped).
    insertMany(events: ExtensionEvent[]): Promise<number>;
    list(query: ExtensionEventQuery): Promise<ExtensionEventPage>;
}

export function createExtensionEventsRepository(db: Db): ExtensionEventsRepository {
    return {
        async insertMany(events) {
            if (events.length === 0) return 0;
            const rows = events.map((event) => ({
                clientId: event.clientId,
                occurredAt: new Date(event.occurredAt),
                type: event.type,
                jobId: event.jobId,
                payload: event.payload,
                extensionVersion: event.extensionVersion,
                test: event.test,
            }));
            const inserted = await db
                .insert(extensionEvents)
                .values(rows)
                .onConflictDoNothing({ target: extensionEvents.clientId })
                .returning({ id: extensionEvents.id });
            return inserted.length;
        },

        async list(query) {
            const filters: (SQL | undefined)[] = [
                query.from ? gte(extensionEvents.occurredAt, new Date(query.from)) : undefined,
                query.to ? lt(extensionEvents.occurredAt, new Date(query.to)) : undefined,
                query.type ? eq(extensionEvents.type, query.type) : undefined,
                query.jobId ? eq(extensionEvents.jobId, query.jobId) : undefined,
                query.before ? lt(extensionEvents.id, query.before) : undefined,
            ];
            const rows = await db
                .select()
                .from(extensionEvents)
                .where(and(...filters))
                .orderBy(desc(extensionEvents.id))
                .limit(query.limit);
            const entries: StoredExtensionEvent[] = rows.map((row) => ({
                id: row.id,
                receivedAt: row.receivedAt.toISOString(),
                clientId: row.clientId,
                occurredAt: row.occurredAt.toISOString(),
                type: row.type as StoredExtensionEvent['type'],
                jobId: row.jobId,
                payload: row.payload as StoredExtensionEvent['payload'],
                extensionVersion: row.extensionVersion,
                test: row.test,
            }));
            const last = entries.at(-1);
            return { entries, nextCursor: entries.length === query.limit && last ? last.id : null };
        },
    };
}
