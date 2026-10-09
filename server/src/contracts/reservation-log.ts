import { z } from 'zod';
import { batchOf, historyQuerySchema, isoDateTime, pageOf, storedFields } from './common.ts';

// A slot that became reserved, or was released, between two checks (IDEA-004).
export const reservationEventSchema = z.object({
    clientId: z.uuid(),
    kind: z.enum(['reserved', 'released']),
    institutionCode: z.string().min(1),
    consulIpnHash: z.string().min(1),
    slotFrom: isoDateTime, // as e-Consul wrote it, with the consulate offset
    slotTo: isoDateTime,
    previousCheckAt: isoDateTime, // last check without the change
    detectedAt: isoDateTime, // first check with the change
    tabSessionId: z.uuid(),
}).strict();

export const reservationBatchSchema = batchOf(reservationEventSchema);
export const reservationQuerySchema = historyQuerySchema.extend({
    kind: z.enum(['reserved', 'released']).optional(),
}).strict();
export const storedReservationEventSchema = z.object({ ...storedFields }).extend(reservationEventSchema.shape);
export const reservationPageSchema = pageOf(storedReservationEventSchema);

export type ReservationEvent = z.infer<typeof reservationEventSchema>;
export type ReservationQuery = z.infer<typeof reservationQuerySchema>;
export type StoredReservationEvent = z.infer<typeof storedReservationEventSchema>;
