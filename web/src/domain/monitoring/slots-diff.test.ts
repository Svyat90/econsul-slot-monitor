import { describe, expect, it } from 'vitest'
import { diffFreeSlots, formatSlotLines, inDateRange } from './slots-diff.ts'

const noRange = { from: null, to: null }

describe('inDateRange', () => {
  it('treats open bounds as unbounded', () => {
    expect(inDateRange('2026-10-16 10:30', noRange)).toBe(true)
  })

  it('includes both bounds and excludes outside days', () => {
    const range = { from: '2026-10-16', to: '2026-10-18' }
    expect(inDateRange('2026-10-15 23:59', range)).toBe(false)
    expect(inDateRange('2026-10-16 08:00', range)).toBe(true)
    expect(inDateRange('2026-10-18 17:00', range)).toBe(true)
    expect(inDateRange('2026-10-19 08:00', range)).toBe(false)
  })
})

describe('diffFreeSlots', () => {
  const free = ['2026-10-16 10:00', '2026-10-20 11:00', '2026-10-25 09:00']

  it('first check: every in-range slot is new', () => {
    const r = diffFreeSlots({ free, knownFree: null, range: { from: null, to: '2026-10-21' } })
    expect(r.inRange).toEqual(['2026-10-16 10:00', '2026-10-20 11:00'])
    expect(r.fresh).toEqual(r.inRange)
    expect(r.outside).toBe(1)
    expect([...r.known]).toEqual(free)
  })

  it('a slot outside the range is not new after widening the range', () => {
    const first = diffFreeSlots({ free, knownFree: null, range: { from: null, to: '2026-10-21' } })
    const second = diffFreeSlots({ free, knownFree: first.known, range: noRange })
    expect(second.inRange).toEqual(free)
    expect(second.fresh).toEqual([])
    expect(second.outside).toBe(0)
  })

  it('a slot that vanished and came back is new again', () => {
    const a = diffFreeSlots({ free, knownFree: null, range: noRange })
    const b = diffFreeSlots({ free: free.slice(1), knownFree: a.known, range: noRange })
    const c = diffFreeSlots({ free, knownFree: b.known, range: noRange })
    expect(c.fresh).toEqual(['2026-10-16 10:00'])
  })
})

describe('formatSlotLines', () => {
  it('groups by date, sorts dates and times, formats DD.MM.YYYY', () => {
    expect(formatSlotLines(['2026-10-20 11:00', '2026-10-16 10:30', '2026-10-16 09:00'])).toEqual([
      '16.10.2026: 09:00, 10:30',
      '20.10.2026: 11:00',
    ])
  })
})
