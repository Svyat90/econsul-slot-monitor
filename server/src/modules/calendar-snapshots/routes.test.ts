import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarSnapshot, CalendarSnapshotQuery } from '../../contracts/calendar-snapshots.ts';
import { calendarSnapshotRoutes } from './routes.ts';

const entry: CalendarSnapshot = {
    clientId: '11111111-1111-4111-8111-111111111111',
    observedAt: '2026-10-16T10:00:00.000Z',
    institutionCode: 'CHI',
    serviceCode: '1',
    scheduleHash: 'a1',
    reservedHash: 'b1',
    schedule: [{ consulIpnHash: 'h', institutionCode: 'CHI' }],
    reserved: { consuls: ['h'], slots: [[0, '2026-10-19T09:00:00.00-05:00', '2026-10-19T09:10:00.00-05:00']] },
    appVersion: '0.1.0',
};

async function build() {
    const insertMany = vi.fn(async (entries: CalendarSnapshot[]) => entries.length);
    const latest = vi.fn(async (_scope: { institutionCode: string; serviceCode: string }) => ({
        snapshot: { ...entry, id: 3, receivedAt: '2026-10-16T10:00:01.000Z' },
        lastCheckAt: '2026-10-16T10:05:00.000Z',
    }));
    const list = vi.fn(async (_query: CalendarSnapshotQuery) => ({
        entries: [{ id: 3, receivedAt: '2026-10-16T10:00:01.000Z', observedAt: entry.observedAt, institutionCode: 'CHI', serviceCode: '1', scheduleHash: 'a1', reservedHash: 'b1', reservedCount: 1 }],
        nextCursor: null,
    }));
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(calendarSnapshotRoutes, { repository: { insertMany, latest, list } });
    return { app, insertMany, latest, list };
}

describe('POST /api/calendar-snapshots', () => {
    it('stores a batch and answers 204', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/api/calendar-snapshots', payload: { entries: [entry] } });
        expect(res.statusCode).toBe(204);
        expect(insertMany).toHaveBeenCalledWith([entry]);
    });

    it('rejects an unknown key and a secret-looking key in a schedule row with 400 (the route plugin alone has no error handler; the app maps it to 422)', async () => {
        const { app, insertMany } = await build();
        const extra = await app.inject({ method: 'POST', url: '/api/calendar-snapshots', payload: { entries: [{ ...entry, token: 'x' }] } });
        expect(extra.statusCode).toBe(400);
        const row = await app.inject({ method: 'POST', url: '/api/calendar-snapshots', payload: { entries: [{ ...entry, schedule: [{ token: 'x' }] }] } });
        expect(row.statusCode).toBe(400);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('rejects a slot that points outside the consul list shape and an empty batch', async () => {
        const { app } = await build();
        const bad = await app.inject({ method: 'POST', url: '/api/calendar-snapshots', payload: { entries: [{ ...entry, reserved: { consuls: ['h'], slots: [['0', 'a', 'b']] } }] } });
        expect(bad.statusCode).toBe(400);
        const empty = await app.inject({ method: 'POST', url: '/api/calendar-snapshots', payload: { entries: [] } });
        expect(empty.statusCode).toBe(400);
    });
});

describe('GET /api/calendar-snapshots', () => {
    it('latest: needs both codes and returns the snapshot with the last check', async () => {
        const { app, latest } = await build();
        const res = await app.inject({ method: 'GET', url: '/api/calendar-snapshots/latest?institutionCode=CHI&serviceCode=1' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ snapshot: { id: 3, reserved: { consuls: ['h'] } }, lastCheckAt: '2026-10-16T10:05:00.000Z' });
        expect(latest).toHaveBeenCalledWith({ institutionCode: 'CHI', serviceCode: '1' });
        expect((await app.inject({ method: 'GET', url: '/api/calendar-snapshots/latest?institutionCode=CHI' })).statusCode).toBe(400);
    });

    it('list: history without the payload', async () => {
        const { app, list } = await build();
        const res = await app.inject({ method: 'GET', url: '/api/calendar-snapshots?institutionCode=CHI&serviceCode=1&limit=10' });
        expect(res.statusCode).toBe(200);
        expect(res.json().entries[0]).toMatchObject({ id: 3, reservedCount: 1 });
        expect(res.json().entries[0].reserved).toBeUndefined();
        expect(list).toHaveBeenCalledWith(expect.objectContaining({ institutionCode: 'CHI', serviceCode: '1', limit: 10 }));
    });
});
