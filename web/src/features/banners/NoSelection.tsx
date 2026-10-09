import { Link } from 'react-router';
import styles from './NoSelection.module.css';

// Shown instead of the Slots / Monitoring page while no institution is selected
export function NoSelection() {
    return (
        <section className={styles.card}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <path d="M3 9h18M8 2v4M16 2v4" />
            </svg>
            <h2 className={styles.title}>Що шукаємо?</h2>
            <p className={styles.text}>Виберіть установу в налаштуваннях — тоді тут зʼявиться календар вільних слотів і час наступного відкриття.</p>
            <Link to="/settings" className={styles.link}>
                Налаштувати пошук
            </Link>
        </section>
    );
}
