import { describe, expect, it } from 'vitest';
import locationsJson from '../../../../server/data/locations.json';
import chicago from '../__fixtures__/econsul/chicago-2026-10-09.json';
import newYork from '../__fixtures__/econsul/new-york-2026-10-09.json';
import type { ScheduleRow } from '../contracts/econsul.ts';
import { locationsSchema } from '../contracts/locations.ts';
import {
  buildScheduleDays,
  holidaySet,
  serviceConsulHashes,
  serviceScheduleRows,
  type ScheduleInput,
} from './schedule-days.ts';
import { dayOfWeek, utcOffsetDateKey } from './time.ts';

const locations = locationsSchema.parse(locationsJson);
const rowsOf = (fixture: typeof chicago): ScheduleRow[] =>
  fixture.schedule.data.flatMap((entry) => (entry.data ? [entry.data as ScheduleRow] : []));

const chicagoRows = rowsOf(chicago);
const newYorkRows = rowsOf(newYork);
const DAY = 86400000;

const chicagoInput = (): ScheduleInput => ({
  rows: chicagoRows,
  serviceCode: '1',
  numberWeeks: 25,
  offset: '-06:00',
  holidays: holidaySet(locations.holidays, '1'),
  localDateKey: utcOffsetDateKey(-5 * 60),
});

describe('holidaySet', () => {
  it('expands single dates and ranges, including the service-specific ones', () => {
    const set = holidaySet(locations.holidays, '1');
    expect(set.has('2026-12-25')).toBe(true);
    expect(set.has('2026-11-21')).toBe(true);
    expect(set.has('2026-11-24')).toBe(true);
    expect(set.has('2026-11-27')).toBe(true);
    expect(set.has('2026-11-28')).toBe(false);
  });
});

describe('service rows', () => {
  it('keeps only the rows whose consul provides the service', () => {
    expect(serviceScheduleRows(chicagoRows, '1')).toHaveLength(2);
    expect(serviceConsulHashes(chicagoRows, '1')).toHaveLength(1);
    expect(serviceScheduleRows(chicagoRows, '999')).toEqual([]);
  });
});

describe('buildScheduleDays (Chicago)', () => {
  const nowMs = chicago.recordedAtMs;
  const days = buildScheduleDays(chicagoInput(), nowMs);

  it('starts tomorrow: the first offered day is the first working day after today', () => {
    // 2026-10-09 is a Friday; Saturday and Sunday have no reception
    expect(days[0]?.dateKey).toBe('2026-10-12');
    expect(days.every((d) => d.dateKey >= '2026-10-10')).toBe(true);
    expect(days[0]).toMatchObject({ startMinutes: 540, endMinutes: 720, display: '09:00-12:00' });
  });

  it('ends at the horizon and skips weekends and holidays', () => {
    // now + 174 days is 2027-04-01 17:13Z, after that day's 09:00 -06:00 opening; 04-02 opens later
    expect(days.at(-1)?.dateKey).toBe('2027-04-01');
    expect(days.some((d) => [0, 6].includes(dayOfWeek(d.dateKey)))).toBe(false);
    expect(days.some((d) => d.dateKey === '2026-11-24')).toBe(false);
    expect(days.some((d) => d.dateKey === '2026-12-25')).toBe(false);
    expect(days.some((d) => d.dateKey === '2026-11-20')).toBe(true);
  });

  it('counts the days of the horizon', () => {
    // 2026-10-12 .. 2027-04-02 is 125 weekdays; minus 2027-04-02 (not open yet),
    // the 5 holiday weekdays of 23-27 Nov and 25 Dec
    expect(days).toHaveLength(125 - 1 - 5 - 1);
  });

  // booking.md §6 p. 3: opening time 09:00 at -06:00 is 15:00Z on 2027-04-01
  const opening = Date.parse('2027-04-01T15:00:00Z');
  it('depends on the time of day: a minute before the opening the last day is not offered yet', () => {
    const now = opening - 174 * DAY - 60000;
    expect(buildScheduleDays(chicagoInput(), now).at(-1)?.dateKey).toBe('2027-03-31');
  });
  it('offers the last day a minute after the opening', () => {
    const now = opening - 174 * DAY + 60000;
    expect(buildScheduleDays(chicagoInput(), now).at(-1)?.dateKey).toBe('2027-04-01');
  });

  it('gives no days for a service the consul does not provide', () => {
    const input = { ...chicagoInput(), serviceCode: '999' };
    expect(buildScheduleDays(input, nowMs)).toEqual([]);
  });
});

describe('buildScheduleDays (New York)', () => {
  it('returns two intervals for one weekday', () => {
    const nowMs = newYork.recordedAtMs;
    const input: ScheduleInput = {
      rows: newYorkRows,
      serviceCode: '1',
      numberWeeks: 25,
      offset: '-07:00',
      holidays: holidaySet(locations.holidays, '1'),
      localDateKey: utcOffsetDateKey(-5 * 60),
    };
    const monday = buildScheduleDays(input, nowMs).filter((d) => d.dateKey === '2026-10-12');
    expect(monday.map((d) => d.display)).toEqual(['09:00-12:00', '14:00-17:00']);
  });
});
