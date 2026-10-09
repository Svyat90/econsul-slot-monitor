import { describe, expect, it } from 'vitest';
import locationsJson from '../../../../server/data/locations.json';
import chicago from '../__fixtures__/econsul/chicago-2026-10-09.json';
import houston from '../__fixtures__/econsul/houston-2026-10-09.json';
import newYork from '../__fixtures__/econsul/new-york-2026-10-09.json';
import type { ReservedSlot, ScheduleRow } from '../contracts/econsul.ts';
import { locationsSchema } from '../contracts/locations.ts';
import { calculateFreeSlots, collectNonWorking, type Blocking } from './free-slots.ts';
import { buildScheduleDays, holidaySet, type ScheduleDay } from './schedule-days.ts';
import { utcOffsetDateKey } from './time.ts';

const locations = locationsSchema.parse(locationsJson);
const rowsOf = (fixture: { schedule: { data: { data?: unknown }[] } }): ScheduleRow[] =>
  fixture.schedule.data.flatMap((entry) => (entry.data ? [entry.data as ScheduleRow] : []));

type Fixture = {
  recordedAtMs: number;
  institutionCode: string;
  serviceCode: string;
  schedule: { data: { data?: unknown }[] };
  reserved: { data: { reservedSlots: unknown[] } } | null;
};
function freeSlotsOf(fixture: Fixture, blocking: 'all' | 'non-working' | 'none' = 'all') {
  const institution = locations.institutions.find((i) => i.code === fixture.institutionCode);
  if (!institution) throw new Error('institution not in locations.json');
  const rows = rowsOf(fixture);
  const days = buildScheduleDays(
    {
      rows,
      serviceCode: fixture.serviceCode,
      numberWeeks: institution.numberWeeks,
      offset: institution.timeZone.slice(3),
      holidays: holidaySet(locations.holidays, fixture.serviceCode),
      localDateKey: utcOffsetDateKey(-5 * 60),
    },
    fixture.recordedAtMs,
  );
  const reserved = blocking === 'all' ? ((fixture.reserved?.data.reservedSlots ?? []) as ReservedSlot[]) : [];
  return calculateFreeSlots({
    days,
    nonWorking: blocking === 'none' ? [] : collectNonWorking(rows, fixture.serviceCode),
    reserved,
    slotMinutes: institution.serviceMinutes[fixture.serviceCode] ?? 0,
  });
}

const day = (over: Partial<ScheduleDay> = {}): ScheduleDay => ({
  dateKey: '2026-10-12',
  consulIpnHash: 'A',
  startMinutes: 540,
  endMinutes: 600,
  display: '09:00-10:00',
  ...over,
});
const block = (consulIpnHash: string, from: string, to: string): Blocking => ({
  consulIpnHash,
  from: `2026-10-12T${from}:00.00-06:00`,
  to: `2026-10-12T${to}:00.00-06:00`,
});

describe('calculateFreeSlots (synthetic day)', () => {
  const free = (days: ScheduleDay[], nonWorking: Blocking[], slotMinutes = 20) =>
    calculateFreeSlots({ days, nonWorking, reserved: [], slotMinutes });

  it('cuts the day into slots and merges them into one window', () => {
    const result = free([day()], []);
    expect(result.keys).toEqual(['2026-10-12 09:00', '2026-10-12 09:20', '2026-10-12 09:40']);
    expect(result.byDate['2026-10-12']).toEqual({
      workingHours: '09:00-10:00',
      windows: [{ from: '09:00', to: '10:00', durationMinutes: 60 }],
    });
  });

  it('a block overlapping a slot by one minute makes it busy', () => {
    const result = free([day()], [block('A', '09:19', '09:21')]);
    expect(result.keys).toEqual(['2026-10-12 09:40']);
    const touching = free([day()], [block('A', '09:20', '09:40')]);
    expect(touching.keys).toEqual(['2026-10-12 09:00', '2026-10-12 09:40']);
    expect(touching.byDate['2026-10-12']?.windows).toHaveLength(2);
  });

  it('a slot that does not fit before closing time is not free', () => {
    expect(free([day({ endMinutes: 590 })], []).keys).toEqual(['2026-10-12 09:00', '2026-10-12 09:20']);
  });

  it('a slot free for one of two consuls is free', () => {
    const result = free([day(), day({ consulIpnHash: 'B' })], [block('A', '09:00', '09:20')]);
    expect(result.slotConsuls['2026-10-12 09:00']).toEqual(['B']);
    expect(result.slotConsuls['2026-10-12 09:20']).toEqual(['A', 'B']);
    expect(result.keys).toHaveLength(3);
  });

  it('reserved slots block like non-working time', () => {
    const reserved: ReservedSlot[] = [
      {
        consulIpnHash: 'A',
        receptionDateAndTimeFrom: '2026-10-12T09:00:00.00-06:00',
        receptionDateAndTimeTo: '2026-10-12T09:20:00.00-06:00',
      },
    ];
    const result = calculateFreeSlots({ days: [day()], nonWorking: [], reserved, slotMinutes: 20 });
    expect(result.keys).toEqual(['2026-10-12 09:20', '2026-10-12 09:40']);
  });
});

describe('calculateFreeSlots (recorded fixtures)', () => {
  it.each([
    ['chicago', chicago, 0, 1896, 1980],
    ['houston', houston, 0, 2832, 2832],
    ['new-york', newYork, 0, 2160, 2160],
  ])('%s: counts free slots with all blocks / non-working only / no blocks', (_name, fixture, all, nonWorking, none) => {
    const counts = [freeSlotsOf(fixture), freeSlotsOf(fixture, 'non-working'), freeSlotsOf(fixture, 'none')].map(
      (r) => r.keys.length,
    );
    expect(counts).toEqual([all, nonWorking, none]);
  });

  it('houston: 2026-10-12 is fully reserved (09:00-13:15 back to back) and only the reserved list shows it', () => {
    expect(freeSlotsOf(houston).keys.some((k) => k.startsWith('2026-10-12'))).toBe(false);
    const open = freeSlotsOf(houston, 'non-working');
    expect(open.byDate['2026-10-12']?.windows[0]).toEqual({ from: '09:00', to: '13:00', durationMinutes: 240 });
  });

  it('keys follow the windows and slotConsuls', () => {
    const result = freeSlotsOf(chicago, 'non-working');
    expect(Object.keys(result.slotConsuls)).toEqual(result.keys);
  });
});
