import { describe, expect, it } from 'vitest'
import type { ScheduleRow } from '../contracts/econsul.ts'
import { diffSnapshots, scheduleSnapshot, type SnapshotRow } from './schedule-changes.ts'

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  consulIpnHash: 'abcdef1234567890',
  admissionSchedulePeriodDate: '2026-12-31T00:00:00.000Z',
  receptionCitizensTime: [{ workingDays: 'Пн', workingHoursFrom: '09:00', workingHoursTo: '13:00' }],
  nonWorkingTime: [],
  consularInstitutionService: [{ code: 10 }, { code: 2 }],
  ...over,
})

const snap = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  consul: 'abcdef1234567890',
  period: '2026-12-31',
  services: ['2', '10'],
  hours: ['Пн 09:00-13:00'],
  nonWorking: [],
  ...over,
})

const TODAY = '2026-10-09'

describe('scheduleSnapshot', () => {
  it('normalizes rows: numeric service sort, sorted hours, period date', () => {
    expect(scheduleSnapshot([row()])).toEqual([snap()])
  })

  it('uses null period for open-ended schedules', () => {
    expect(scheduleSnapshot([row({ admissionSchedulePeriodDate: null })])[0]?.period).toBeNull()
  })
})

describe('diffSnapshots', () => {
  it('returns [] for identical snapshots', () => {
    expect(diffSnapshots([snap()], [snap()], TODAY)).toEqual([])
  })

  it('reports added and removed schedule rows', () => {
    expect(diffSnapshots([], [snap()], TODAY)).toEqual([
      'added schedule abcdef12 until 2026-12-31 (Пн 09:00-13:00; services 2, 10)',
    ])
    expect(diffSnapshots([snap()], [], TODAY)).toEqual([
      'removed schedule abcdef12 until 2026-12-31 (Пн 09:00-13:00)',
    ])
  })

  it('reports changed hours', () => {
    expect(diffSnapshots([snap()], [snap({ hours: ['Пн 10:00-14:00'] })], TODAY)).toEqual([
      'abcdef12 until 2026-12-31: hours Пн 09:00-13:00 → Пн 10:00-14:00',
    ])
  })

  it('reports services with + and -', () => {
    expect(diffSnapshots([snap()], [snap({ services: ['2', '5'] })], TODAY)).toEqual([
      'abcdef12 until 2026-12-31: services +5 -10',
    ])
  })

  it('ignores removed non-working periods that are already in the past', () => {
    const past = '2026-09-01T09:00:00|2026-09-01T13:00:00'
    const future = '2026-11-02T09:00:00|2026-11-02T13:00:00'
    expect(diffSnapshots([snap({ nonWorking: [past] })], [snap()], TODAY)).toEqual([])
    expect(diffSnapshots([snap({ nonWorking: [future] })], [snap()], TODAY)).toEqual([
      'abcdef12 until 2026-12-31: -1 non-working period(s): 2026-11-02 09:00-13:00',
    ])
  })

  it('truncates long non-working lists to three items', () => {
    const items = [1, 2, 3, 4].map((d) => `2026-11-0${d}T09:00:00|2026-11-0${d}T10:00:00`)
    expect(diffSnapshots([snap()], [snap({ nonWorking: items })], TODAY)).toEqual([
      'abcdef12 until 2026-12-31: +4 non-working period(s): 2026-11-01 09:00-10:00, 2026-11-02 09:00-10:00, 2026-11-03 09:00-10:00, …(+1)',
    ])
  })
})
