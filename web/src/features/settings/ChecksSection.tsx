import { useState } from 'react';
import { Section } from './Section.tsx';
import styles from './SettingsView.module.css';
import { clampIntervalBounds } from '@/domain/monitoring/schedule.ts';
import { useMonitor, useMonitorState } from '@/hooks/use-app-services.ts';

export function ChecksSection() {
    const monitor = useMonitor();
    const { interval, fastChecks } = useMonitorState();
    const [draft, setDraft] = useState({ min: String(interval.min), max: String(interval.max) });

    // The monitor clamps too; clamping here shows the accepted values in the fields
    const commit = () => {
        const bounds = clampIntervalBounds(Number(draft.min), Number(draft.max));
        monitor.setInterval(bounds);
        setDraft({ min: String(bounds.min), max: String(bounds.max) });
    };

    return (
        <Section title="Перевірки">
            <div className={styles.interval}>
                <label className={styles.inline}>
                    <span>Кожні, від</span>
                    <input
                        type="number"
                        min={10}
                        className={`${styles.control} ${styles.number}`}
                        value={draft.min}
                        onChange={(event) => setDraft({ ...draft, min: event.target.value })}
                        onBlur={commit}
                    />
                </label>
                <label className={styles.inline}>
                    <span>до</span>
                    <input
                        type="number"
                        min={10}
                        className={`${styles.control} ${styles.number}`}
                        value={draft.max}
                        onChange={(event) => setDraft({ ...draft, max: event.target.value })}
                        onBlur={commit}
                    />
                </label>
            </div>
            <div className={styles.hint}>с, випадково · розклад раз на 30 хв · не менше 10 с</div>
            <label className={styles.check}>
                <input type="checkbox" checked={fastChecks} onChange={(event) => monitor.setFastChecks(event.target.checked)} />
                <span>Часті перевірки навколо відкриття нового дня: кожні 15–20 с, від 2 хв до відкриття до 3 хв після</span>
            </label>
        </Section>
    );
}
