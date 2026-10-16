import { useState } from 'react';
import styles from './Banners.module.css';
import { alarmActive, draftBanner, formatClock, formatFreshSlots, sessionBanner } from './model/banners.ts';
import { useAppServices, useExtensionState, useMonitorState, useNowSeconds } from '@/hooks/use-app-services.ts';

// Global banners above the page: the session (login / about to expire) and fresh free slots
export function Banners() {
    const { extensionLink, openBooking, monitor: monitorService } = useAppServices();
    const monitor = useMonitorState();
    const extension = useExtensionState();
    const nowMs = useNowSeconds() * 1000;
    // The banner is dismissed for one batch of fresh slots; the next batch brings it back
    const [dismissed, setDismissed] = useState<readonly string[] | null>(null);

    const session = sessionBanner(extension, monitor.stoppedBy, nowMs);
    const draft = draftBanner(extension, monitor.running, nowMs);
    const showFresh = monitor.lastFresh.length > 0 && dismissed !== monitor.lastFresh;
    const alarm = alarmActive(extension.alarm, nowMs) ? extension.alarm : null;
    // Logged in but not monitoring just before the opening: remind (not logged in: the session banner speaks)
    const startReminder = alarm !== null && !monitor.running && session?.kind !== 'login';

    if (!session && !draft && !showFresh && !startReminder) return null;
    return (
        <div className={styles.stack}>
            {session && (
                <div className={`${styles.banner} ${session.kind === 'login' ? styles.danger : styles.warn}`} role="alert">
                    <span className={styles.dot} aria-hidden="true" />
                    <div className={styles.text}>
                        {session.kind === 'login' ? (
                            <>
                                <b>Увійдіть на e-consul.</b> {session.resumes ? 'Моніторинг продовжиться сам.' : 'Токен прийде сюди сам.'}
                                {alarm && <> Нові дні відкриваються о {formatClock(alarm.at)}.</>}
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
            {startReminder && alarm && (
                <div className={`${styles.banner} ${styles.danger}`} role="alert">
                    <span className={styles.dot} aria-hidden="true" />
                    <div className={styles.text}>
                        <b>Скоро відкриття о {formatClock(alarm.at)}.</b> Моніторинг не запущено.
                    </div>
                    <button type="button" className={styles.action} onClick={() => void monitorService.start()}>
                        Запустити
                    </button>
                </div>
            )}
            {draft && (
                <div className={`${styles.banner} ${draft.kind === 'creating' ? styles.info : styles.danger}`} role="alert">
                    <span className={styles.dot} aria-hidden="true" />
                    <div className={styles.text}>
                        {draft.kind === 'creating' && (
                            <>
                                <b>Створюю чернетку…</b> Розширення проходить кроки 1–3 на e-consul з налаштувань установи й послуги.
                            </>
                        )}
                        {draft.kind === 'failed' && (
                            <>
                                <b>Чернетку не створено.</b> {draft.text}
                            </>
                        )}
                        {draft.kind === 'missing' && (
                            <>
                                <b>Немає чернетки.</b> Без неї розширення не вибере слот, коли він з'явиться.
                            </>
                        )}
                        {draft.kind === 'expired' && (
                            <>
                                <b>Чернетка прострочена</b> (сайт видалив її о {formatClock(draft.at)}). Без неї розширення не вибере слот.
                            </>
                        )}
                    </div>
                    {draft.kind !== 'creating' && (
                        <button type="button" className={styles.action} onClick={() => extensionLink.createDraft()}>
                            Створити чернетку
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
