import { useQuery } from '@tanstack/react-query';
import type { CheckQuery } from '@contracts/checks.ts';
import { useAppServices, useMonitorState } from '@/hooks/use-app-services.ts';
import { mergeLogItems, type LogItem } from './log-items.ts';
import { HISTORY_LIST_LIMIT as LIST_LIMIT, HISTORY_REFRESH_MS as REFRESH_MS } from '@/hooks/use-reservations.ts';

export type CheckFilter = 'all' | 'new' | 'errors' | 'fast';

const CHECK_FILTERS: Record<CheckFilter, Partial<CheckQuery>> = {
    all: {},
    new: { onlyNew: true },
    errors: {}, // outcome is one value on the server; the page keeps the failed ones
    fast: { kind: 'fast' },
};


// Local midnight of the clock's day to the next one: the server does not guess a time zone
function dayBounds(nowMs: number): { from: string; to: string } {
    const start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { from: start.toISOString(), to: end.toISOString() };
}

// Server data lives in the query cache; the monitor's check counter in every key refetches the
// logs after each check. A check's entries reach the server only after it ends and the batch queue
// flushes (up to 5 s later), so the logs also refresh every REFRESH_MS.
function useHistoryScope() {
    const { history, clock } = useAppServices();
    const { selection, checks } = useMonitorState();
    return { history, institutionCode: selection?.institution.code, checks, nowMs: clock.now() };
}

export function useSummary() {
    const { history, institutionCode, checks, nowMs } = useHistoryScope();
    const { from, to } = dayBounds(nowMs);
    return useQuery({
        queryKey: ['summary', from, to, institutionCode, checks],
        queryFn: () => history.summary({ from, to, institutionCode }),
        refetchInterval: REFRESH_MS,
    });
}

// The check log: checks, and under the "Усі" filter also the extension's events beside them
export function useCheckLog(filter: CheckFilter) {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['check-log', filter, institutionCode, checks],
        queryFn: async (): Promise<LogItem[]> => {
            const [page, events] = await Promise.all([
                history.checks({ ...CHECK_FILTERS[filter], institutionCode, limit: LIST_LIMIT }),
                // the checks stay visible when the events fail to load
                filter === 'all' ? history.extensionEvents({ limit: LIST_LIMIT }).catch(() => null) : Promise.resolve(null),
            ]);
            const entries = filter === 'errors' ? page.entries.filter((e) => e.outcome !== 'ok') : page.entries;
            return mergeLogItems(entries, events?.entries ?? []);
        },
        refetchInterval: REFRESH_MS,
    });
}

export function useScheduleChanges() {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['schedule-changes', institutionCode, checks],
        queryFn: async () => (await history.scheduleChanges({ institutionCode, limit: LIST_LIMIT })).entries,
        refetchInterval: REFRESH_MS,
    });
}
