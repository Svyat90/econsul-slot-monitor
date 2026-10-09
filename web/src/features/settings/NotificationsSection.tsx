import { useState } from 'react';
import { Section } from './Section.tsx';
import styles from './SettingsView.module.css';
import { notificationStatus } from './model/hints.ts';
import { useAppServices, useExtensionState, useMonitorState } from '@/hooks/use-app-services.ts';

export function NotificationsSection() {
    const { monitor, extensionLink } = useAppServices();
    const { tabTitleMarks } = useMonitorState();
    const extension = useExtensionState();
    // The browser's permission and the audio lock are not in any store: re-read after our own actions
    const [, refresh] = useState(0);
    const permission = notificationStatus(monitor.notificationPermission());
    const audioReady = monitor.audioReady();

    const run = async (action: () => void | Promise<unknown>) => {
        await action();
        refresh((n) => n + 1);
    };
    const test = (label: string, action: () => void | Promise<unknown>, needsExtension = false) => (
        <button type="button" className={styles.button} disabled={needsExtension && !extension.connected} onClick={() => void run(action)}>
            {label}
        </button>
    );

    return (
        <Section title="Сповіщення">
            <div className={styles.status}>
                <span className={`${styles.dot} ${permission.ok ? styles.dotOk : ''}`} aria-hidden="true" />
                <span>{permission.text}</span>
                {monitor.notificationPermission() === 'default' && (
                    <button type="button" className={styles.link} onClick={() => void run(() => monitor.requestNotifications())}>
                        Дозволити
                    </button>
                )}
            </div>
            <div className={styles.status}>
                <span className={`${styles.dot} ${audioReady ? styles.dotOk : ''}`} aria-hidden="true" />
                <span>{audioReady ? 'Звук увімкнено на цій вкладці' : 'Звук на цій вкладці ще не увімкнено: натисніть будь-яку кнопку нижче'}</span>
            </div>
            <label className={styles.check}>
                <input type="checkbox" checked={tabTitleMarks} onChange={(event) => monitor.setTabTitleMarks(event.target.checked)} />
                <span>Позначати заголовок вкладки кольоровою міткою: нові слоти, сесія скінчилась</span>
            </label>
            <div className={styles.label}>Перевірити</div>
            <div className={styles.tests}>
                {test('Сигнал нових слотів', () => monitor.testAlert('slots'))}
                {test('Сигнал «сесія скінчилась»', () => monitor.testAlert('session'))}
                {test('Сигнал «слот вибрано» (розширення)', () => extensionLink.testSound('selected'), true)}
                {test('Вимкнути звук розширення', () => extensionLink.testSound('mute'), true)}
                {test('Тестові слоти в розширення', () => extensionLink.testSound('slots'), true)}
            </div>
            <div className={styles.hint}>Тестові слоти розширення ніколи не бронює.</div>
        </Section>
    );
}
