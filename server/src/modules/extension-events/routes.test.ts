import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionEvent, ExtensionEventQuery, StoredExtensionEvent } from '../../contracts/extension-events.ts';
import { extensionEventsRoutes } from './routes.ts';

const event: ExtensionEvent = {
    clientId: '11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-10-09T10:00:00.000Z',
    type: 'selection.selected',
    jobId: 'job-1',
    payload: { date: '2026-10-12', count: 3 },
    extensionVersion: '0.4.0',
    test: false,
};
const stored: StoredExtensionEvent = { ...event, id: 7, receivedAt: '2026-10-09T10:00:01.000Z' };

async function build() {
    const insertMany = vi.fn(async (events: ExtensionEvent[]) => events.length);
    const list = vi.fn(async (_query: ExtensionEventQuery) => ({ entries: [stored], nextCursor: null }));
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(extensionEventsRoutes, { repository: { insertMany, list } });
    return { app, insertMany, list };
}

describe('POST /api/extension-events', () => {
    it('stores a batch and answers 204', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/api/extension-events', payload: { entries: [event] } });
        expect(res.statusCode).toBe(204);
        expect(insertMany).toHaveBeenCalledWith([event]);
    });

    it('rejects a token key in payload with a 4xx and stores nothing', async () => {
        const { app, insertMany } = await build();
        const payload = { entries: [{ ...event, payload: { token: 'x' } }] };
        const res = await app.inject({ method: 'POST', url: '/api/extension-events', payload });
        expect(res.statusCode).toBe(400); // buildApp turns validation errors into 422
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown top-level key and an unknown type', async () => {
        const { app, insertMany } = await build();
        for (const bad of [{ ...event, token: 'x' }, { ...event, type: 'nope' }]) {
            const res = await app.inject({ method: 'POST', url: '/api/extension-events', payload: { entries: [bad] } });
            expect(res.statusCode).toBe(400); // buildApp turns validation errors into 422
        }
        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('GET /api/extension-events', () => {
    it('passes parsed filters to the repository and returns the page', async () => {
        const { app, list } = await build();
        const res = await app.inject({ method: 'GET', url: '/api/extension-events?type=selection.selected&jobId=job-1&limit=20' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ entries: [stored], nextCursor: null });
        expect(list).toHaveBeenCalledWith({ type: 'selection.selected', jobId: 'job-1', limit: 20 });
    });
});
