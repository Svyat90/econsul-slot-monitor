import { useQuery } from '@tanstack/react-query';
import type { CheckQuery } from '@contracts/checks.ts';
import { useAppServices, useMonitorState } from '@/hooks/use-app-services.ts';

export type CheckFilter = 'all' | 'new' | 'errors' | 'fast';

const CHECK_FILTERS: Record<CheckFilter, Partial<CheckQuery>> = {
    all: {},
    new: { onlyNew: true },
    errors: {}, // outcome is one value on the server; the page keeps the failed ones
    fast: { kind: 'fast' },
};

const LIST_LIMIT = 50;

// Local midnight of the clock's day to the next one: the server does not guess a time zone
function dayBounds(nowMs: number): { from: string; to: string } {
    const start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { from: start.toISOString(), to: end.toISOString() };
}

// Server data lives in the query cache; the monitor's check counter in every key refetches the
// logs after each check.
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
    });
}

export function useChecks(filter: CheckFilter) {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['checks', filter, institutionCode, checks],
        queryFn: async () => {
            const page = await history.checks({ ...CHECK_FILTERS[filter], institutionCode, limit: LIST_LIMIT });
            return filter === 'errors' ? page.entries.filter((e) => e.outcome !== 'ok') : page.entries;
        },
    });
}

export function useReservations() {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['reservations', institutionCode, checks],
        queryFn: async () => (await history.reservations({ institutionCode, limit: LIST_LIMIT })).entries,
    });
}

export function useScheduleChanges() {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['schedule-changes', institutionCode, checks],
        queryFn: async () => (await history.scheduleChanges({ institutionCode, limit: LIST_LIMIT })).entries,
    });
}
