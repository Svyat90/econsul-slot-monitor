import styles from './MonitoringView.module.css';
import { CheckLog } from './CheckLog.tsx';
import { formatClock, plural } from './format.ts';
import { ReservationLog } from './ReservationLog.tsx';
import { ScheduleChanges } from './ScheduleChanges.tsx';
import { useSummary } from './use-history.ts';
import { useMonitorState } from '@/hooks/use-app-services.ts';

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
