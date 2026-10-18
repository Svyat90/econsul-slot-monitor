import { useState } from 'react';
import { Section } from './Section.tsx';
import styles from './SettingsView.module.css';
import { draftHint } from './model/hints.ts';
import { useExtensionState, useAppServices, useNowSeconds } from '@/hooks/use-app-services.ts';

export function BookingSection() {
    const { extensionLink } = useAppServices();
    const extension = useExtensionState();
    const nowMs = useNowSeconds() * 1000;
    const [url, setUrl] = useState(extension.draft?.url ?? '');
    const hint = draftHint(url, extension.draft, nowMs);

    return (
        <Section title="Бронювання">
            <label className={styles.field}>
                <span className={styles.label}>Чернетка заявки</span>
                <input
                    type="text"
                    className={`${styles.control} ${styles.mono}`}
                    placeholder="https://e-consul.gov.ua/tasks/…"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onBlur={() => extensionLink.setDraftUrl(url.trim())}
                />
            </label>
            <div className={hint.tone === 'error' ? styles.hintError : styles.hint}>{hint.text}</div>
            <label className={styles.check}>
                <input
                    type="checkbox"
                    checked={extension.autoBook}
                    disabled={!extension.connected}
                    onChange={(event) => extensionLink.setAutoBook(event.target.checked)}
                />
                <span>
                    <strong>Бронювати автоматично.</strong> Розширення вибирає новий слот у чернетці й саме натискає «Підтвердити». Вимкнено — слот
                    вибирається, «Підтвердити» натискаєте ви.
                    {!extension.connected && ' Потрібне розширення.'}
                </span>
            </label>
            <label className={styles.check}>
                <input
                    type="checkbox"
                    checked={extension.aggressiveBook}
                    disabled={!extension.connected || !extension.autoBook}
                    onChange={(event) => extensionLink.setDraftSettings({ aggressiveBook: event.target.checked })}
                />
                <span>
                    <strong>Агресивне бронювання.</strong> Без ліміту 12 натискань на годину: одне «Підтвердити» на слот і одразу наступний; слот, що
                    не забронювався, пропускається 5 хв, нові слоти — першими. Вимикається само, коли сесія закінчується.
                    {!extension.connected ? ' Потрібне розширення.' : !extension.autoBook && ' Потрібне автоматичне бронювання.'}
                </span>
            </label>
            <label className={styles.check}>
                <input
                    type="checkbox"
                    checked={extension.autoDraft}
                    disabled={!extension.connected}
                    onChange={(event) => extensionLink.setDraftSettings({ autoDraft: event.target.checked })}
                />
                <span>
                    <strong>Створювати чернетку автоматично.</strong> Після входу на e-consul, якщо чернетки немає, вона прострочена чи сайт її
                    видалив, розширення саме проходить кроки 1–3 з установою й послугою звідси.
                    {!extension.connected && ' Потрібне розширення.'}
                </span>
            </label>
            <label className={styles.check}>
                <input
                    type="checkbox"
                    checked={extension.autoMonitor}
                    disabled={!extension.connected}
                    onChange={(event) => extensionLink.setDraftSettings({ autoMonitor: event.target.checked })}
                />
                <span>
                    <strong>Запускати моніторинг після входу.</strong> Коли ви входите на e-consul, моніторинг стартує сам, якщо він не працює.
                    {!extension.connected && ' Потрібне розширення.'}
                </span>
            </label>
            <div className={styles.alarm}>
                <div className={styles.alarmRow}>
                    <input
                        type="checkbox"
                        id="alarm-enabled"
                        checked={extension.alarmEnabled}
                        disabled={!extension.connected}
                        onChange={(event) => extensionLink.setDraftSettings({ alarmEnabled: event.target.checked })}
                    />
                    <label htmlFor="alarm-enabled">
                        <strong>Будильник:</strong> нагадати за
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={60}
                        step={1}
                        aria-label="Хвилин до відкриття"
                        className={`${styles.control} ${styles.mono} ${styles.leadInput}`}
                        key={extension.alarmLeadMin}
                        defaultValue={extension.alarmLeadMin}
                        disabled={!extension.connected || !extension.alarmEnabled}
                        onBlur={(event) => {
                            const minutes = Math.round(Number(event.target.value));
                            if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 && minutes !== extension.alarmLeadMin) {
                                extensionLink.setDraftSettings({ alarmLeadMin: minutes });
                            } else event.target.value = String(extension.alarmLeadMin);
                        }}
                    />
                    <span>хв до відкриття нових днів поточної установи</span>
                </div>
                <div className={`${styles.hint} ${styles.alarmHint}`}>
                    Звук і сповіщення: увійти на e-consul, якщо сесії немає, або запустити моніторинг, якщо він не працює. Недійсну чи не підхоплену
                    застосунком чернетку розширення замінює свіжою. Коли все гаразд — тихо.
                </div>
            </div>
        </Section>
    );
}
