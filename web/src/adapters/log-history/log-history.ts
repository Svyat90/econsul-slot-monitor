// LogHistory: reads of the server's logs for the Monitoring page. Throws on any failure; the page
// shows the error.
import type { LogHistory } from '@/application/ports.ts';

function toSearch(params: Record<string, unknown>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : '';
}

export function createLogHistory(fetchFn: typeof fetch = (...args) => fetch(...args)): LogHistory {
    async function get<T>(path: string, params: Record<string, unknown>): Promise<T> {
        const response = await fetchFn(`${path}${toSearch(params)}`);
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return (await response.json()) as T;
    }

    return {
        summary: (range) => get('/api/summary', range),
        checks: (query) => get('/api/checks', query),
        reservations: (query) => get('/api/reservation-log', query),
        scheduleChanges: (query) => get('/api/schedule-log', query),
        extensionEvents: (query) => get('/api/extension-events', query),
        scheduleLogDownloadUrl: () => '/api/schedule-log.jsonl',
        calendar: (scope) => get('/api/calendar-snapshots/latest', scope),
    };
}
