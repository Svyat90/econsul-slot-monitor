import { Fragment, type ReactNode } from 'react';
import { useAppServices } from '@/hooks/use-app-services.ts';
import { dayHeading, dayKey } from './format.ts';
import styles from './LogTable.module.css';

export type LogListItem = { key: string; at: string; row: ReactNode };

// Rows newest first, with a heading at every change of the local day
export function LogList({ items, leading }: { items: LogListItem[]; leading?: ReactNode }) {
    const { clock } = useAppServices();
    const nowMs = clock.now();
    const out: ReactNode[] = [];
    let lastDay = '';
    for (const item of items) {
        const day = dayKey(item.at);
        if (day !== lastDay) {
            out.push(
                <li key={`day-${day}`} className={styles.day} role="presentation">
                    {dayHeading(item.at, nowMs)}
                </li>,
            );
            lastDay = day;
        }
        out.push(<Fragment key={item.key}>{item.row}</Fragment>);
    }
    return (
        <ul className={styles.list}>
            {leading}
            {out}
        </ul>
    );
}
