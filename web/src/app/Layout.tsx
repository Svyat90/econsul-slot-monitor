import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Banners, MonitoringBadge, NoSelection } from '@/features/banners/index.ts';
import { StatusBlock } from '@/features/status/index.ts';
import { useMonitorState } from '@/hooks/use-app-services.ts';
import styles from './Layout.module.css';

const iconProps = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
} as const;

const NAV_ITEMS: { to: string; label: string; icon: ReactNode }[] = [
    {
        to: '/slots',
        label: 'Слоти',
        icon: (
            <svg {...iconProps}>
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
        ),
    },
    {
        to: '/monitoring',
        label: 'Моніторинг',
        icon: (
            <svg {...iconProps}>
                <path d="M3 12h4l3-8 4 16 3-8h4" />
            </svg>
        ),
    },
    {
        to: '/settings',
        label: 'Налаштування',
        icon: (
            <svg {...iconProps}>
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="8" cy="17" r="2" />
                <circle cx="10" cy="12" r="2" />
            </svg>
        ),
    },
];

// Pages that cannot show anything until an institution is selected
const NEEDS_SELECTION = ['/slots', '/monitoring'];

export function Layout() {
    const { pathname } = useLocation();
    const noSelection = useMonitorState().selection === null && NEEDS_SELECTION.includes(pathname);
    return (
        <div className={styles.shell}>
            <aside className={styles.sidebar}>
                <div className={styles.brand}>
                    <span className={styles.logo}>
                        <svg {...iconProps} stroke="currentColor">
                            <rect x="3" y="5" width="18" height="16" rx="2" />
                            <path d="M3 10h18M8 3v4M16 3v4" />
                        </svg>
                    </span>
                    <span className={styles.brandName}>Монітор слотів</span>
                </div>
                <StatusBlock />
                <nav aria-label="Розділи" className={styles.nav}>
                    {NAV_ITEMS.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                            {' '}
                            {item.to === '/monitoring' && <MonitoringBadge />}
                        </NavLink>
                    ))}
                </nav>
            </aside>
            <main className={styles.content}>
                <Banners />
                {noSelection ? <NoSelection /> : <Outlet />}
            </main>
        </div>
    );
}
