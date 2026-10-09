import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { checkKind, requestOutcome } from './enums.ts';

// One row per monitoring check of the app.
export const monitorChecks = pgTable('monitor_checks', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: uuid('client_id').notNull().unique(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    kind: checkKind('kind').notNull(),
    checkSeq: integer('check_seq').notNull(),
    institutionCode: text('institution_code').notNull(),
    serviceCode: text('service_code').notNull(),
    outcome: requestOutcome('outcome').notNull(),
    freeCount: integer('free_count'), // null when the check failed
    newCount: integer('new_count'),
    outOfRangeCount: integer('out_of_range_count'),
    newSlots: jsonb('new_slots').$type<{ from: string; to: string; consulIpnHash: string }[]>().notNull().default([]),
    tabSessionId: uuid('tab_session_id').notNull(),
    appVersion: text('app_version').notNull(),
    errorMessage: text('error_message'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    index('monitor_checks_started_at_idx').on(t.startedAt),
    index('monitor_checks_institution_started_at_idx').on(t.institutionCode, t.startedAt),
    check('monitor_checks_counts_when_ok', sql`${t.outcome} <> 'ok' OR ${t.freeCount} IS NOT NULL`),
]);
