import { and, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { ReservationEvent, ReservationQuery, StoredReservationEvent } from '../../contracts/reservation-log.ts';
import type { Db } from '../../db/client.ts';
import { reservationEvents } from '../../db/schema/index.ts';

export interface ReservationPage {
    entries: StoredReservationEvent[];
    nextCursor: number | null;
    total: number;
}

export interface ReservationLogRepository {
    // Returns how many events were really inserted (repeats are skipped).
    insertMany(events: ReservationEvent[]): Promise<number>;
    // Newest first; `detectedAt` in [from, to).
    list(query: ReservationQuery): Promise<ReservationPage>;
}

export function createReservationLogRepository(db: Db): ReservationLogRepository {
    return {
        async insertMany(events) {
            if (events.length === 0) return 0;
            const rows = events.map((event) => ({
                clientId: event.clientId,
                kind: event.kind,
                institutionCode: event.institutionCode,
                consulIpnHash: event.consulIpnHash,
                slotFrom: new Date(event.slotFrom),
                slotTo: new Date(event.slotTo),
                previousCheckAt: new Date(event.previousCheckAt),
                detectedAt: new Date(event.detectedAt),
                tabSessionId: event.tabSessionId,
            }));
            const inserted = await db
                .insert(reservationEvents)
                .values(rows)
                .onConflictDoNothing({ target: reservationEvents.clientId })
                .returning({ id: reservationEvents.id });
            return inserted.length;
        },

        async list(query) {
            const conditions: SQL[] = [];
            if (query.kind) conditions.push(eq(reservationEvents.kind, query.kind));
            if (query.institutionCode) conditions.push(eq(reservationEvents.institutionCode, query.institutionCode));
            if (query.from) conditions.push(gte(reservationEvents.detectedAt, new Date(query.from)));
            if (query.to) conditions.push(lt(reservationEvents.detectedAt, new Date(query.to)));
            const cursor = query.before ? lt(reservationEvents.id, query.before) : undefined;
            const [rows, [counted]] = await Promise.all([
                db
                    .select()
                    .from(reservationEvents)
                    .where(and(...conditions, cursor))
                    .orderBy(desc(reservationEvents.id))
                    .limit(query.limit)
                    .offset(query.offset ?? 0),
                db
                    .select({ total: count() })
                    .from(reservationEvents)
                    .where(and(...conditions)),
            ]);
            const entries = rows.map((row) => ({
                id: row.id,
                receivedAt: row.receivedAt.toISOString(),
                clientId: row.clientId,
                kind: row.kind,
                institutionCode: row.institutionCode,
                consulIpnHash: row.consulIpnHash,
                slotFrom: row.slotFrom.toISOString(),
                slotTo: row.slotTo.toISOString(),
                previousCheckAt: row.previousCheckAt.toISOString(),
                detectedAt: row.detectedAt.toISOString(),
                tabSessionId: row.tabSessionId,
            }));
            const last = entries.at(-1);
            return { entries, nextCursor: entries.length === query.limit && last ? last.id : null, total: counted?.total ?? 0 };
        },
    };
}
