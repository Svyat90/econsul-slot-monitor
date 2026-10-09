import { z } from 'zod';
import { isoDateTime } from './common.ts';

// GET /api/summary: the Monitoring page's day. The day's bounds come from the browser (its
// local midnight), so the server does not guess a time zone.
export const summaryQuerySchema = z.object({
    from: isoDateTime,
    to: isoDateTime,
    institutionCode: z.string().min(1).optional(),
}).strict();

export const summarySchema = z.object({
    checks: z.object({ total: z.number().int(), fast: z.number().int(), failed: z.number().int() }),
    newFree: z.object({ total: z.number().int(), lastAt: isoDateTime.nullable() }),
    reservations: z.object({ reserved: z.number().int(), released: z.number().int() }),
});

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type Summary = z.infer<typeof summarySchema>;
