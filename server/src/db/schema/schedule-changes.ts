import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { scheduleChangeType } from './enums.ts';

// Schedule snapshots of an institution: the first one (baseline) and every change after it.
// Same fields as a line of the old logs/schedule-changes.jsonl.
export const scheduleChanges = pgTable('schedule_changes', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: uuid('client_id').notNull().unique(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(), // `time` in the JSONL
    institutionCode: text('institution_code').notNull(),
    institution: text('institution').notNull(),
    type: scheduleChangeType('type').notNull(),
    previousCheckAt: timestamp('previous_check_at', { withTimezone: true }), // null for a baseline
    changes: jsonb('changes').$type<string[]>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    index('schedule_changes_checked_at_idx').on(t.checkedAt),
    index('schedule_changes_institution_checked_at_idx').on(t.institutionCode, t.checkedAt),
]);
