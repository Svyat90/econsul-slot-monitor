import styles from './StatusBlock.module.css';
import { useExtensionState, useMonitor, useMonitorState, useNowSeconds } from './use-monitor.ts';

const SESSION_BAR_MS = 24 * 3600_000; // the site's token lives about a day

function formatCountdown(seconds: number): string {
    const left = Math.max(0, seconds);
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

// Same wording as slots.html formatTokenUntil()
function formatTokenUntil(exp: number, nowMs: number): string {
    const date = new Date(exp);
    const time = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    const day = new Date(exp);
    day.setHours(0, 0, 0, 0);
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
    return diff === 0 ? `${time} сьогодні` : diff === 1 ? `${time} завтра` : `${time} ${date.toLocaleDateString('uk-UA')}`;
}

export function StatusBlock() {
    const monitor = useMonitor();
    const state = useMonitorState();
    const extension = useExtensionState();
    const nowSeconds = useNowSeconds();
    const nowMs = nowSeconds * 1000;

    const sessionLost = state.stoppedBy === 'session' || extension.auth?.loggedIn === false;
    const exp = extension.auth?.exp ?? null;
    const sessionActive = !sessionLost && exp !== null && exp > nowMs;
    const noSelection = state.selection === null;

    const headline = state.running
        ? 'Моніторинг працює'
        : state.stoppedBy === 'session'
          ? 'Зупинено: сесія скінчилась'
          : noSelection
            ? 'Не налаштовано'
            : 'Моніторинг зупинено';
    const dotClass = state.running ? styles.dotRunning : state.stoppedBy === 'session' ? styles.dotError : '';

    return (
        <section className={styles.block} aria-label="Стан моніторингу">
            <div className={styles.headline}>
                <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
                <span>{headline}</span>
            </div>
            {state.running && (
                <div>
                    {state.checking ? (
                        'Перевірка…'
                    ) : (
                        <>
                            Наступна перевірка за <span className={styles.mono}>{formatCountdown(Math.ceil(state.nextAt / 1000) - nowSeconds)}</span>
                        </>
                    )}
                </div>
            )}
            {sessionLost && <div className={styles.expired}>Сесія скінчилась</div>}
            {sessionActive && (
                <>
                    <div>Сесія до {formatTokenUntil(exp, nowMs)}</div>
                    <div className={styles.bar} aria-hidden="true">
                        <div className={styles.barFill} style={{ width: `${Math.min(100, ((exp - nowMs) / SESSION_BAR_MS) * 100)}%` }} />
                    </div>
                </>
            )}
            <div className={extension.connected ? styles.ok : styles.missing}>
                <span aria-hidden="true">{extension.connected ? '✓ ' : '✗ '}</span>
                <span>{extension.connected ? 'Розширення підключено' : 'Розширення не підключено'}</span>
            </div>
            {noSelection && <div className={styles.hint}>Виберіть установу в налаштуваннях</div>}
            <div className={styles.actions}>
                {state.running ? (
                    <>
                        <button type="button" className={styles.button} onClick={() => monitor.stop('зупинено користувачем', 'user')}>
                            Зупинити
                        </button>
                        <button
                            type="button"
                            className={`${styles.button} ${styles.primary}`}
                            disabled={state.checking}
                            onClick={() => void monitor.checkNow()}
                        >
                            Перевірити
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className={`${styles.button} ${styles.start}`}
                        disabled={noSelection}
                        onClick={() => void monitor.start()}
                    >
                        Запустити
                    </button>
                )}
            </div>
        </section>
    );
}
