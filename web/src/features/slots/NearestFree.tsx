import styles from './NearestFree.module.css';
import type { SlotKey } from '@/domain/monitoring/slots-diff.ts';
import { buildNearestFree } from './model/nearest-free.ts';
import { useAppServices, useMonitorState } from '@/hooks/use-app-services.ts';

// storedFreeKeys: the free slots of the calendar the server saved, while the monitor has not looked
export function NearestFree({ storedFreeKeys }: { storedFreeKeys?: readonly SlotKey[] }) {
    const { openBooking } = useAppServices();
    const state = useMonitorState();
    const known = state.free !== null || storedFreeKeys !== undefined;
    const view = buildNearestFree(state.free?.keys ?? storedFreeKeys ?? [], state.dateRange);

    return (
        <section className={styles.card} aria-labelledby="nearest-free-title">
            <div className={styles.header}>
                <h2 id="nearest-free-title" className={styles.title}>
                    Найближчі вільні
                </h2>
                {view.rangeLabel && <span className={styles.range}>{view.rangeLabel}</span>}
            </div>
            {view.rows.length > 0 ? (
                <ul className={styles.list}>
                    {view.rows.map((row) => (
                        <li key={row.dateKey} className={styles.row}>
                            <span className={styles.date}>{row.label}</span>
                            <span className={styles.times}>{row.times.join(' ')}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className={styles.empty}>
                    {!known ? 'Вільні слоти ще не перевірені.' : 'У вибраному діапазоні вільних слотів немає.'}
                </p>
            )}
            <div>
                <button type="button" className={styles.button} onClick={openBooking}>
                    Відкрити чернетку
                </button>
            </div>
        </section>
    );
}
