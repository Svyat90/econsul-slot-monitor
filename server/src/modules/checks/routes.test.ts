import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { CheckEntry, CheckQuery, StoredCheckEntry } from '../../contracts/checks.ts';
import { checksRoutes } from './routes.ts';

const entry: CheckEntry = {
    clientId: '11111111-1111-4111-8111-111111111111',
    startedAt: '2026-10-09T10:00:00.000Z',
    durationMs: 120,
    kind: 'scheduled',
    checkSeq: 1,
    institutionCode: 'NYC',
    serviceCode: 'SRV',
    outcome: 'ok',
    freeCount: 3,
    newCount: 1,
    outOfRangeCount: 0,
    newSlots: [{ date: '2026-10-12', time: '10:30', consulIpnHash: null }],
    tabSessionId: '22222222-2222-4222-8222-222222222222',
    appVersion: '0.1.0',
    errorMessage: null,
};
const stored: StoredCheckEntry = { ...entry, id: 7, receivedAt: '2026-10-09T10:00:01.000Z' };

async function build() {
    const insertMany = vi.fn(async (entries: CheckEntry[]) => entries.length);
    const list = vi.fn(async (_query: CheckQuery) => ({ entries: [stored], nextCursor: null }));
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(checksRoutes, { repository: { insertMany, list } });
    return { app, insertMany, list };
}

describe('POST /api/checks', () => {
    it('stores a batch and answers 204', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/api/checks', payload: { entries: [entry] } });
        expect(res.statusCode).toBe(204);
        expect(insertMany).toHaveBeenCalledWith([entry]);
    });

    it('rejects an unknown key such as token and stores nothing', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/api/checks', payload: { entries: [{ ...entry, token: 'x' }] } });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('GET /api/checks', () => {
    it('passes parsed filters to the repository and returns the page', async () => {
        const { app, list } = await build();
        const res = await app.inject({ method: 'GET', url: '/api/checks?onlyNew=true&kind=fast&limit=20' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ entries: [stored], nextCursor: null });
        expect(list).toHaveBeenCalledWith({ kind: 'fast', onlyNew: true, limit: 20 });
    });
});
