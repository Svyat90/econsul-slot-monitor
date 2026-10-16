import { useQuery } from '@tanstack/react-query';
import { useAppServices, useMonitorState } from './use-app-services.ts';

// The reservation log of the selected institution, shared by the Slots day panel and the
// Monitoring page: one query key, one shape. The composition root invalidates it when a log batch
// reaches the server (the check counter in the key moves at a check's start, too early); it also
// refreshes every REFRESH_MS.
export const HISTORY_REFRESH_MS = 15_000;
export const HISTORY_LIST_LIMIT = 50;

export function useReservations() {
    const { history } = useAppServices();
    const { selection, checks } = useMonitorState();
    const institutionCode = selection?.institution.code;
    return useQuery({
        queryKey: ['reservations', institutionCode, checks],
        queryFn: async () => (await history.reservations({ institutionCode, limit: HISTORY_LIST_LIMIT })).entries,
        refetchInterval: HISTORY_REFRESH_MS,
        enabled: institutionCode !== undefined,
    });
}
