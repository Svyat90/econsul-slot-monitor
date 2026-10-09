import { describe, expect, it } from 'vitest';
import locationsJson from '../../../../server/data/locations.json';
import { locationsSchema } from './locations.ts';

describe('locationsSchema', () => {
  it('parses server/data/locations.json', () => {
    const result = locationsSchema.safeParse(locationsJson);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.institutions.length).toBeGreaterThan(100);
      expect(result.data.holidays.byService['1']).toBeDefined();
    }
  });

  it('rejects an institution without timeZone', () => {
    const [first] = locationsJson.institutions;
    const broken: Record<string, unknown> = { ...first };
    delete broken.timeZone;
    const result = locationsSchema.safeParse({ ...locationsJson, institutions: [broken] });
    expect(result.success).toBe(false);
  });
});
