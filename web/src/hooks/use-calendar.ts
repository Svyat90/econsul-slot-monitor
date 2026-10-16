import { useQuery } from '@tanstack/react-query';
import { useAppServices, useMonitorState } from './use-app-services.ts';
import { storedCalendarOf } from '@/domain/slots/stored-calendar.ts';

// The last calendar the server saved for the selected institution and service: what the Slots
// page shows while the monitor has not looked yet (not started, or just opened). Refreshes like
// the other histories; the composition root also invalidates it when a snapshot reaches the server.
export const CALENDAR_REFRESH_MS = 30_000;

export function useStoredCalendar() {
    const { history } = useAppServices();
    const { selection } = useMonitorState();
    const institutionCode = selection?.institution.code;
    const serviceCode = selection?.serviceCode;
    return useQuery({
        queryKey: ['calendar', institutionCode, serviceCode],
        queryFn: async () => storedCalendarOf(await history.calendar({ institutionCode: institutionCode ?? '', serviceCode: serviceCode ?? '' })),
        refetchInterval: CALENDAR_REFRESH_MS,
        enabled: institutionCode !== undefined && serviceCode !== undefined,
    });
}
