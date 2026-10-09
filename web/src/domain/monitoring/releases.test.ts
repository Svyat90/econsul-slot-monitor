import { describe, expect, it } from 'vitest';
import locationsJson from '../../../../server/data/locations.json';
import chicago from '../__fixtures__/econsul/chicago-2026-10-09.json';
import newYork from '../__fixtures__/econsul/new-york-2026-10-09.json';
import type { ScheduleRow } from '../contracts/econsul.ts';
import { locationsSchema } from '../contracts/locations.ts';
import { holidaySet, type ScheduleInput } from '../slots/schedule-days.ts';
import { utcOffsetDateKey } from '../slots/time.ts';
import { upcomingReleases } from './releases.ts';
import { FAST_CHECKS } from './schedule.ts';

const locations = locationsSchema.parse(locationsJson);
const rowsOf = (fixture: typeof chicago): ScheduleRow[] =>
  fixture.schedule.data.flatMap((entry) => (entry.data ? [entry.data as ScheduleRow] : []));

const inputOf = (rows: ScheduleRow[], offset: string): ScheduleInput => ({
  rows,
  serviceCode: '1',
  numberWeeks: 25,
  offset,
  holidays: holidaySet(locations.holidays, '1'),
  localDateKey: utcOffsetDateKey(-5 * 60),
});

describe('upcomingReleases', () => {
  it('Chicago: opens the day numberWeeks * 7 - 1 days ahead at the opening hour', () => {
    const nowMs = chicago.recordedAtMs;
    const releases = upcomingReleases(inputOf(rowsOf(chicago), '-06:00'), nowMs);
    const first = releases[0]!;
    expect(first.at).toBe(Date.parse(`${first.days[0]!.dateKey}T${first.opening}:00-06:00`) - 174 * 86400000);
    expect(first.at + FAST_CHECKS.afterMs).toBeGreaterThan(nowMs);
    expect(releases.map((r) => r.at)).toEqual([...releases.map((r) => r.at)].sort((a, b) => a - b));
    // Saturday 10.10.2026 09:00 GMT-06:00 opens Friday 02.04.2027; nothing opens on Sunday or Monday
    expect(releases.map((r) => [new Date(r.at).toISOString(), r.days.map((d) => d.dateKey)])).toEqual([
      ['2026-10-10T15:00:00.000Z', ['2027-04-02']],
      ['2026-10-13T15:00:00.000Z', ['2027-04-05']],
      ['2026-10-14T15:00:00.000Z', ['2027-04-06']],
      ['2026-10-15T15:00:00.000Z', ['2027-04-07']],
      ['2026-10-16T15:00:00.000Z', ['2027-04-08']],
      ['2026-10-17T15:00:00.000Z', ['2027-04-09']],
    ]);
    expect(first.opening).toBe('09:00');
  });

  it('New York: two reception intervals give two moments on one day', () => {
    const nowMs = newYork.recordedAtMs;
    const releases = upcomingReleases(inputOf(rowsOf(newYork), '-07:00'), nowMs);
    expect(releases.map((r) => [new Date(r.at).toISOString(), r.opening, r.days])).toEqual([
      ['2026-10-13T16:00:00.000Z', '09:00', [{ dateKey: '2027-04-05', display: '09:00-12:00' }]],
      ['2026-10-13T21:00:00.000Z', '14:00', [{ dateKey: '2027-04-05', display: '14:00-17:00' }]],
      ['2026-10-15T16:00:00.000Z', '09:00', [{ dateKey: '2027-04-07', display: '09:00-12:00' }]],
      ['2026-10-15T21:00:00.000Z', '14:00', [{ dateKey: '2027-04-07', display: '14:00-17:00' }]],
      ['2026-10-16T16:00:00.000Z', '09:00', [{ dateKey: '2027-04-08', display: '09:00-12:00' }]],
    ]);
  });
});
