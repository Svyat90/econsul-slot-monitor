import { useState, type FormEvent } from 'react';
import { Section } from './Section.tsx';
import styles from './SettingsView.module.css';
import { tokenLeft } from './model/hints.ts';
import { useExtensionState, useMonitor, useMonitorState, useNowSeconds } from '@/hooks/use-app-services.ts';

const SESSION_BAR_MS = 24 * 3600_000; // the site's token lives about a day

export function SessionSection() {
    const monitor = useMonitor();
    const state = useMonitorState();
    const extension = useExtensionState();
    const nowMs = useNowSeconds() * 1000;
    const [manual, setManual] = useState(false);
    const [token, setToken] = useState('');

    const exp = extension.auth?.exp ?? null;
    const left = exp !== null && extension.auth?.loggedIn !== false ? tokenLeft(exp, nowMs) : null;
    const lost = state.stoppedBy === 'session' || extension.auth?.loggedIn === false || (exp !== null && left === null);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const value = token.trim();
        if (!value) return;
        monitor.setToken(value, 'manual');
        setToken(''); // the token is never shown again
        setManual(false);
    };

    const headline = left
        ? `Ви увійшли на e-consul · токен ще ${left}`
        : lost
          ? 'Сесія скінчилась'
          : state.hasToken
            ? 'Токен задано'
            : 'Немає токена';

    return (
        <Section title="Сесія">
            <div className={styles.sessionHead}>
                <span className={`${styles.dot} ${left ? styles.dotOk : lost ? styles.dotError : ''}`} aria-hidden="true" />
                <span>{headline}</span>
            </div>
            {left && exp !== null && (
                <div className={styles.bar} aria-hidden="true">
                    <div className={styles.barFill} style={{ width: `${Math.min(100, ((exp - nowMs) / SESSION_BAR_MS) * 100)}%` }} />
                </div>
            )}
            <div className={styles.hint}>
                {extension.connected ? 'Токен приходить з розширення. ' : 'Розширення не підключено. '}
                {!manual && (
                    <button type="button" className={styles.link} onClick={() => setManual(true)}>
                        Ввести вручну
                    </button>
                )}
            </div>
            {manual && (
                <form className={styles.tokenForm} onSubmit={submit}>
                    <label className={styles.field}>
                        <span className={styles.label}>Токен сесії</span>
                        <input
                            type="password"
                            className={styles.control}
                            autoComplete="off"
                            spellCheck={false}
                            value={token}
                            onChange={(event) => setToken(event.target.value)}
                        />
                    </label>
                    <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={!token.trim()}>
                        Зберегти токен
                    </button>
                </form>
            )}
        </Section>
    );
}
