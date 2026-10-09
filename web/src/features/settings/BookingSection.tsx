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
        </Section>
    );
}
