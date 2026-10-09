import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
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

export function Layout() {
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
                <div className={styles.status}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    <span className={styles.statusText}>Моніторинг зупинено</span>
                </div>
                <nav aria-label="Розділи" className={styles.nav}>
                    {NAV_ITEMS.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </NavLink>
                    ))}
                </nav>
            </aside>
            <main className={styles.content}>
                <Outlet />
            </main>
        </div>
    );
}
