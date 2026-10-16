import { z } from 'zod';
import { batchOf, checkKindSchema, historyQuerySchema, isoDateTime, offsetField, pageWithTotalOf, requestOutcomeSchema, storedFields } from './common.ts';

export const newSlotSchema = z.object({
    date: z.iso.date(),
    time: z.string().regex(/^\d\d:\d\d$/),
    consulIpnHash: z.string().nullable(),
}).strict();

// One monitoring check of the app.
export const checkEntrySchema = z.object({
    clientId: z.uuid(),
    startedAt: isoDateTime,
    durationMs: z.number().int().nonnegative(),
    kind: checkKindSchema,
    checkSeq: z.number().int().nonnegative(),
    institutionCode: z.string().min(1),
    serviceCode: z.string().min(1),
    outcome: requestOutcomeSchema,
    freeCount: z.number().int().nonnegative().nullable(), // null when the check failed
    newCount: z.number().int().nonnegative().nullable(),
    outOfRangeCount: z.number().int().nonnegative().nullable(),
    newSlots: z.array(newSlotSchema).max(5000),
    tabSessionId: z.uuid(),
    appVersion: z.string().min(1).max(50),
    errorMessage: z.string().max(500).nullable(),
}).strict().refine((e) => e.outcome !== 'ok' || e.freeCount !== null, { message: 'freeCount is required when outcome is ok' });

export const checkBatchSchema = batchOf(checkEntrySchema);
export const checkQuerySchema = historyQuerySchema.extend({
    kind: checkKindSchema.optional(),
    outcome: requestOutcomeSchema.optional(),
    onlyNew: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    failed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), // any outcome but ok
    offset: offsetField,
}).strict();
export const storedCheckEntrySchema = z.object({ ...storedFields }).extend(checkEntrySchema.shape);
export const checkPageSchema = pageWithTotalOf(storedCheckEntrySchema);

export type NewSlot = z.infer<typeof newSlotSchema>;
export type CheckEntry = z.infer<typeof checkEntrySchema>;
export type CheckQuery = z.infer<typeof checkQuerySchema>;
export type StoredCheckEntry = z.infer<typeof storedCheckEntrySchema>;
