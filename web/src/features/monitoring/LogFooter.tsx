import { useId } from 'react';
import styles from './LogTable.module.css';
import { PAGE_SIZES, pageButtons } from './pagination.ts';

type Props = {
    page: number;
    pages: number;
    size: number;
    range: string;
    total: number;
    hideUpTo?: number; // fewer entries than this: nothing to page, the footer is not drawn
    onPage: (page: number) => void;
    onSize: (size: number) => void;
};

// Under a journal: rows per page, the visible range and the numbered pages
export function LogFooter({ page, pages, size, range, total, hideUpTo, onPage, onSize }: Props) {
    const selectId = useId();
    if (hideUpTo !== undefined && total <= hideUpTo) return null;
    return (
        <div className={styles.footer}>
            <div className={styles.size}>
                <label htmlFor={selectId}>Рядків на сторінці</label>
                <span className={styles.selectWrap}>
                    <select id={selectId} value={size} onChange={(event) => onSize(Number(event.target.value))}>
                        {PAGE_SIZES.map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </span>
            </div>
            <span className={styles.range} aria-live="polite">
                {range}
            </span>
            {pages > 1 && (
                <nav className={styles.pager} aria-label="Сторінки журналу">
                    <button type="button" aria-label="Попередня сторінка" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                        ←
                    </button>
                    {pageButtons(page, pages).map((button, i) =>
                        button.kind === 'gap' ? (
                            <span key={`gap-${i}`} className={styles.gap} aria-hidden="true">
                                …
                            </span>
                        ) : (
                            <button
                                key={button.page}
                                type="button"
                                aria-label={`Сторінка ${button.page}`}
                                aria-current={button.page === page ? 'page' : undefined}
                                onClick={() => onPage(button.page)}
                            >
                                {button.page}
                            </button>
                        ),
                    )}
                    <button type="button" aria-label="Наступна сторінка" disabled={page >= pages} onClick={() => onPage(page + 1)}>
                        →
                    </button>
                </nav>
            )}
        </div>
    );
}
