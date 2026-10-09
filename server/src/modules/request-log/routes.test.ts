import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { RequestLogEntry, StoredRequestLogEntry } from '../../contracts/request-log.ts';
import { requestLogRoutes } from './routes.ts';
import type { RequestLogRepository } from './repository.ts';

const entry: RequestLogEntry = {
    clientId: '00000000-0000-4000-8000-000000000001',
    startedAt: '2026-10-09T10:00:00.000Z',
    durationMs: 120,
    service: 'e-queue-register',
    method: 'public-get-consuls-reserved-slots',
    institutionCode: 'NYC',
    filters: { institutionCode: 'NYC' },
    httpStatus: 200,
    outcome: 'ok',
    itemsCount: 3,
    responseBytes: 1024,
    checkKind: 'scheduled',
    checkSeq: 1,
    source: 'app',
    tabSessionId: '11111111-1111-4111-8111-111111111111',
    appVersion: '1.0.0',
    errorMessage: null,
};
const stored: StoredRequestLogEntry = { ...entry, id: 7, receivedAt: '2026-10-09T10:00:01.000Z' };

async function build() {
    const insertMany = vi.fn(async (entries: RequestLogEntry[]) => entries.length);
    const list = vi.fn(async () => ({ entries: [stored], nextCursor: null }));
    const repository: RequestLogRepository = { insertMany, list };
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(requestLogRoutes, { repository });
    return { app, insertMany, list };
}

describe('POST /api/request-log', () => {
    it('stores a batch and answers 204', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/api/request-log', payload: { entries: [entry] } });
        expect(res.statusCode).toBe(204);
        expect(insertMany).toHaveBeenCalledWith([entry]);
    });

    it('rejects a token key in the batch and stores nothing', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/api/request-log', payload: { entries: [{ ...entry, token: 'x' }] } });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('rejects an empty batch', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/api/request-log', payload: { entries: [] } });
        expect(res.statusCode).toBeLessThan(500);
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('GET /api/request-log', () => {
    it('passes the parsed query to the repository and returns the page', async () => {
        const { app, list } = await build();
        const res = await app.inject({ method: 'GET', url: '/api/request-log?outcome=ok&limit=5&before=10' });
        expect(res.statusCode).toBe(200);
        expect(list).toHaveBeenCalledWith({ outcome: 'ok', limit: 5, before: 10 });
        expect(res.json()).toEqual({ entries: [stored], nextCursor: null });
    });

    it('rejects an unknown query key', async () => {
        const { app, list } = await build();
        const res = await app.inject({ method: 'GET', url: '/api/request-log?token=x' });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(list).not.toHaveBeenCalled();
    });
});
