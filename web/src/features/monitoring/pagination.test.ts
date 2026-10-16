import { pageButtons, pageCount, rangeLabel } from './pagination.ts';

const labels = (page: number, pages: number) => pageButtons(page, pages).map((b) => (b.kind === 'gap' ? '…' : String(b.page))).join(' ');

describe('pagination', () => {
    it('counts at least one page', () => {
        expect(pageCount(0, 25)).toBe(1);
        expect(pageCount(25, 25)).toBe(1);
        expect(pageCount(26, 25)).toBe(2);
    });

    it('shows every page when there are few and a gap when pages are skipped', () => {
        expect(labels(1, 1)).toBe('1');
        expect(labels(2, 4)).toBe('1 2 3 4');
        expect(labels(1, 9)).toBe('1 2 … 9');
        expect(labels(5, 9)).toBe('1 … 4 5 6 … 9');
        expect(labels(9, 9)).toBe('1 … 8 9');
    });

    it('labels the visible range', () => {
        expect(rangeLabel(1, 25, 25, 162)).toBe('1–25 з 162');
        expect(rangeLabel(7, 25, 12, 162)).toBe('151–162 з 162');
        expect(rangeLabel(1, 25, 0, 0)).toBe('0 записів');
    });
});
