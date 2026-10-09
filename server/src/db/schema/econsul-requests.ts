import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { checkKind, requestOutcome } from './enums.ts';

// Every request the app or the extension made to e-Consul. Never the token, headers or response body.
export const econsulRequests = pgTable('econsul_requests', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: uuid('client_id').notNull().unique(), // idempotency: a retried batch inserts nothing twice
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    service: text('service').notNull(), // 'e-queue-register'
    method: text('method').notNull(), // 'public-get-consuls-reserved-slots', ...
    institutionCode: text('institution_code'),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    httpStatus: smallint('http_status'), // null = no response (network error)
    outcome: requestOutcome('outcome').notNull(),
    itemsCount: integer('items_count'),
    responseBytes: integer('response_bytes'),
    checkKind: checkKind('check_kind'),
    checkSeq: integer('check_seq'),
    source: text('source').notNull(), // 'app' | 'extension'
    tabSessionId: uuid('tab_session_id').notNull(), // one app tab / extension run = one session
    appVersion: text('app_version').notNull(),
    errorMessage: text('error_message'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    index('econsul_requests_started_at_idx').on(t.startedAt),
    index('econsul_requests_method_started_at_idx').on(t.method, t.startedAt),
    index('econsul_requests_failures_idx').on(t.startedAt).where(sql`${t.outcome} <> 'ok'`),
    check('econsul_requests_status_matches_outcome', sql`(${t.outcome} = 'network_error') = (${t.httpStatus} IS NULL)`),
    check('econsul_requests_source', sql`${t.source} IN ('app', 'extension')`),
]);
