// The check log mixes checks with extension events by time. Only the events the user cares about
// are shown; the rest of the extension's stream stays in the server.
import type { StoredCheckEntry } from '@contracts/checks.ts';
import type { StoredExtensionEvent } from '@contracts/extension-events.ts';

export const SHOWN_EVENT_TYPES = ['selection.selected', 'selection.failed', 'booking.booked', 'session.logged-out'] as const;

export type LogItem =
    | { kind: 'check'; at: string; key: string; entry: StoredCheckEntry }
    | { kind: 'event'; at: string; key: string; event: StoredExtensionEvent };

export function mergeLogItems(checks: StoredCheckEntry[], events: StoredExtensionEvent[]): LogItem[] {
    const items: LogItem[] = [
        ...checks.map((entry): LogItem => ({ kind: 'check', at: entry.startedAt, key: `c${entry.id}`, entry })),
        ...events
            .filter((event) => (SHOWN_EVENT_TYPES as readonly string[]).includes(event.type))
            .map((event): LogItem => ({ kind: 'event', at: event.occurredAt, key: `e${event.id}`, event })),
    ];
    return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
