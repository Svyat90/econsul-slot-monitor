import styles from './MonitoringBadge.module.css';
import { freshBadge } from './model/banners.ts';
import { useMonitorState } from '@/hooks/use-app-services.ts';

// The number of fresh slots next to the menu item: how many slots the last check found
export function MonitoringBadge() {
    const count = useMonitorState().lastFresh.length;
    if (count === 0) return null;
    return <span className={styles.badge} aria-label={freshBadge(count)}>
            {count}
        </span>;
}
