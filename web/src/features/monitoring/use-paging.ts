import { useState } from 'react';
import { pageCount } from './pagination.ts';

// Page number and page size of one journal. `fit` pulls the page back when fewer entries remain.
export function usePaging(defaultSize: number) {
    const [page, setPage] = useState(1);
    const [size, setSizeState] = useState(defaultSize);
    return {
        page,
        size,
        setPage,
        setSize(next: number) {
            setSizeState(next);
            setPage(1);
        },
        fit(total: number | undefined) {
            if (total === undefined) return;
            const pages = pageCount(total, size);
            if (page > pages) setPage(pages);
        },
    };
}
