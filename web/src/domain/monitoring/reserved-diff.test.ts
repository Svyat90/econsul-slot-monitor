import { describe, expect, it } from 'vitest'
import chicago from '../__fixtures__/econsul/chicago-2026-10-09.json'
import { reservedResponseSchema, type ReservedSlot } from '../contracts/econsul.ts'
import { diffReserved } from './reserved-diff.ts'

const recorded: ReservedSlot[] = reservedResponseSchema.parse(chicago.reserved).data.reservedSlots

const invented: ReservedSlot = {
  consulIpnHash: 'invented-hash',
  receptionDateAndTimeFrom: '2026-10-16T12:00:00.00-06:00',
  receptionDateAndTimeTo: '2026-10-16T12:15:00.00-06:00',
}

describe('diffReserved', () => {
  it('first check (prev === null): nothing is reserved or released', () => {
    expect(diffReserved(null, recorded)).toEqual({ reserved: [], released: [] })
  })

  it('reports an added slot as reserved and a removed one as released', () => {
    const removed = recorded[0]!
    const next = [...recorded.slice(1), invented]
    const r = diffReserved(recorded, next)
    expect(r.reserved).toEqual([invented])
    expect(r.released).toEqual([removed])
  })

  it('identical responses give empty diffs', () => {
    expect(diffReserved(recorded, [...recorded])).toEqual({ reserved: [], released: [] })
  })

  it('counts duplicates in one response once', () => {
    const r = diffReserved(recorded, [...recorded, invented, { ...invented }])
    expect(r.reserved).toEqual([invented])
    expect(r.released).toEqual([])
  })

  it('same time for another consul is a different slot', () => {
    const other = { ...recorded[0]!, consulIpnHash: 'other' }
    expect(diffReserved(recorded, [...recorded, other]).reserved).toEqual([other])
  })
})
