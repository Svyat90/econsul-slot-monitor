import type { ReactNode } from 'react';
import styles from './SettingsView.module.css';

export function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className={styles.card} aria-label={title}>
            <h2 className={styles.cardTitle}>{title}</h2>
            {children}
        </section>
    );
}
