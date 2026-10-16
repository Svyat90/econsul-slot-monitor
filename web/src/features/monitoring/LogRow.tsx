import styles from './LogTable.module.css';

export type Dot = 'quiet' | 'new' | 'error' | 'event' | 'pending';
export type Tag = { text: string; tone?: 'fast' | 'danger' | 'pending' };
export type RowProps = {
    time: string;
    dot: Dot;
    tone?: 'new' | 'error' | 'pending';
    title: string;
    slots?: string;
    slotsMuted?: boolean; // a slot that is not good news (taken, not freed)
    note?: string;
    details?: string[]; // lines under the title, one per entry
    tags?: Tag[];
    duration?: string; // omit it and the column is not drawn
};

// One compact line of a journal: time, state dot, what happened, tags, duration
export function LogRow({ time, dot, tone, title, slots, slotsMuted, note, details, tags = [], duration }: RowProps) {
    const classes = [styles.row, tone ? styles[tone] : '', duration === undefined ? styles.noDuration : ''].join(' ');
    return (
        <li className={classes}>
            <span className={styles.time}>{time}</span>
            <span className={`${styles.dot} ${styles[`dot-${dot}`]}`} aria-hidden="true" />
            <div className={styles.what}>
                <strong>{title}</strong>
                {slots && <span className={`${styles.slots} ${slotsMuted ? styles.slotsMuted : ''}`}>{slots}</span>}
                {note && <span className={styles.note}>{note}</span>}
                {details?.map((line, i) => (
                    <span key={i} className={styles.details}>
                        {line}
                    </span>
                ))}
            </div>
            <span className={styles.tags}>
                {tags.map((tag) => (
                    <span key={tag.text} className={`${styles.tag} ${tag.tone ? styles[tag.tone] : ''}`}>
                        {tag.text}
                    </span>
                ))}
            </span>
            {duration !== undefined && <span className={styles.duration}>{duration}</span>}
        </li>
    );
}
