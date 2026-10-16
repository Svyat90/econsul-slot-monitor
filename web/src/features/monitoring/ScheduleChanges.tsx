import type { StoredScheduleLogEntry } from '@contracts/schedule-log.ts';
import { useAppServices } from '@/hooks/use-app-services.ts';
import { Card } from './Card.tsx';
import { formatTime } from './format.ts';
import { LogFooter } from './LogFooter.tsx';
import { LogList } from './LogList.tsx';
import { LogRow } from './LogRow.tsx';
import styles from './LogTable.module.css';
import { pageCount, rangeLabel } from './pagination.ts';
import { useScheduleChanges } from './use-history.ts';
import { usePaging } from './use-paging.ts';

const SIDE_PAGE_SIZE = 15;

function ScheduleRow({ entry }: { entry: StoredScheduleLogEntry }) {
    const baseline = entry.type === 'baseline';
    return (
        <LogRow
            time={formatTime(entry.time)}
            dot={baseline ? 'quiet' : 'event'}
            title={baseline ? 'Базовий знімок розкладу' : 'Розклад змінився'}
            details={baseline ? undefined : entry.changes}
        />
    );
}

export function ScheduleChanges() {
    const { history } = useAppServices();
    const paging = usePaging(SIDE_PAGE_SIZE);
    const { data, isError } = useScheduleChanges(paging.page, paging.size);
    paging.fit(data?.total);
    const entries = data?.entries ?? [];
    return (
        <Card
            title="Зміни розкладу"
            aside={
                <a className={styles.link} href={history.scheduleLogDownloadUrl()} download>
                    Завантажити JSONL
                </a>
            }
        >
            {isError ? (
                <div className={styles.errorText}>Не вдалося завантажити зміни розкладу</div>
            ) : !data ? null : entries.length === 0 ? (
                <div className={styles.empty}>Записів немає</div>
            ) : (
                <LogList items={entries.map((entry) => ({ key: `s${entry.id}`, at: entry.time, row: <ScheduleRow entry={entry} /> }))} />
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
