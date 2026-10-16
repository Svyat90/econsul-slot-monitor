import { z } from 'zod';

// Shared pieces of the API contracts. Every POST body is strict: an unknown key (`token`,
// `headers`) is a 422, never a silently stored secret (security «In this project»).

export const isoDateTime = z.iso.datetime({ offset: true });
export const checkKindSchema = z.enum(['scheduled', 'fast', 'manual']);
export const requestOutcomeSchema = z.enum(['ok', 'session_expired', 'unavailable', 'schema_error', 'network_error']);

export type CheckKind = z.infer<typeof checkKindSchema>;
export type RequestOutcome = z.infer<typeof requestOutcomeSchema>;

// A batch from the app or the extension: 1–100 entries.
export function batchOf<T extends z.ZodType>(entry: T) {
    return z.object({ entries: z.array(entry).min(1).max(100) }).strict();
}

// History queries: newest first, cursor by id (`before` = the smallest id already shown).
export const historyQuerySchema = z.object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    institutionCode: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    before: z.coerce.number().int().positive().optional(),
}).strict();

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

// What the server adds to every stored entry.
export const storedFields = { id: z.number().int(), receivedAt: isoDateTime };

export function pageOf<T extends z.ZodType>(entry: T) {
    return z.object({ entries: z.array(entry), nextCursor: z.number().int().nullable() });
}

// Numbered pages (the Monitoring page): `offset` skips newer entries, the page carries `total`
// (every entry the filters match, ignoring `before` and `offset`). Only the logs that show page
// numbers take part; the others ignore neither: they reject `offset` as an unknown key.
export const offsetField = z.coerce.number().int().min(0).max(1_000_000).optional();

export function pageWithTotalOf<T extends z.ZodType>(entry: T) {
    return pageOf(entry).extend({ total: z.number().int().nonnegative() });
}

export type Page<T> = { entries: T[]; nextCursor: number | null };
export type PageWithTotal<T> = Page<T> & { total: number };
