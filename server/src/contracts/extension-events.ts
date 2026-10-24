import { z } from 'zod';
import { batchOf, historyQuerySchema, isoDateTime, pageOf, storedFields } from './common.ts';

// Events of the extension (plan §6): session, draft, the slot-picking funnel, auto-booking, user
// actions. The payload is a flat map of small values; keys that could carry a secret are refused,
// and no applicant data goes in (security «In this project»).
const payloadValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const SECRET_KEY = /token|authorization|cookie|password|jwt/i;

export const extensionEventTypes = [
    'session.logged-in', 'session.logged-out',
    'draft.found', 'draft.opened', 'draft.gone',
    'draft.create-started', 'draft.created', 'draft.create-failed',
    'selection.started', 'selection.stage', 'selection.selected', 'selection.failed',
    'booking.confirm-clicked', 'booking.booked', 'booking.failed',
    // v0.14.9: direct-API-booking test — read-only reconnaissance of the document shape (phase 1)
    'api-recon',
    'app.slots-received', 'alarm.fired',
    'user.mute', 'user.pause', 'user.auto-book', 'user.aggressive-book', 'user.reset-presses', 'user.test-sound', 'user.new-draft', 'user.direct-api-book',
] as const;

export const extensionEventSchema = z.object({
    clientId: z.uuid(),
    occurredAt: isoDateTime,
    type: z.enum(extensionEventTypes),
    jobId: z.string().min(1).max(100).nullable(), // groups the events of one slot-picking run
    payload: z.record(z.string().max(50), payloadValue)
        .refine((p) => Object.keys(p).length <= 20, { message: 'at most 20 payload keys' })
        .refine((p) => !Object.keys(p).some((k) => SECRET_KEY.test(k)), { message: 'payload key looks like a secret' }),
    extensionVersion: z.string().min(1).max(20),
    test: z.boolean(),
}).strict();

export const extensionEventBatchSchema = batchOf(extensionEventSchema);
export const extensionEventQuerySchema = historyQuerySchema.omit({ institutionCode: true }).extend({
    type: z.enum(extensionEventTypes).optional(),
    jobId: z.string().min(1).optional(),
}).strict();
export const storedExtensionEventSchema = z.object({ ...storedFields }).extend(extensionEventSchema.shape);
export const extensionEventPageSchema = pageOf(storedExtensionEventSchema);

export type ExtensionEvent = z.infer<typeof extensionEventSchema>;
export type ExtensionEventQuery = z.infer<typeof extensionEventQuerySchema>;
export type StoredExtensionEvent = z.infer<typeof storedExtensionEventSchema>;
