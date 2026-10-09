import styles from './MonitoringBadge.module.css';
import { freshBadge } from './model/banners.ts';
import { useMonitorState } from '@/hooks/use-app-services.ts';

// «2 нові» next to the menu item: how many slots the last check found
export function MonitoringBadge() {
    const count = useMonitorState().lastFresh.length;
    if (count === 0) return null;
    return <span className={styles.badge}>{freshBadge(count)}</span>;
}
