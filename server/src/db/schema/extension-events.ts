import { sql } from 'drizzle-orm';
import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Events of the extension: session, draft, slot-picking funnel, auto-booking, user actions.
// No token and no applicant data in `payload`.
export const extensionEvents = pgTable('extension_events', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: uuid('client_id').notNull().unique(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    type: text('type').notNull(), // open set: 'session.found', 'picker.step', ...
    jobId: text('job_id'), // groups the events of one slot-picking run
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    extensionVersion: text('extension_version').notNull(),
    test: boolean('test').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    index('extension_events_occurred_at_idx').on(t.occurredAt),
    index('extension_events_job_idx').on(t.jobId).where(sql`${t.jobId} IS NOT NULL`),
]);
