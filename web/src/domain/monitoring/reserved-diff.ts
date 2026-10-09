// Reserved / released slots between two checks (IDEA-004, new - not in slots.html).
// Pure: the previous response comes in as an argument.
import type { ReservedSlot } from '../contracts/econsul.ts'

function slotKey(slot: ReservedSlot): string {
  return `${slot.consulIpnHash}|${slot.receptionDateAndTimeFrom}|${slot.receptionDateAndTimeTo}`
}

/** One entry per key: the site may repeat a slot within a response. */
function indexByKey(slots: readonly ReservedSlot[]): Map<string, ReservedSlot> {
  const byKey = new Map<string, ReservedSlot>()
  for (const slot of slots) {
    const key = slotKey(slot)
    if (!byKey.has(key)) byKey.set(key, slot)
  }
  return byKey
}

export function diffReserved(
  prev: readonly ReservedSlot[] | null,
  next: readonly ReservedSlot[],
): { reserved: ReservedSlot[]; released: ReservedSlot[] } {
  // the first check is a baseline: everything already taken would otherwise look "just reserved"
  if (prev === null) return { reserved: [], released: [] }
  const before = indexByKey(prev)
  const after = indexByKey(next)
  return {
    reserved: [...after].filter(([key]) => !before.has(key)).map(([, slot]) => slot),
    released: [...before].filter(([key]) => !after.has(key)).map(([, slot]) => slot),
  }
}
