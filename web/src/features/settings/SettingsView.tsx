import { BookingSection } from './BookingSection.tsx';
import { ChecksSection } from './ChecksSection.tsx';
import { NotificationsSection } from './NotificationsSection.tsx';
import { SearchSection } from './SearchSection.tsx';
import { SessionSection } from './SessionSection.tsx';
import styles from './SettingsView.module.css';
import { useMonitorState } from '@/hooks/use-app-services.ts';

export function SettingsView() {
    const { selection, locations } = useMonitorState();
    const service = selection ? locations?.services[selection.serviceCode] : undefined;

    return (
        <div className={styles.page}>
            <header className={styles.head}>
                <h1 className={styles.title}>Налаштування</h1>
                {selection && (
                    <span className={styles.subtitle}>
                        {selection.institution.name}
                        {service && ` · ${service}`}
                    </span>
                )}
            </header>
            <p className={styles.lead}>Зміни зберігаються одразу. Моніторинг підхоплює їх з наступної перевірки.</p>
            <div className={styles.grid}>
                <div className={styles.column}>
                    <SearchSection />
                    <BookingSection />
                </div>
                <div className={styles.column}>
                    <SessionSection />
                    <ChecksSection />
                    <NotificationsSection />
                </div>
            </div>
        </div>
    );
}
