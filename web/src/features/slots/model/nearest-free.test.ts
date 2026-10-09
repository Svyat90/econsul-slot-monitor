import { describe, expect, it } from 'vitest';
import { buildNearestFree } from './nearest-free.ts';

const keys = ['2027-04-01 09:10', '2027-03-17 09:50', '2027-03-17 10:20', '2027-03-30 09:50', '2027-03-31 09:50', '2027-04-02 09:00', '2027-03-10 09:00'];

describe('buildNearestFree', () => {
    it('groups by day, sorts, filters by range and takes four days', () => {
        const view = buildNearestFree(keys, { from: '2027-03-15', to: '2027-04-02' });
        expect(view.rows).toEqual([
            { dateKey: '2027-03-17', label: 'ср, 17.03', times: ['09:50', '10:20'] },
            { dateKey: '2027-03-30', label: 'вт, 30.03', times: ['09:50'] },
            { dateKey: '2027-03-31', label: 'ср, 31.03', times: ['09:50'] },
            { dateKey: '2027-04-01', label: 'чт, 01.04', times: ['09:10'] },
        ]);
        expect(view.rangeLabel).toBe('у діапазоні 15.03–02.04');
    });

    it('is empty when nothing is in range', () => {
        expect(buildNearestFree(keys, { from: '2028-01-01', to: null }).rows).toEqual([]);
    });

    it('labels open ranges', () => {
        expect(buildNearestFree([], { from: '2027-03-15', to: null }).rangeLabel).toBe('від 15.03');
        expect(buildNearestFree([], { from: null, to: '2027-04-01' }).rangeLabel).toBe('до 01.04');
        expect(buildNearestFree([], { from: null, to: null }).rangeLabel).toBe('');
    });
});
