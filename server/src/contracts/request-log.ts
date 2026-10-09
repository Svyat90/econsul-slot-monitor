import { z } from 'zod';
import { batchOf, checkKindSchema, historyQuerySchema, isoDateTime, pageOf, requestOutcomeSchema, storedFields } from './common.ts';

// One request to e-Consul, made by the app or the extension. Never the token, headers or body.
// The filters are the only free-form part, so they are spelled out and strict as well.
export const requestFiltersSchema = z.object({
    institutionCode: z.string().optional(),
    status: z.array(z.number().int()).optional(),
    consulIpnHash: z.array(z.string()).optional(),
}).strict();

export const requestLogEntrySchema = z.object({
    clientId: z.uuid(),
    startedAt: isoDateTime,
    durationMs: z.number().int().nonnegative(),
    service: z.string().min(1),
    method: z.string().min(1),
    institutionCode: z.string().nullable(),
    filters: requestFiltersSchema,
    httpStatus: z.number().int().min(100).max(599).nullable(), // null: no response (network error)
    outcome: requestOutcomeSchema,
    itemsCount: z.number().int().nonnegative().nullable(),
    responseBytes: z.number().int().nonnegative().nullable(),
    checkKind: checkKindSchema.nullable(),
    checkSeq: z.number().int().nonnegative().nullable(),
    source: z.enum(['app', 'extension']),
    tabSessionId: z.uuid(),
    appVersion: z.string().min(1).max(50),
    errorMessage: z.string().max(500).nullable(),
}).strict().refine((e) => (e.outcome === 'network_error') === (e.httpStatus === null), {
    message: 'httpStatus is null exactly for network_error',
});

export const requestLogBatchSchema = batchOf(requestLogEntrySchema);
export const requestLogQuerySchema = historyQuerySchema.extend({
    method: z.string().min(1).optional(),
    outcome: requestOutcomeSchema.optional(),
    source: z.enum(['app', 'extension']).optional(),
}).strict();
export const storedRequestLogEntrySchema = z.object({ ...storedFields }).extend(requestLogEntrySchema.shape);
export const requestLogPageSchema = pageOf(storedRequestLogEntrySchema);

export type RequestLogEntry = z.infer<typeof requestLogEntrySchema>;
export type RequestLogQuery = z.infer<typeof requestLogQuerySchema>;
export type StoredRequestLogEntry = z.infer<typeof storedRequestLogEntrySchema>;
