import type { ScheduleRow } from '../contracts/econsul.ts';
import type { Locations } from '../contracts/locations.ts';
import {
  addDays,
  dayOfWeek,
  parseDateFromISO,
  parseTimeFromISO,
  ukrainianDayMap,
  type DateKey,
} from './time.ts';

export type ScheduleDay = {
  dateKey: DateKey;
  consulIpnHash: string;
  startMinutes: number;
  endMinutes: number;
  display: string;
};

export type ScheduleInput = {
  rows: readonly ScheduleRow[];
  serviceCode: string;
  numberWeeks: number;
  // UTC offset of the consulate, e.g. "-05:00"
  offset: string;
  holidays: ReadonlySet<DateKey>;
  // "today" in the browser's time zone (getDateKey(new Date(ms)) in slots.html)
  localDateKey: (ms: number) => DateKey;
};

// "2026-12-25", "2026-11-21..2026-11-27" from locations.json -> Set of YYYY-MM-DD
export function holidaySet(holidays: Locations['holidays'], serviceCode: string): Set<DateKey> {
  const result = new Set<DateKey>();
  const specs = [...holidays.all, ...(holidays.byService[serviceCode] ?? [])];
  specs.forEach((spec) => {
    const [from = '', to] = spec.split('..');
    for (let d = from; d <= (to || from); d = addDays(d, 1)) result.add(d);
  });
  return result;
}

// Rows of the schedule response whose consul provides the selected service
// (the site filters by consularInstitutionService[].code === serviceNumber)
export function serviceScheduleRows(rows: readonly ScheduleRow[], serviceCode: string): ScheduleRow[] {
  return rows.filter((row) =>
    (row.consularInstitutionService ?? []).some((s) => String(s.code) === serviceCode),
  );
}

export function serviceConsulHashes(rows: readonly ScheduleRow[], serviceCode: string): string[] {
  return [...new Set(serviceScheduleRows(rows, serviceCode).map((row) => row.consulIpnHash))];
}

// Every working day of every consul, built the same way as the e-consul calendar:
// a schedule entry with admissionSchedulePeriodDate is valid up to that date,
// an entry without it is valid after the last period ends and up to numberWeeks ahead.
// nowMs lets the release calculation ask which days the site will offer at a later moment
export function buildScheduleDays(input: ScheduleInput, nowMs: number): ScheduleDay[] {
  const { serviceCode, numberWeeks, offset, holidays } = input;
  const today = input.localDateKey(nowMs);
  const firstDay = addDays(today, 1); // startDayMove = 1: booking starts tomorrow
  // Verified against the site (Chicago and Houston): a day is offered while its opening time,
  // in consulate time, is earlier than now + numberWeeks - 1 day. So the last day depends on
  // the current time of day.
  const horizonEnd = nowMs + (numberWeeks * 7 - 1) * 86400000;
  const lastDay = addDays(today, numberWeeks * 7);
  const rowsByConsul: Record<string, ScheduleRow[]> = {};
  serviceScheduleRows(input.rows, serviceCode).forEach((row) => {
    (rowsByConsul[row.consulIpnHash] = rowsByConsul[row.consulIpnHash] || []).push(row);
  });

  const days: ScheduleDay[] = [];
  Object.entries(rowsByConsul).forEach(([consulIpnHash, rows]) => {
    const periodRows = rows
      .filter((r) => r.admissionSchedulePeriodDate)
      .sort((a, b) => (a.admissionSchedulePeriodDate ?? '').localeCompare(b.admissionSchedulePeriodDate ?? ''));
    const ranges: { row: ScheduleRow; from: DateKey; to: DateKey }[] = [];
    let from = firstDay;
    periodRows.forEach((row) => {
      const to = parseDateFromISO(row.admissionSchedulePeriodDate ?? '');
      ranges.push({ row, from, to });
      from = addDays(to, 1);
    });
    rows
      .filter((r) => !r.admissionSchedulePeriodDate)
      .forEach((row) => ranges.push({ row, from, to: lastDay }));

    ranges.forEach(({ row, from, to }) => {
      for (let dateKey = from; dateKey <= to && dateKey <= lastDay; dateKey = addDays(dateKey, 1)) {
        if (holidays.has(dateKey)) continue;
        const weekday = dayOfWeek(dateKey);
        // A weekday can have several reception intervals (New York: Mon 09:00-12:00 and 14:00-17:00)
        (row.receptionCitizensTime ?? [])
          .filter((h) => ukrainianDayMap[h.workingDays.toLowerCase()] === weekday)
          .forEach((hours) => {
            if (Date.parse(`${dateKey}T${hours.workingHoursFrom}:00${offset}`) >= horizonEnd) return;
            days.push({
              dateKey,
              consulIpnHash,
              startMinutes: parseTimeFromISO('0000-00-00T' + hours.workingHoursFrom).totalMinutes,
              endMinutes: parseTimeFromISO('0000-00-00T' + hours.workingHoursTo).totalMinutes,
              display: `${hours.workingHoursFrom}-${hours.workingHoursTo}`,
            });
          });
      }
    });
  });
  return days;
}
