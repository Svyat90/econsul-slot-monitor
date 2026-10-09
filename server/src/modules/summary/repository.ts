import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Summary, SummaryQuery } from '../../contracts/summary.ts';
import type { Db } from '../../db/client.ts';
import { monitorChecks, reservationEvents } from '../../db/schema/index.ts';

export interface SummaryRepository {
    summary(query: SummaryQuery): Promise<Summary>;
}

export function createSummaryRepository(db: Db): SummaryRepository {
    return {
        async summary({ from, to, institutionCode }) {
            const start = new Date(from);
            const end = new Date(to);

            const [checks] = await db
                .select({
                    total: sql<number>`count(*)::int`,
                    fast: sql<number>`(count(*) FILTER (WHERE ${monitorChecks.kind} = 'fast'))::int`,
                    failed: sql<number>`(count(*) FILTER (WHERE ${monitorChecks.outcome} <> 'ok'))::int`,
                    newTotal: sql<number>`coalesce(sum(${monitorChecks.newCount}), 0)::int`,
                    lastAt: sql<string | null>`to_char(max(${monitorChecks.startedAt}) FILTER (WHERE ${monitorChecks.newCount} > 0) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
                })
                .from(monitorChecks)
                .where(and(
                    gte(monitorChecks.startedAt, start),
                    lt(monitorChecks.startedAt, end),
                    institutionCode ? eq(monitorChecks.institutionCode, institutionCode) : undefined,
                ));

            const [reservations] = await db
                .select({
                    reserved: sql<number>`(count(*) FILTER (WHERE ${reservationEvents.kind} = 'reserved'))::int`,
                    released: sql<number>`(count(*) FILTER (WHERE ${reservationEvents.kind} = 'released'))::int`,
                })
                .from(reservationEvents)
                .where(and(
                    gte(reservationEvents.detectedAt, start),
                    lt(reservationEvents.detectedAt, end),
                    institutionCode ? eq(reservationEvents.institutionCode, institutionCode) : undefined,
                ));

            return {
                checks: { total: checks?.total ?? 0, fast: checks?.fast ?? 0, failed: checks?.failed ?? 0 },
                newFree: { total: checks?.newTotal ?? 0, lastAt: checks?.lastAt ?? null },
                reservations: { reserved: reservations?.reserved ?? 0, released: reservations?.released ?? 0 },
            };
        },
    };
}
