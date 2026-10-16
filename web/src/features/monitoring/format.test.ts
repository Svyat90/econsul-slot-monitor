import { describe, expect, it } from 'vitest';
import { slotLabelAt } from './format.ts';

describe('slotLabelAt', () => {
    it('shows the stored UTC instant as the consulate wall time', () => {
        expect(slotLabelAt('2027-04-07T14:00:00.000Z', '-05:00')).toBe('07.04 09:00');
        expect(slotLabelAt('2027-04-07T23:30:00.000Z', '+03:00')).toBe('08.04 02:30');
    });
});
