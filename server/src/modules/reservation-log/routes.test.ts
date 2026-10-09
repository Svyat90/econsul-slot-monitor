import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { ReservationEvent } from '../../contracts/reservation-log.ts';
import { reservationLogRoutes } from './routes.ts';
import type { ReservationLogRepository } from './repository.ts';

const event: ReservationEvent = {
    clientId: '00000000-0000-4000-8000-000000000001',
    kind: 'reserved',
    institutionCode: 'NYC',
    consulIpnHash: 'hash-1',
    slotFrom: '2026-10-12T09:00:00+03:00',
    slotTo: '2026-10-12T09:15:00+03:00',
    previousCheckAt: '2026-10-09T10:00:00.000Z',
    detectedAt: '2026-10-09T11:00:00.000Z',
    tabSessionId: '11111111-1111-4111-8111-111111111111',
};

async function build() {
    const insertMany = vi.fn(async (events: ReservationEvent[]) => events.length);
    const list = vi.fn<ReservationLogRepository['list']>(async () => ({
        entries: [{ ...event, id: 5, receivedAt: '2026-10-09T11:00:01.000Z' }],
        nextCursor: 5,
    }));
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(reservationLogRoutes, { repository: { insertMany, list } });
    return { app, insertMany, list };
}

describe('POST /reservation-log', () => {
    it('stores a batch and answers 204', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/reservation-log', payload: { entries: [event] } });
        expect(res.statusCode).toBe(204);
        expect(insertMany).toHaveBeenCalledWith([event]);
    });

    it('rejects a token key in the body or in an entry and stores nothing', async () => {
        const { app, insertMany } = await build();
        for (const payload of [{ entries: [event], token: 'x' }, { entries: [{ ...event, token: 'x' }] }]) {
            const res = await app.inject({ method: 'POST', url: '/reservation-log', payload });
            expect(res.statusCode).toBeGreaterThanOrEqual(400);
            expect(res.statusCode).toBeLessThan(500);
        }
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('rejects an empty batch', async () => {
        const { app } = await build();
        const res = await app.inject({ method: 'POST', url: '/reservation-log', payload: { entries: [] } });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /reservation-log', () => {
    it('passes parsed filters to the repository and returns the page', async () => {
        const { app, list } = await build();
        const res = await app.inject({ method: 'GET', url: '/reservation-log?kind=released&limit=10&before=20' });
        expect(res.statusCode).toBe(200);
        expect(list).toHaveBeenCalledWith({ kind: 'released', limit: 10, before: 20 });
        expect(res.json().nextCursor).toBe(5);
        expect(res.json().entries[0].id).toBe(5);
    });

    it('rejects an unknown query key', async () => {
        const { app, list } = await build();
        const res = await app.inject({ method: 'GET', url: '/reservation-log?token=x' });
        expect(res.statusCode).toBe(400);
        expect(list).not.toHaveBeenCalled();
    });
});
