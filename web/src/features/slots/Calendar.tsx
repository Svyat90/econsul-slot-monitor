import styles from './Calendar.module.css';
import type { MonthGrid } from './model/month-grid.ts';

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

export type CalendarProps = {
    grid: MonthGrid;
    selected: string | null;
    summary: string;
    onSelect: (dateKey: string) => void;
    onPrevious: () => void;
    onNext: () => void;
};

export function Calendar({ grid, selected, summary, onSelect, onPrevious, onNext }: CalendarProps) {
    return (
        <section className={styles.card} aria-label="Календар">
            <div className={styles.nav}>
                <button type="button" className={styles.navButton} aria-label="Попередній місяць" onClick={onPrevious}>
                    ‹
                </button>
                <h2 className={styles.title}>{grid.title}</h2>
                <button type="button" className={styles.navButton} aria-label="Наступний місяць" onClick={onNext}>
                    ›
                </button>
            </div>
            <div className={styles.grid} aria-hidden="true">
                {WEEKDAYS.map((name) => (
                    <div key={name} className={styles.weekday}>
                        {name}
                    </div>
                ))}
            </div>
            <div className={styles.grid}>
                {grid.cells.map((cell, index) => {
                    if (cell.kind === 'blank') return <div key={`blank-${index}`} className={styles.blank} />;
                    if (cell.kind === 'closed') {
                        return (
                            <div key={cell.dateKey} className={styles.closed}>
                                {cell.day}
                            </div>
                        );
                    }
                    if (cell.kind === 'future') {
                        return (
                            <div key={cell.dateKey} className={styles.future}>
                                <span className={styles.dayNumberMuted}>{cell.day}</span>
                                <span className={styles.note}>ще не відкрито</span>
                            </div>
                        );
                    }
                    const classes = [styles.day, cell.outOfRange ? styles.outOfRange : '', cell.dateKey === selected ? styles.selected : ''].join(' ');
                    return (
                        <button
                            key={cell.dateKey}
                            type="button"
                            className={classes}
                            aria-pressed={cell.dateKey === selected}
                            aria-label={`${cell.day}: ${cell.free > 0 ? `вільних ${cell.free}` : 'немає вільних'}`}
                            onClick={() => onSelect(cell.dateKey)}
                        >
                            <span className={styles.dayNumber}>{cell.day}</span>
                            {cell.free > 0 ? <span className={styles.freeBadge}>{cell.free}</span> : <span className={styles.noFree}>немає</span>}
                            <span className={styles.bar}>
                                <span className={styles.barReserved} style={{ width: `${cell.reservedPercent}%` }} />
                                <span className={styles.barOff} style={{ width: `${cell.nonWorkingPercent}%` }} />
                            </span>
                        </button>
                    );
                })}
            </div>
            <ul className={styles.legend}>
                <li>
                    <span className={styles.freeBadge}>4</span>вільні
                </li>
                <li>
                    <span className={`${styles.swatch} ${styles.swatchReserved}`} />зайняті
                </li>
                <li>
                    <span className={`${styles.swatch} ${styles.swatchOff}`} />неробочі
                </li>
                <li>
                    <span className={styles.swatchFuture} />ще не відкрито (за горизонтом)
                </li>
                <li>
                    <span className={styles.swatchOut} />поза діапазоном дат
                </li>
            </ul>
            <p className={styles.summary}>{summary}</p>
        </section>
    );
}
