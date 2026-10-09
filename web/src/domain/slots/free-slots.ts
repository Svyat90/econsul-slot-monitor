import type { ReservedSlot, ScheduleRow } from '../contracts/econsul.ts';
import type { SlotKey } from '../monitoring/slots-diff.ts';
import { serviceScheduleRows, type ScheduleDay } from './schedule-days.ts';
import { minutesToTime, parseDateFromISO, parseTimeFromISO, type DateKey } from './time.ts';

export type Blocking = { consulIpnHash: string; from: string; to: string };

export type FreeSlots = {
  byDate: Record<DateKey, { workingHours: string; windows: { from: string; to: string; durationMinutes: number }[] }>;
  slotConsuls: Record<SlotKey, string[]>;
  keys: SlotKey[];
};

// The site blocks nonWorkingTime from ALL schedule entries of a consul, not only the first one
export function collectNonWorking(rows: readonly ScheduleRow[], serviceCode: string): Blocking[] {
  return serviceScheduleRows(rows, serviceCode).flatMap((row) =>
    (row.nonWorkingTime ?? []).map((slot) => ({
      from: slot.notWorkingDateAndHoursFrom,
      to: slot.notWorkingDateAndHoursTo,
      consulIpnHash: row.consulIpnHash,
    })),
  );
}

// Same check the e-consul web worker runs: the day is cut into slots of serviceTime minutes
// starting at the opening time; a slot is free when it fits before closing time and does not
// overlap any nonWorkingTime / reserved slot of that consul. Times are compared as the
// consulate wall-clock time written in the ISO strings.
export function calculateFreeSlots(input: {
  days: readonly ScheduleDay[];
  nonWorking: readonly Blocking[];
  reserved: readonly ReservedSlot[];
  slotMinutes: number;
}): FreeSlots {
  const { days, nonWorking, reserved, slotMinutes } = input;
  const blockedByConsulDate: Record<string, { start: number; end: number }[]> = {};
  const addBlock = (consulIpnHash: string, fromIso: string, toIso: string) => {
    const key = consulIpnHash + '|' + parseDateFromISO(fromIso);
    (blockedByConsulDate[key] = blockedByConsulDate[key] || []).push({
      start: parseTimeFromISO(fromIso).totalMinutes,
      end: parseTimeFromISO(toIso).totalMinutes,
    });
  };
  nonWorking.forEach((s) => addBlock(s.consulIpnHash, s.from, s.to));
  reserved.forEach((s) => addBlock(s.consulIpnHash, s.receptionDateAndTimeFrom, s.receptionDateAndTimeTo));

  const slotConsuls: Record<SlotKey, string[]> = {};
  const freeByDate: Record<DateKey, { workingHours: Set<string>; starts: Set<number> }> = {};
  days.forEach((day) => {
    const blocks = blockedByConsulDate[day.consulIpnHash + '|' + day.dateKey] || [];
    for (let t = day.startMinutes; t + slotMinutes <= day.endMinutes; t += slotMinutes) {
      if (blocks.some((b) => t + slotMinutes > b.start && t < b.end)) continue;
      const entry = (freeByDate[day.dateKey] = freeByDate[day.dateKey] || {
        workingHours: new Set<string>(),
        starts: new Set<number>(),
      });
      entry.workingHours.add(day.display);
      entry.starts.add(t);
      const slotKey = `${day.dateKey} ${minutesToTime(t)}`;
      (slotConsuls[slotKey] = slotConsuls[slotKey] || []).push(day.consulIpnHash);
    }
  });

  // Merge consecutive free slots into windows for display
  const byDate: FreeSlots['byDate'] = {};
  Object.entries(freeByDate).forEach(([dateKey, { workingHours, starts }]) => {
    const windows: { start: number; end: number }[] = [];
    [...starts]
      .sort((a, b) => a - b)
      .forEach((t) => {
        const last = windows[windows.length - 1];
        if (last && last.end === t) last.end = t + slotMinutes;
        else windows.push({ start: t, end: t + slotMinutes });
      });
    byDate[dateKey] = {
      workingHours: [...workingHours].sort().join(', '),
      windows: windows.map((w) => ({
        from: minutesToTime(w.start),
        to: minutesToTime(w.end),
        durationMinutes: w.end - w.start,
      })),
    };
  });

  // All slot start times "YYYY-MM-DD HH:MM" from the calculation above
  const keys = Object.entries(byDate).flatMap(([dateKey, data]) =>
    data.windows.flatMap((w) => {
      const start = parseTimeFromISO('0000-00-00T' + w.from).totalMinutes;
      const windowKeys: SlotKey[] = [];
      for (let t = start; t < start + w.durationMinutes; t += slotMinutes) windowKeys.push(`${dateKey} ${minutesToTime(t)}`);
      return windowKeys;
    }),
  );

  return { byDate, slotConsuls, keys };
}
