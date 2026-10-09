import type { ScheduleInput } from '../slots/schedule-days.ts';
import { buildScheduleDays } from '../slots/schedule-days.ts';
import { minutesToTime } from '../slots/time.ts';
import { FAST_CHECKS, RELEASE_LOOKAHEAD_DAYS, type Release } from './schedule.ts';

// Upcoming moments when new days open for booking, earliest first:
// [{ at, opening: "09:00", days: [{ dateKey, display }] }]. A release stays in the list
// until its fast-check window ends. Caching is the application's business, not the domain's.
export function upcomingReleases(input: ScheduleInput, nowMs: number): Release[] {
  const leadMs = (input.numberWeeks * 7 - 1) * 86400000;
  const byMoment: Record<number, Release> = {};
  buildScheduleDays(input, nowMs + RELEASE_LOOKAHEAD_DAYS * 86400000).forEach((day) => {
    const opening = minutesToTime(day.startMinutes);
    const at = Date.parse(`${day.dateKey}T${opening}:00${input.offset}`) - leadMs;
    if (at + FAST_CHECKS.afterMs <= nowMs) return;
    const release = (byMoment[at] = byMoment[at] || { at, opening, days: [] });
    if (!release.days.some((d) => d.dateKey === day.dateKey && d.display === day.display)) {
      release.days.push({ dateKey: day.dateKey, display: day.display });
    }
  });
  return Object.values(byMoment).sort((a, b) => a.at - b.at);
}
