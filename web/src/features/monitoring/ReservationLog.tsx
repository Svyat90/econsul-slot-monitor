import type { StoredReservationEvent } from '@contracts/reservation-log.ts';
import { Card } from './Card.tsx';
import { consulateOffset } from '@/domain/slots/time.ts';
import { useMonitorState } from '@/hooks/use-app-services.ts';
import { formatClock, formatTime, slotLabelAt } from './format.ts';
import { LogFooter } from './LogFooter.tsx';
import { LogList } from './LogList.tsx';
import { LogRow } from './LogRow.tsx';
import styles from './LogTable.module.css';
import { pageCount, rangeLabel } from './pagination.ts';
import { useReservationLog } from './use-history.ts';
import { usePaging } from './use-paging.ts';

const SIDE_PAGE_SIZE = 15;

function ReservationRow({ event, timeZone }: { event: StoredReservationEvent; timeZone?: string }) {
    const released = event.kind === 'released';
    return (
        <LogRow
            time={formatTime(event.detectedAt)}
            dot={released ? 'new' : 'quiet'}
            tone={released ? 'new' : undefined}
            title={released ? 'Звільнено' : 'Зарезервовано'}
            slots={slotLabelAt(event.slotFrom, consulateOffset(timeZone, [], 0))}
            slotsMuted={!released}
            note={`між ${formatClock(event.previousCheckAt)} і ${formatClock(event.detectedAt)} · консул ${event.consulIpnHash.slice(0, 8)}`}
        />
    );
}

export function ReservationLog() {
    const paging = usePaging(SIDE_PAGE_SIZE);
    const { data, isError } = useReservationLog(paging.page, paging.size);
    paging.fit(data?.total);
    const entries = data?.entries ?? [];
    const { locations } = useMonitorState();
    const zoneOf = (code: string) => locations?.institutions.find((i) => i.code === code)?.timeZone;
    return (
        <Card title="Журнал резервувань">
            <div className={styles.hint}>Зміни зайнятих слотів між двома перевірками</div>
            {isError ? (
                <div className={styles.errorText}>Не вдалося завантажити журнал резервувань</div>
            ) : !data ? null : entries.length === 0 ? (
                <div className={styles.empty}>Записів немає</div>
            ) : (
                <LogList items={entries.map((event) => ({ key: `r${event.id}`, at: event.detectedAt, row: <ReservationRow event={event} timeZone={zoneOf(event.institutionCode)} /> }))} />
            )}
            <LogFooter
                page={paging.page}
                pages={pageCount(data?.total ?? 0, paging.size)}
                size={paging.size}
                range={rangeLabel(paging.page, paging.size, entries.length, data?.total ?? 0)}
                total={data?.total ?? 0}
                hideUpTo={SIDE_PAGE_SIZE}
                onPage={paging.setPage}
                onSize={paging.setSize}
            />
        </Card>
    );
}
