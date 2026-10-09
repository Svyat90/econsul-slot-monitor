import { z } from 'zod';

// e-Consul adds fields without notice, so every schema is loose (unknown fields pass through)
// and requires only what the slot algorithm reads.

const receptionTimeSchema = z.looseObject({
  workingDays: z.string(),
  workingHoursFrom: z.string(),
  workingHoursTo: z.string(),
});

const nonWorkingTimeSchema = z.looseObject({
  notWorkingDateAndHoursFrom: z.string(),
  notWorkingDateAndHoursTo: z.string(),
});

const serviceSchema = z.looseObject({
  code: z.union([z.string(), z.number()]),
});

export const scheduleRowSchema = z.looseObject({
  consulIpnHash: z.string(),
  admissionSchedulePeriodDate: z.string().nullish(),
  receptionCitizensTime: z.array(receptionTimeSchema).optional(),
  nonWorkingTime: z.array(nonWorkingTimeSchema).optional(),
  consularInstitutionService: z.array(serviceSchema).optional(),
});
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;

export const scheduleResponseSchema = z.looseObject({
  data: z.array(z.looseObject({ data: scheduleRowSchema.nullable() })),
});
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;

export const reservedSlotSchema = z.looseObject({
  consulIpnHash: z.string(),
  receptionDateAndTimeFrom: z.string(),
  receptionDateAndTimeTo: z.string(),
});
export type ReservedSlot = z.infer<typeof reservedSlotSchema>;

export const reservedResponseSchema = z.looseObject({
  data: z.looseObject({
    status: z.string().optional(),
    reservedSlots: z.array(reservedSlotSchema),
  }),
});
export type ReservedResponse = z.infer<typeof reservedResponseSchema>;
