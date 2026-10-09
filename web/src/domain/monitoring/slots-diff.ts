// Free-slot diff between checks and the date-range filter (slots.html runCheck(), inDateRange(),
// formatSlotLines()). Pure: the previous state and the range come in as arguments.

/** 'YYYY-MM-DD HH:MM' */
export type SlotKey = string

export type DateRange = { from: string | null; to: string | null }

export function inDateRange(slotKey: SlotKey, range: DateRange): boolean {
  const { from, to } = range
  const dateKey = slotKey.slice(0, 10)
  return (!from || dateKey >= from) && (!to || dateKey <= to)
}

export function diffFreeSlots(input: {
  free: readonly SlotKey[]
  knownFree: ReadonlySet<SlotKey> | null
  range: DateRange
}): { inRange: SlotKey[]; fresh: SlotKey[]; outside: number; known: Set<SlotKey> } {
  const { free, knownFree, range } = input
  const inRange = free.filter((key) => inDateRange(key, range))
  const fresh = knownFree ? inRange.filter((key) => !knownFree.has(key)) : inRange
  // known holds every free slot, so a slot outside the date range does not count as
  // new later just because the range was widened
  const known = new Set(free)
  const outside = free.length - inRange.length
  return { inRange, fresh, outside, known }
}

export function formatSlotLines(slotKeys: readonly SlotKey[]): string[] {
  const byDate: Record<string, string[]> = {}
  slotKeys.forEach((key) => {
    const [dateKey = '', time = ''] = key.split(' ')
    ;(byDate[dateKey] = byDate[dateKey] || []).push(time)
  })
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, times]) => `${dateKey.split('-').reverse().join('.')}: ${times.sort().join(', ')}`)
}
