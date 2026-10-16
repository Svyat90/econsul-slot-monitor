import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleLogEntry } from '../../contracts/schedule-log.ts';
import type { ScheduleLogRepository } from './repository.ts';
import { scheduleLogApiRoutes, scheduleLogLegacyRoutes } from './routes.ts';

const entry: ScheduleLogEntry = {
    time: '2026-10-09T10:00:00.000Z',
    institutionCode: 'NYC',
    institution: 'New York',
    type: 'baseline',
    changes: [],
};

function fakeRepository(overrides: Partial<ScheduleLogRepository> = {}): ScheduleLogRepository {
    return {
        insertMany: vi.fn(async (entries: ScheduleLogEntry[]) => entries.length),
        list: vi.fn(async () => ({ entries: [], nextCursor: null, total: 0 })),
        listAll: vi.fn(async () => []),
        ...overrides,
    };
}

async function build(plugin: typeof scheduleLogLegacyRoutes, repository = fakeRepository()) {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(plugin, { repository });
    return { app, repository };
}

describe('POST /schedule-log (legacy)', () => {
    it('stores a valid entry and answers 204', async () => {
        const { app, repository } = await build(scheduleLogLegacyRoutes);
        const res = await app.inject({ method: 'POST', url: '/schedule-log', payload: entry });
        expect(res.statusCode).toBe(204);
        expect(repository.insertMany).toHaveBeenCalledWith([entry]);
    });

    it('rejects an unknown key such as token and stores nothing', async () => {
        const { app, repository } = await build(scheduleLogLegacyRoutes);
        const res = await app.inject({ method: 'POST', url: '/schedule-log', payload: { ...entry, token: 'x' } });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(repository.insertMany).not.toHaveBeenCalled();
    });
});

describe('POST /api/schedule-log', () => {
    it('stores a batch in one call and answers 204', async () => {
        const { app, repository } = await build(scheduleLogApiRoutes);
        const res = await app.inject({ method: 'POST', url: '/api/schedule-log', payload: { entries: [entry, { ...entry, type: 'changed' }] } });
        expect(res.statusCode).toBe(204);
        expect(repository.insertMany).toHaveBeenCalledTimes(1);
        expect(vi.mocked(repository.insertMany).mock.calls[0]?.[0]).toHaveLength(2);
    });

    it('rejects an unknown key such as token and stores nothing', async () => {
        const { app, repository } = await build(scheduleLogApiRoutes);
        const inEntry = await app.inject({ method: 'POST', url: '/api/schedule-log', payload: { entries: [{ ...entry, token: 'x' }] } });
        const inBatch = await app.inject({ method: 'POST', url: '/api/schedule-log', payload: { entries: [entry], token: 'x' } });
        for (const res of [inEntry, inBatch]) {
            expect(res.statusCode).toBeGreaterThanOrEqual(400);
            expect(res.statusCode).toBeLessThan(500);
        }
        expect(repository.insertMany).not.toHaveBeenCalled();
    });

    it('rejects an empty batch', async () => {
        const { app } = await build(scheduleLogApiRoutes);
        const res = await app.inject({ method: 'POST', url: '/api/schedule-log', payload: { entries: [] } });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/schedule-log', () => {
    it('passes the parsed query to the repository and returns the page', async () => {
        const page = {
            entries: [{ ...entry, id: 7, receivedAt: '2026-10-09T10:00:01.000Z' }],
            nextCursor: 7,
            total: 9,
        };
        const { app, repository } = await build(scheduleLogApiRoutes, fakeRepository({ list: vi.fn(async () => page) }));
        const res = await app.inject({ method: 'GET', url: '/api/schedule-log?limit=1&institutionCode=NYC&before=9' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(page);
        expect(repository.list).toHaveBeenCalledWith({ limit: 1, institutionCode: 'NYC', before: 9 });
    });

    it('rejects an unknown query key', async () => {
        const { app } = await build(scheduleLogApiRoutes);
        const res = await app.inject({ method: 'GET', url: '/api/schedule-log?token=x' });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/schedule-log.jsonl', () => {
    it('streams one JSON line per entry as a download', async () => {
        const second = { ...entry, type: 'changed' as const, previousCheckAt: '2026-10-09T10:00:00.000Z', changes: ['Київ'] };
        const { app } = await build(scheduleLogApiRoutes, fakeRepository({ listAll: vi.fn(async () => [entry, second]) }));
        const res = await app.inject({ method: 'GET', url: '/api/schedule-log.jsonl' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/x-ndjson');
        expect(res.headers['content-disposition']).toBe('attachment; filename="schedule-changes.jsonl"');
        expect(res.body).toBe(`${JSON.stringify(entry)}\n${JSON.stringify(second)}\n`);
    });

    it('returns an empty body when there are no entries', async () => {
        const { app } = await build(scheduleLogApiRoutes);
        const res = await app.inject({ method: 'GET', url: '/api/schedule-log.jsonl' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('');
    });
});
