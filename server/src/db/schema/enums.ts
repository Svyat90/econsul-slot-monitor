import { pgEnum } from 'drizzle-orm/pg-core';

// Closed sets shared by several tables. Open sets (e-Consul method names, extension event types) are text.
export const requestOutcome = pgEnum('request_outcome',
    ['ok', 'session_expired', 'unavailable', 'schema_error', 'network_error']);
export const checkKind = pgEnum('check_kind', ['scheduled', 'fast', 'manual']);
export const reservationKind = pgEnum('reservation_kind', ['reserved', 'released']);
export const scheduleChangeType = pgEnum('schedule_change_type', ['baseline', 'changed']);
