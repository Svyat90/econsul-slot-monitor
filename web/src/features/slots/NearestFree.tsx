import styles from './NearestFree.module.css';
import { buildNearestFree } from './model/nearest-free.ts';
import { useAppServices, useMonitorState } from '@/hooks/use-app-services.ts';

export function NearestFree() {
    const { openBooking } = useAppServices();
    const state = useMonitorState();
    const view = buildNearestFree(state.free?.keys ?? [], state.dateRange);

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
                    {state.free === null ? 'Вільні слоти ще не перевірені.' : 'У вибраному діапазоні вільних слотів немає.'}
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
