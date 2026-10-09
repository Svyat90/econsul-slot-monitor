import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleLogEntry } from '../../contracts/schedule-log.ts';
import { scheduleLogLegacyRoutes } from './routes.ts';

const entry: ScheduleLogEntry = {
    time: '2026-10-09T10:00:00.000Z',
    institutionCode: 'NYC',
    institution: 'New York',
    type: 'baseline',
    changes: [],
};

async function build() {
    const insertMany = vi.fn(async (entries: ScheduleLogEntry[]) => entries.length);
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(scheduleLogLegacyRoutes, { repository: { insertMany } });
    return { app, insertMany };
}

describe('POST /schedule-log', () => {
    it('stores a valid entry and answers 204', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/schedule-log', payload: entry });
        expect(res.statusCode).toBe(204);
        expect(insertMany).toHaveBeenCalledWith([entry]);
    });

    it('rejects an unknown key such as token and stores nothing', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/schedule-log', payload: { ...entry, token: 'x' } });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(insertMany).not.toHaveBeenCalled();
    });
});
