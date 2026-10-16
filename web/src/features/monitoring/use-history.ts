import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CheckQuery } from '@contracts/checks.ts';
import { useAppServices, useMonitorState } from '@/hooks/use-app-services.ts';
import { mergeLogItems, type LogItem } from './log-items.ts';
import { HISTORY_REFRESH_MS as REFRESH_MS } from '@/hooks/use-reservations.ts';

export type CheckFilter = 'all' | 'new' | 'errors' | 'fast';

const EVENTS_LIMIT = 200;

const CHECK_FILTERS: Record<CheckFilter, Partial<CheckQuery>> = {
    all: {},
    new: { onlyNew: true },
    errors: { failed: true },
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

// Server data lives in the query cache. The check counter in every key moves when a check STARTS,
// before its entry exists; a check goes to the server at once when it ends (the other logs batch
// for up to 5 s). The composition root invalidates these queries when a batch is sent (`onSent`), and the
// logs also refresh every REFRESH_MS (the extension's events arrive only this way).
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

export type CheckLogPage = { items: LogItem[]; total: number };

// One page of the check log. `offset` pages the checks; the extension's events are fetched for
// the time window the page covers, so they never repeat on the next page. The window reaches from
// the page's oldest check up to the newest check of the page before it (that one is fetched too,
// then dropped), and is open at both ends of the whole log.
export function useCheckLog(filter: CheckFilter, page: number, size: number) {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['check-log', filter, institutionCode, checks, page, size],
        queryFn: async (): Promise<CheckLogPage> => {
            const offset = (page - 1) * size;
            const overlap = offset > 0 ? 1 : 0;
            const result = await history.checks({
                ...CHECK_FILTERS[filter],
                institutionCode,
                limit: size + overlap,
                offset: offset - overlap,
            });
            const boundary = overlap ? result.entries[0] : undefined;
            const entries = result.entries.slice(overlap);
            const isLastPage = offset + size >= result.total;
            const oldest = entries.at(-1);
            // the checks stay visible when the events fail to load
            const events =
                filter === 'all' && (isLastPage || oldest)
                    ? await history
                          .extensionEvents({
                              limit: EVENTS_LIMIT,
                              from: isLastPage ? undefined : oldest?.startedAt,
                              to: boundary?.startedAt,
                          })
                          .catch(() => null)
                    : null;
            return { items: mergeLogItems(entries, events?.entries ?? []), total: result.total };
        },
        refetchInterval: REFRESH_MS,
        placeholderData: keepPreviousData,
    });
}

// Counts on the filter chips: how many checks each filter matches
export function useCheckCounts() {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['check-counts', institutionCode, checks],
        queryFn: async (): Promise<Record<CheckFilter, number>> => {
            const ids = Object.keys(CHECK_FILTERS) as CheckFilter[];
            const pages = await Promise.all(ids.map((id) => history.checks({ ...CHECK_FILTERS[id], institutionCode, limit: 1 })));
            return Object.fromEntries(ids.map((id, i) => [id, pages[i]?.total ?? 0])) as Record<CheckFilter, number>;
        },
        refetchInterval: REFRESH_MS,
        placeholderData: keepPreviousData,
    });
}

// A numbered page of a log with no merging: `offset` and `limit` straight to the server
export function useReservationLog(page: number, size: number) {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['reservation-log', institutionCode, checks, page, size],
        queryFn: () => history.reservations({ institutionCode, limit: size, offset: (page - 1) * size }),
        refetchInterval: REFRESH_MS,
        placeholderData: keepPreviousData,
    });
}

export function useScheduleChanges(page: number, size: number) {
    const { history, institutionCode, checks } = useHistoryScope();
    return useQuery({
        queryKey: ['schedule-changes', institutionCode, checks, page, size],
        queryFn: () => history.scheduleChanges({ institutionCode, limit: size, offset: (page - 1) * size }),
        refetchInterval: REFRESH_MS,
        placeholderData: keepPreviousData,
    });
}
