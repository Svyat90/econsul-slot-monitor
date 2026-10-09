import { useState } from 'react';
import styles from './Banners.module.css';
import { formatClock, formatFreshSlots, sessionBanner } from './model/banners.ts';
import { useAppServices, useExtensionState, useMonitorState, useNowSeconds } from '@/hooks/use-app-services.ts';

// Global banners above the page: the session (login / about to expire) and fresh free slots
export function Banners() {
    const { extensionLink, openBooking } = useAppServices();
    const monitor = useMonitorState();
    const extension = useExtensionState();
    const nowMs = useNowSeconds() * 1000;
    // The banner is dismissed for one batch of fresh slots; the next batch brings it back
    const [dismissed, setDismissed] = useState<readonly string[] | null>(null);

    const session = sessionBanner(extension, monitor.stoppedBy, nowMs);
    const showFresh = monitor.lastFresh.length > 0 && dismissed !== monitor.lastFresh;

    if (!session && !showFresh) return null;
    return (
        <div className={styles.stack}>
            {session && (
                <div className={`${styles.banner} ${session.kind === 'login' ? styles.danger : styles.warn}`} role="alert">
                    <span className={styles.dot} aria-hidden="true" />
                    <div className={styles.text}>
                        {session.kind === 'login' ? (
                            <>
                                <b>Увійдіть на e-consul.</b> {session.resumes ? 'Моніторинг продовжиться сам.' : 'Токен прийде сюди сам.'}
                            </>
                        ) : (
                            <>
                                <b>Сесія скінчиться о {formatClock(session.exp)}.</b> Увійдіть на e-consul знову, щоб моніторинг не зупинився.
                            </>
                        )}
                    </div>
                    {session.kind === 'login' && (
                        <button type="button" className={styles.action} onClick={() => extensionLink.login()}>
                            Увійти
                        </button>
                    )}
                </div>
            )}
            {showFresh && (
                <div className={`${styles.banner} ${styles.success}`} role="status">
                    <span className={styles.dot} aria-hidden="true" />
                    <div className={styles.text}>
                        <b>Нові вільні слоти:</b> <span className={styles.mono}>{formatFreshSlots(monitor.lastFresh)}</span>
                    </div>
                    <button type="button" className={styles.action} onClick={() => openBooking()}>
                        Відкрити чернетку
                    </button>
                    <button type="button" className={styles.close} aria-label="Закрити" onClick={() => setDismissed(monitor.lastFresh)}>
                        ×
                    </button>
                </div>
            )}
        </div>
    );
}
