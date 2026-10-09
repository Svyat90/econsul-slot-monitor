import { describe, expect, it } from 'vitest';
import {
  addDays,
  consulateOffset,
  dayOfWeek,
  minutesToTime,
  parseDateFromISO,
  parseTimeFromISO,
  ukrainianDayMap,
  utcOffsetDateKey,
} from './time.ts';

describe('addDays', () => {
  it('moves within a month', () => {
    expect(addDays('2026-10-09', 7)).toBe('2026-10-16');
  });
  it('crosses month and year ends, and goes backwards', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('minutesToTime', () => {
  it('pads hours and minutes', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(630)).toBe('10:30');
    expect(minutesToTime(365)).toBe('06:05');
  });
});

describe('ISO parsing', () => {
  it('reads the time without timezone conversion', () => {
    expect(parseTimeFromISO('2026-10-16T10:30:00.00-06:00')).toEqual({
      hours: 10,
      minutes: 30,
      totalMinutes: 630,
    });
  });
  it('reads the date part', () => {
    expect(parseDateFromISO('2026-10-16T10:30:00.00-06:00')).toBe('2026-10-16');
  });
});

describe('ukrainianDayMap / dayOfWeek', () => {
  it('maps day names to JS day numbers', () => {
    expect(ukrainianDayMap['понеділок']).toBe(1);
    expect(ukrainianDayMap["п'ятниця"]).toBe(5);
    expect(ukrainianDayMap['неділя']).toBe(0);
  });
  it('returns the weekday of a date key', () => {
    expect(dayOfWeek('2026-10-09')).toBe(5);
    expect(dayOfWeek('2026-10-11')).toBe(0);
  });
});

describe('utcOffsetDateKey', () => {
  it('shifts the moment by the offset before taking the date', () => {
    const ms = Date.UTC(2026, 9, 9, 3, 0); // 03:00 UTC
    expect(utcOffsetDateKey(0)(ms)).toBe('2026-10-09');
    expect(utcOffsetDateKey(-5 * 60)(ms)).toBe('2026-10-08');
    expect(utcOffsetDateKey(3 * 60)(Date.UTC(2026, 9, 9, 22, 0))).toBe('2026-10-10');
  });
});

describe('consulateOffset', () => {
  const iso = ['2026-10-16T10:30:00.00-05:00'];
  it('uses the institution timeZone first', () => {
    expect(consulateOffset('GMT-06:00', iso, 120)).toBe('-06:00');
  });
  it('falls back to the offset of the first ISO string', () => {
    expect(consulateOffset(undefined, iso, 120)).toBe('-05:00');
    expect(consulateOffset('Europe/Kyiv', iso, 120)).toBe('-05:00');
  });
  it('falls back to the browser offset', () => {
    expect(consulateOffset(undefined, [], 120)).toBe('+02:00');
    expect(consulateOffset(undefined, [], -330)).toBe('-05:30');
    expect(consulateOffset(undefined, ['2026-10-16T10:30:00'], 0)).toBe('+00:00');
  });
});
