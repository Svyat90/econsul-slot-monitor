import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reservationKind } from './enums.ts';

// A slot that became reserved, or was released, between two checks of the app (IDEA-004).
export const reservationEvents = pgTable('reservation_events', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: uuid('client_id').notNull().unique(),
    kind: reservationKind('kind').notNull(),
    institutionCode: text('institution_code').notNull(),
    consulIpnHash: text('consul_ipn_hash').notNull(),
    slotFrom: timestamp('slot_from', { withTimezone: true }).notNull(),
    slotTo: timestamp('slot_to', { withTimezone: true }).notNull(),
    previousCheckAt: timestamp('previous_check_at', { withTimezone: true }).notNull(), // last check without the change
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(), // first check with the change
    tabSessionId: uuid('tab_session_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    index('reservation_events_detected_at_idx').on(t.detectedAt),
    index('reservation_events_institution_slot_idx').on(t.institutionCode, t.slotFrom),
]);
