import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// What the Slots page draws, saved when it changes: the schedule of an institution and the
// reserved slots of a service. Lets the page show the last known calendar without monitoring and
// keeps the history of how the reservations moved. Written only when a hash differs from the
// newest row of the same institution and service.
export const calendarSnapshots = pgTable('calendar_snapshots', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: uuid('client_id').notNull().unique(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    institutionCode: text('institution_code').notNull(),
    serviceCode: text('service_code').notNull(),
    scheduleHash: text('schedule_hash').notNull(),
    reservedHash: text('reserved_hash').notNull(),
    schedule: jsonb('schedule').$type<Record<string, unknown>[]>().notNull(),
    reserved: jsonb('reserved').$type<{ consuls: string[]; slots: [number, string, string][] }>().notNull(),
    appVersion: text('app_version').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    index('calendar_snapshots_scope_id_idx').on(t.institutionCode, t.serviceCode, t.id),
    index('calendar_snapshots_observed_at_idx').on(t.observedAt),
]);
