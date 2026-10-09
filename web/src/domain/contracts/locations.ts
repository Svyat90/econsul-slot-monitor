import { z } from 'zod';

const institutionSchema = z.looseObject({
  code: z.string(),
  name: z.string(),
  countryCode: z.string(),
  country: z.string(),
  // 'GMT±HH:MM' of the institution
  timeZone: z.string(),
  // booking horizon in weeks
  numberWeeks: z.number(),
  // slot length in minutes by service code
  serviceMinutes: z.record(z.string(), z.number()),
});
export type Institution = z.infer<typeof institutionSchema>;

export const locationsSchema = z.looseObject({
  holidays: z.object({
    all: z.array(z.string()),
    byService: z.record(z.string(), z.array(z.string())),
  }),
  services: z.record(z.string(), z.string()),
  institutions: z.array(institutionSchema),
});
export type Locations = z.infer<typeof locationsSchema>;
