import { createHash } from 'node:crypto';
import type { ScheduleLogEntry } from '../../contracts/schedule-log.ts';

// Deterministic UUID of an entry: the same fields in a fixed order always give the same id,
// so a re-sent entry hits the UNIQUE client_id and is skipped.
export function scheduleLogClientId(entry: ScheduleLogEntry): string {
    const canonical = JSON.stringify([
        entry.time,
        entry.institutionCode,
        entry.institution,
        entry.type,
        entry.previousCheckAt ?? null,
        entry.changes,
    ]);
    const bytes = createHash('sha256').update(canonical).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4 layout
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
