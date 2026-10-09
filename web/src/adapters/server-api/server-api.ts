// ServerApi: fire-and-forget writes to our own server's logs. Never throws, never awaited.
import type { ServerApi } from '@/application/ports.ts';

export function createServerApi(fetchFn: typeof fetch = (...args) => fetch(...args)): ServerApi {
    return {
        recordScheduleChange(entry) {
            try {
                fetchFn('/schedule-log', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(entry),
                }).catch(() => {
                    /* the server log is best effort */
                });
            } catch {
                /* fetch threw synchronously */
            }
        },
    };
}
