import styles from './DayPanel.module.css';
import { daySummary, type DayModel, type RecentReservation } from './model/day-tiles.ts';

const WEEKDAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', "п'ятниця", 'субота'];
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

// "середа, 31 березня 2027"
export function dayTitle(dateKey: string): string {
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    return `${WEEKDAYS[weekday]}, ${Number(dateKey.slice(8, 10))} ${MONTHS[Number(dateKey.slice(5, 7)) - 1]} ${dateKey.slice(0, 4)}`;
}

const TILE_HINT = { free: 'вільний', reserved: 'зайнятий', nonworking: 'неробочий' } as const;

export type DayPanelProps = {
    day: DayModel | null;
    recent: RecentReservation[];
    draftHint: string;
    onOpenBooking: () => void;
};

export function DayPanel({ day, recent, draftHint, onOpenBooking }: DayPanelProps) {
    return (
        <section className={styles.card} aria-label="День">
            <div>
                <h2 className={styles.label}>День</h2>
                {day ? (
                    <>
                        <div className={styles.title}>{dayTitle(day.dateKey)}</div>
                        <div className={styles.summary}>{daySummary(day)}</div>
                    </>
                ) : (
                    <div className={styles.summary}>Виберіть день у календарі</div>
                )}
            </div>
            {day && (
                <>
                    <ul className={styles.tiles} aria-label="Слоти дня">
                        {day.tiles.map((tile) => (
                            <li key={tile.time} className={`${styles.tile} ${styles[tile.status]}`} title={TILE_HINT[tile.status]}>
                                {tile.time}
                            </li>
                        ))}
                    </ul>
                    <div className={styles.legend}>
                        <span>синя рамка — вільний</span>
                        <span>сірий закреслений — зайнятий</span>
                        <span>пунктир — неробочий</span>
                    </div>
                    {day.nonWorkingRanges.length > 0 && (
                        <div className={styles.off}>
                            <b>Неробочий час:</b> <span className={styles.mono}>{day.nonWorkingRanges.join(', ')}</span>
                        </div>
                    )}
                    <div className={styles.recent}>
                        <h3 className={styles.label}>Нещодавні резервування</h3>
                        {recent.length === 0 ? (
                            <div className={styles.muted}>За час моніторингу змін не було.</div>
                        ) : (
                            recent.map((r, index) => (
                                <div key={`${r.time}-${index}`} className={styles.recentRow}>
                                    <span className={styles.mono}>{r.time}</span>
                                    <span className={styles.muted}>{r.text}</span>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
            <button type="button" className={styles.open} onClick={onOpenBooking}>
                Відкрити чернетку
            </button>
            <div className={styles.hint}>{draftHint}</div>
        </section>
    );
}
