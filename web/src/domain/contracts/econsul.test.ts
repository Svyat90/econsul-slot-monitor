import { describe, expect, it } from 'vitest';
import chicago from '../__fixtures__/econsul/chicago-2026-10-09.json';
import houston from '../__fixtures__/econsul/houston-2026-10-09.json';
import newYork from '../__fixtures__/econsul/new-york-2026-10-09.json';
import { reservedResponseSchema, scheduleResponseSchema } from './econsul.ts';

const fixtures = { chicago, houston, 'new-york': newYork };

describe('e-Consul response schemas', () => {
  it.each(Object.entries(fixtures))('parses recorded schedule and reserved slots: %s', (_name, fixture) => {
    const schedule = scheduleResponseSchema.safeParse(fixture.schedule);
    const reserved = reservedResponseSchema.safeParse(fixture.reserved);
    expect(schedule.success).toBe(true);
    expect(reserved.success).toBe(true);
  });

  it('rejects a schedule row without consulIpnHash', () => {
    const result = scheduleResponseSchema.safeParse({
      data: [{ data: { receptionCitizensTime: [] } }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts unknown extra fields', () => {
    const result = scheduleResponseSchema.safeParse({
      data: [{ data: { consulIpnHash: 'h', brandNewField: 1 }, extra: true }],
      another: 'x',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null schedule row', () => {
    expect(scheduleResponseSchema.safeParse({ data: [{ data: null }] }).success).toBe(true);
  });
});
