// Pure model of the check log's pager: which page buttons to show and which range of rows is on screen.
export const PAGE_SIZES = [15, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type PageButton = { kind: 'page'; page: number } | { kind: 'gap' };

export function pageCount(total: number, size: number): number {
    return Math.max(1, Math.ceil(total / size));
}

// First, last and the neighbours of the current page, with a gap where pages are skipped
export function pageButtons(page: number, pages: number): PageButton[] {
    const out: PageButton[] = [];
    let previous = 0;
    for (let p = 1; p <= pages; p++) {
        if (p !== 1 && p !== pages && Math.abs(p - page) > 1) continue;
        if (previous && p - previous > 1) out.push({ kind: 'gap' });
        out.push({ kind: 'page', page: p });
        previous = p;
    }
    return out;
}

// "26–50 з 162"; no rows at all gives "0 записів"
export function rangeLabel(page: number, size: number, shown: number, total: number): string {
    if (total === 0 || shown === 0) return '0 записів';
    const from = (page - 1) * size + 1;
    return `${from}–${from + shown - 1} з ${total}`;
}
