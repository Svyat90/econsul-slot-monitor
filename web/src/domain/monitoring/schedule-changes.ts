// Schedule change detection (slots.html scheduleSnapshot(), snapshotKey(), describeNonWorking(),
// diffSnapshots()). Pure: "today" comes in as an argument. The change texts are English on purpose -
// the schedule log and the database store them as they are.
import type { ScheduleRow } from '../contracts/econsul.ts'
import { parseDateFromISO, type DateKey } from '../slots/time.ts'

export type SnapshotRow = {
  consul: string
  period: string | null
  services: string[]
  hours: string[]
  nonWorking: string[]
}

export function scheduleSnapshot(rows: readonly ScheduleRow[]): SnapshotRow[] {
  return rows.map((row) => ({
    consul: row.consulIpnHash,
    period: row.admissionSchedulePeriodDate ? parseDateFromISO(row.admissionSchedulePeriodDate) : null,
    services: (row.consularInstitutionService || [])
      .map((s) => String(s.code))
      .sort((a, b) => Number(a) - Number(b)),
    hours: (row.receptionCitizensTime || [])
      .map((h) => `${h.workingDays} ${h.workingHoursFrom}-${h.workingHoursTo}`)
      .sort(),
    nonWorking: (row.nonWorkingTime || [])
      .map((z) => `${z.notWorkingDateAndHoursFrom}|${z.notWorkingDateAndHoursTo}`)
      .sort(),
  }))
}

function snapshotKey(row: SnapshotRow): string {
  return `${row.consul.slice(0, 8)} ${row.period ? 'until ' + row.period : 'open-ended'}`
}

function describeNonWorking(items: readonly string[]): string {
  const shown = items.slice(0, 3).map((item) => {
    const [from = '', to = ''] = item.split('|')
    return `${parseDateFromISO(from)} ${from.substring(11, 16)}-${to.substring(11, 16)}`
  })
  return shown.join(', ') + (items.length > 3 ? `, …(+${items.length - 3})` : '')
}

// Human-readable differences; non-working periods that are already in the past are ignored
export function diffSnapshots(
  prevRows: readonly SnapshotRow[],
  nextRows: readonly SnapshotRow[],
  todayKey: DateKey,
): string[] {
  const index = (rows: readonly SnapshotRow[]) =>
    new Map(rows.map((row) => [snapshotKey(row), row] as const))
  const prev = index(prevRows)
  const next = index(nextRows)
  const changes: string[] = []
  const added = (x: readonly string[], y: readonly string[]) => y.filter((item) => !x.includes(item))
  for (const [key, a] of prev) {
    if (!next.has(key)) changes.push(`removed schedule ${key} (${a.hours.join('; ')})`)
  }
  for (const [key, b] of next) {
    if (!prev.has(key)) {
      changes.push(`added schedule ${key} (${b.hours.join('; ')}; services ${b.services.join(', ')})`)
    }
  }
  for (const [key, b] of next) {
    const a = prev.get(key)
    if (!a) continue
    if (a.hours.join() !== b.hours.join()) {
      changes.push(`${key}: hours ${a.hours.join('; ')} → ${b.hours.join('; ')}`)
    }
    const svcAdded = added(a.services, b.services)
    const svcRemoved = added(b.services, a.services)
    if (svcAdded.length || svcRemoved.length) {
      changes.push(
        `${key}: services` +
          (svcAdded.length ? ` +${svcAdded.join(', +')}` : '') +
          (svcRemoved.length ? ` -${svcRemoved.join(', -')}` : ''),
      )
    }
    const nwAdded = added(a.nonWorking, b.nonWorking)
    const nwRemoved = added(b.nonWorking, a.nonWorking).filter((item) => parseDateFromISO(item) >= todayKey)
    if (nwAdded.length) {
      changes.push(`${key}: +${nwAdded.length} non-working period(s): ${describeNonWorking(nwAdded)}`)
    }
    if (nwRemoved.length) {
      changes.push(`${key}: -${nwRemoved.length} non-working period(s): ${describeNonWorking(nwRemoved)}`)
    }
  }
  return changes
}
