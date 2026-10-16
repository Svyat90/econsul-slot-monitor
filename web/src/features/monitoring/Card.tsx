import type { ReactNode } from 'react';
import styles from './MonitoringView.module.css';

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
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
