import { useState, type ReactNode } from 'react';
import styles from './MonitoringView.module.css';
import { formatClock, formatDateTime, formatSlotDate, formatTime, plural, slotLabel } from './format.ts';
import { useChecks, useReservations, useScheduleChanges, useSummary, type CheckFilter } from './use-history.ts';
import { useAppServices, useMonitorState } from '@/hooks/use-app-services.ts';

const FILTERS: { id: CheckFilter; label: string }[] = [
    { id: 'all', label: 'Усі' },
    { id: 'new', label: 'Нові слоти' },
    { id: 'errors', label: 'Помилки' },
    { id: 'fast', label: 'Часті' },
];

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
    return (
        <section className={styles.card} aria-label={title}>
            <header className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{title}</h2>
                {aside}
            </header>
            {children}
        </section>
    );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'success' | 'accent' }) {
    return (
        <div className={styles.stat}>
            <div className={styles.statLabel}>{label}</div>
            <div className={`${styles.statValue} ${tone ? styles[tone] : ''}`}>{value}</div>
            <div className={styles.statNote}>{note}</div>
        </div>
    );
}

function Summary() {
    const { data, isError } = useSummary();
    if (isError) return <div className={styles.error}>Не вдалося завантажити зведення</div>;
    return (
        <div className={styles.stats}>
            <Stat
                label="Перевірок сьогодні"
                value={data ? String(data.checks.total) : '—'}
                note={data ? `${data.checks.fast} частих · ${data.checks.failed} ${plural(data.checks.failed, 'помилка', 'помилки', 'помилок')}` : ''}
            />
            <Stat
                label="Нових вільних"
                value={data ? String(data.newFree.total) : '—'}
                note={data?.newFree.lastAt ? `останні о ${formatClock(data.newFree.lastAt)}` : ''}
                tone="success"
            />
            <Stat label="Резервувань" value={data ? String(data.reservations.reserved) : '—'} note="зайняті слоти" tone="accent" />
            <Stat label="Скасувань" value={data ? String(data.reservations.released) : '—'} note="звільнені слоти" tone="accent" />
        </div>
    );
}

function CheckLog() {
    const [filter, setFilter] = useState<CheckFilter>('all');
    const { data, isError } = useChecks(filter);
    return (
        <Card
            title="Журнал перевірок"
            aside={
                <div className={styles.filters}>
                    {FILTERS.map((f) => (
                        <button key={f.id} type="button" className={styles.chip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                            {f.label}
                        </button>
                    ))}
                </div>
            }
        >
            {isError ? (
                <div className={styles.error}>Не вдалося завантажити журнал перевірок</div>
            ) : !data ? null : data.length === 0 ? (
                <div className={styles.empty}>Записів немає</div>
            ) : (
                <ul className={styles.list}>
                    {data.map((entry) => (
                        <li key={entry.id} className={`${styles.row} ${entry.newCount ? styles.rowNew : ''}`}>
                            <span className={styles.time}>{formatTime(entry.startedAt)}</span>
                            <div>
                                <div>
                                    <strong>Перевірка #{entry.checkSeq}</strong>
                                    {entry.kind === 'fast' && <span className={`${styles.badge} ${styles.fast}`}>часта</span>}
                                    {entry.kind === 'manual' && <span className={styles.badge}>вручну</span>}
                                    {entry.outcome !== 'ok' && <span className={`${styles.badge} ${styles.danger}`}>помилка</span>}
                                </div>
                                <div className={styles.muted}>
                                    {entry.outcome === 'ok'
                                        ? `${entry.freeCount} вільних${entry.newCount ? ` · ${entry.newCount} нові` : ''}${entry.outOfRangeCount ? ` · ${entry.outOfRangeCount} поза діапазоном дат` : ''}`
                                        : (entry.errorMessage ?? 'Помилка перевірки')}
                                </div>
                                {entry.newSlots.length > 0 && (
                                    <div className={styles.newSlots}>
                                        нові: {entry.newSlots.map((s) => `${formatSlotDate(s.date)}: ${s.time}`).join(', ')}
                                    </div>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

function ReservationLog() {
    const { data, isError } = useReservations();
    return (
        <Card title="Журнал резервувань">
            <div className={styles.muted}>Зміни зайнятих слотів між двома перевірками</div>
            {isError ? (
                <div className={styles.error}>Не вдалося завантажити журнал резервувань</div>
            ) : !data ? null : data.length === 0 ? (
                <div className={styles.empty}>Записів немає</div>
            ) : (
                <ul className={styles.list}>
                    {data.map((event) => (
                        <li key={event.id} className={styles.row}>
                            <span className={styles.time}>{formatDateTime(event.detectedAt)}</span>
                            <div>
                                <div>
                                    <span className={`${styles.badge} ${event.kind === 'released' ? styles.success : ''}`}>
                                        {event.kind === 'reserved' ? 'зарезервовано' : 'звільнено'}
                                    </span>
                                    <strong className={styles.mono}>{slotLabel(event.slotFrom)}</strong>
                                </div>
                                <div className={styles.muted}>
                                    між {formatClock(event.previousCheckAt)} і {formatClock(event.detectedAt)} · консул {event.consulIpnHash.slice(0, 8)}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

function ScheduleChanges() {
    const { history } = useAppServices();
    const { data, isError } = useScheduleChanges();
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
                <div className={styles.error}>Не вдалося завантажити зміни розкладу</div>
            ) : !data ? null : data.length === 0 ? (
                <div className={styles.empty}>Записів немає</div>
            ) : (
                <ul className={styles.list}>
                    {data.map((entry) => (
                        <li key={entry.id} className={styles.row}>
                            <span className={styles.time}>{formatDateTime(entry.time)}</span>
                            <div>{entry.type === 'baseline' ? 'Базовий знімок розкладу' : entry.changes.join('; ')}</div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

export function MonitoringView() {
    const { selection, locations } = useMonitorState();
    const subtitle = selection ? `${selection.institution.name} · ${locations?.services[selection.serviceCode] ?? selection.serviceCode}` : '';
    return (
        <div className={styles.page}>
            <h1 className={styles.title}>
                Моніторинг {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
            </h1>
            <Summary />
            <div className={styles.columns}>
                <CheckLog />
                <div className={styles.side}>
                    <ReservationLog />
                    <ScheduleChanges />
                </div>
            </div>
        </div>
    );
}
