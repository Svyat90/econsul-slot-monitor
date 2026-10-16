// What the Slots page draws, in a form that is cheap to store: the reserved slots of a service
// as a list of consuls plus [consul index, from, to] triples, and a content hash to tell
// whether anything changed since the last snapshot. Pure: the hash and the packing only.
import type { ReservedSlot } from '../contracts/econsul.ts';

export type CompactReserved = { consuls: string[]; slots: [number, string, string][] };

// Sorted, so the same set of reserved slots always packs (and hashes) the same way
export function compactReserved(reserved: readonly ReservedSlot[]): CompactReserved {
  const consuls = [...new Set(reserved.map((slot) => slot.consulIpnHash))].sort();
  const index = new Map(consuls.map((hash, i) => [hash, i]));
  const slots = reserved
    .map((slot): [number, string, string] => [
      index.get(slot.consulIpnHash) ?? 0,
      slot.receptionDateAndTimeFrom,
      slot.receptionDateAndTimeTo,
    ])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return { consuls, slots };
}

export function expandReserved(compact: CompactReserved): ReservedSlot[] {
  return compact.slots.flatMap(([consul, from, to]) => {
    const consulIpnHash = compact.consuls[consul];
    return consulIpnHash === undefined
      ? []
      : [{ consulIpnHash, receptionDateAndTimeFrom: from, receptionDateAndTimeTo: to }];
  });
}

// Two FNV-1a passes over the text (different seeds), 16 hex digits: not a security hash, only
// "did it change"
export function contentHash(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
