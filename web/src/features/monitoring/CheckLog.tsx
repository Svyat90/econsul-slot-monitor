import { useState } from 'react';
import type { StoredCheckEntry } from '@contracts/checks.ts';
import type { StoredExtensionEvent } from '@contracts/extension-events.ts';
import type { CheckKind } from '@/application/monitor.ts';
import { useMonitorState } from '@/hooks/use-app-services.ts';
import { Card } from './Card.tsx';
import { LogFooter } from './LogFooter.tsx';
import { LogList, type LogListItem } from './LogList.tsx';
import { LogRow, type Tag } from './LogRow.tsx';
import styles from './LogTable.module.css';
import { usePaging } from './use-paging.ts';
import { formatDuration, formatTime, plural, shortSlot, slotWhen } from './format.ts';
import { DEFAULT_PAGE_SIZE, pageCount, rangeLabel } from './pagination.ts';
import { useCheckCounts, useCheckLog, type CheckFilter } from './use-history.ts';

const FILTERS: { id: CheckFilter; label: string }[] = [
    { id: 'all', label: 'Усі' },
    { id: 'new', label: 'Нові слоти' },
    { id: 'errors', label: 'Помилки' },
    { id: 'fast', label: 'Часті' },
];

function kindTags(kind: CheckKind): Tag[] {
    return kind === 'fast' ? [{ text: 'часта', tone: 'fast' }] : kind === 'manual' ? [{ text: 'вручну' }] : [];
}

function CheckRow({ entry }: { entry: StoredCheckEntry }) {
    const common = { time: formatTime(entry.startedAt), duration: formatDuration(entry.durationMs) };
    if (entry.outcome !== 'ok') {
        return (
            <LogRow
                {...common}
                dot="error"
                tone="error"
                title="Не вдалося перевірити"
                note={entry.errorMessage ?? 'Помилка перевірки'}
                tags={[...kindTags(entry.kind), { text: 'помилка', tone: 'danger' }]}
            />
        );
    }
    const fresh = entry.newCount ?? 0;
    const outOfRange = entry.outOfRangeCount ? `${entry.outOfRangeCount} поза діапазоном дат` : '';
    if (fresh > 0) {
        return (
            <LogRow
                {...common}
                dot="new"
                tone="new"
                title={`${fresh} ${plural(fresh, 'новий слот', 'нові слоти', 'нових слотів')}`}
                slots={entry.newSlots.map((s) => shortSlot(s.date, s.time)).join(' · ')}
                note={`усього вільних: ${entry.freeCount ?? 0}`}
                tags={kindTags(entry.kind)}
            />
        );
    }
    return <LogRow {...common} dot="quiet" title={`Вільних ${entry.freeCount || 'немає'}`} note={outOfRange} tags={kindTags(entry.kind)} />;
}

// The request in flight, shown at once: its entry exists only after the answer is in
function PendingRow({ kind, startedAt }: { kind: CheckKind; startedAt: number }) {
    return (
        <LogRow
            time={formatTime(new Date(startedAt).toISOString())}
            dot="pending"
            tone="pending"
            title="Запит надіслано"
            note="очікуємо відповідь e-Consul"
            tags={[...kindTags(kind), { text: 'в обробці', tone: 'pending' }]}
            duration="…"
        />
    );
}

function eventText(event: StoredExtensionEvent): { title: string; note?: string } {
    // The extension writes the slot as payload.date ('2027-03-31') and payload.time ('09:50')
    const { date, time } = event.payload;
    const slotFrom = typeof date === 'string' && typeof time === 'string' ? `${date}T${time}` : null;
    const error = typeof event.payload.error === 'string' ? event.payload.error : null;
    switch (event.type) {
        case 'selection.selected':
            return { title: 'Розширення вибрало слот', note: `${slotFrom ? `${slotWhen(slotFrom)} ` : ''}у чернетці — натисніть «Підтвердити»` };
        case 'selection.failed':
            return { title: 'Розширення не вибрало слот', note: error ?? undefined };
        case 'booking.booked':
            return { title: 'Розширення забронювало слот', note: slotFrom ? slotWhen(slotFrom) : undefined };
        default:
            return { title: 'Сесію e-Consul завершено', note: 'розширення вийшло з сесії' };
    }
}

function EventRow({ event }: { event: StoredExtensionEvent }) {
    const { title, note } = eventText(event);
    const tags: Tag[] = [{ text: 'розширення' }, ...(event.test ? [{ text: 'тест' }] : [])];
    return <LogRow time={formatTime(event.occurredAt)} dot="event" title={title} note={note} tags={tags} duration="" />;
}

export function CheckLog() {
    const [filter, setFilter] = useState<CheckFilter>('all');
    const paging = usePaging(DEFAULT_PAGE_SIZE);
    const { page, size } = paging;
    const { data, isError } = useCheckLog(filter, page, size);
    const counts = useCheckCounts().data;
    const { currentCheck } = useMonitorState();

    // entries went away (a filter matches less than before): stay on a page that exists
    paging.fit(data?.total);
    const pages = pageCount(data?.total ?? 0, size);

    // 'Нові слоти' and 'Помилки' are about finished checks; 'Часті' only about the fast ones
    const showPending =
        page === 1 && currentCheck !== null && (filter === 'all' || (filter === 'fast' && currentCheck.kind === 'fast'));
    const items = data?.items ?? [];
    const shownChecks = items.filter((item) => item.kind === 'check').length;
    const listItems: LogListItem[] = items.map((item) => ({
        key: item.key,
        at: item.at,
        row: item.kind === 'event' ? <EventRow event={item.event} /> : <CheckRow entry={item.entry} />,
    }));

    return (
        <Card
            title="Журнал перевірок"
            aside={
                <div className={styles.filters}>
                    {FILTERS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            className={styles.chip}
                            aria-pressed={filter === f.id}
                            onClick={() => {
                                setFilter(f.id);
                                paging.setPage(1);
                            }}
                        >
                            {f.label}
                            {counts && <span className={styles.count}>{counts[f.id]}</span>}
                        </button>
                    ))}
                </div>
            }
        >
            {isError ? (
                <div className={styles.errorText}>Не вдалося завантажити журнал перевірок</div>
            ) : !data && !showPending ? null : items.length === 0 && !showPending ? (
                <div className={styles.empty}>Записів немає</div>
            ) : (
                <LogList
                    items={listItems}
                    leading={showPending && currentCheck ? <PendingRow kind={currentCheck.kind} startedAt={currentCheck.startedAt} /> : null}
                />
            )}
            <LogFooter
                page={page}
                pages={pages}
                size={size}
                range={rangeLabel(page, size, shownChecks, data?.total ?? 0)}
                total={data?.total ?? 0}
                onPage={paging.setPage}
                onSize={paging.setSize}
            />
        </Card>
    );
}
