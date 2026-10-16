import { describe, expect, it } from 'vitest';
import { compactReserved, contentHash, expandReserved } from './calendar-snapshot.ts';

const slot = (hash: string, from: string, to: string) => ({
  consulIpnHash: hash,
  receptionDateAndTimeFrom: from,
  receptionDateAndTimeTo: to,
});
const A = slot('hash-a', '2026-10-19T09:10:00.00-05:00', '2026-10-19T09:20:00.00-05:00');
const B = slot('hash-b', '2026-10-19T09:00:00.00-05:00', '2026-10-19T09:10:00.00-05:00');
const C = slot('hash-a', '2026-10-19T09:00:00.00-05:00', '2026-10-19T09:10:00.00-05:00');

describe('compactReserved', () => {
  it('writes every consul hash once and points the slots at it', () => {
    const compact = compactReserved([A, B, C]);
    expect(compact.consuls).toEqual(['hash-a', 'hash-b']);
    expect(compact.slots).toEqual([
      [0, '2026-10-19T09:00:00.00-05:00', '2026-10-19T09:10:00.00-05:00'],
      [0, '2026-10-19T09:10:00.00-05:00', '2026-10-19T09:20:00.00-05:00'],
      [1, '2026-10-19T09:00:00.00-05:00', '2026-10-19T09:10:00.00-05:00'],
    ]);
  });
  it('is the same for any order of the input, so the hash only moves with the content', () => {
    expect(contentHash(compactReserved([A, B, C]))).toBe(contentHash(compactReserved([C, A, B])));
    expect(contentHash(compactReserved([A, B, C]))).not.toBe(contentHash(compactReserved([A, B])));
  });
  it('expands back to the same slots', () => {
    const back = expandReserved(compactReserved([A, B, C]));
    expect(back).toHaveLength(3);
    expect(back).toEqual(expect.arrayContaining([A, B, C]));
  });
  it('drops a slot that points at a missing consul and handles no slots', () => {
    expect(expandReserved({ consuls: ['x'], slots: [[3, 'f', 't']] })).toEqual([]);
    expect(compactReserved([])).toEqual({ consuls: [], slots: [] });
  });
});

describe('contentHash', () => {
  it('is 16 hex digits and differs for different content', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash([])).toBe(contentHash([]));
  });
});
