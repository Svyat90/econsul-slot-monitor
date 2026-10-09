import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
    scheduleLogBatchSchema,
    scheduleLogEntrySchema,
    scheduleLogPageSchema,
    scheduleLogQuerySchema,
} from '../../contracts/schedule-log.ts';
import type { ScheduleLogRepository } from './repository.ts';

// Legacy route of main.go that slots.html still calls: one entry per request. Removed in stage 8.
export const scheduleLogLegacyRoutes: FastifyPluginAsyncZod<{ repository: ScheduleLogRepository }> = async (app, { repository }) => {
    app.post('/schedule-log', { schema: { body: scheduleLogEntrySchema } }, async (request, reply) => {
        await repository.insertMany([request.body]);
        return reply.code(204).send();
    });
};

export const scheduleLogApiRoutes: FastifyPluginAsyncZod<{ repository: ScheduleLogRepository }> = async (app, { repository }) => {
    app.post('/api/schedule-log', { schema: { body: scheduleLogBatchSchema } }, async (request, reply) => {
        await repository.insertMany(request.body.entries);
        return reply.code(204).send();
    });

    app.get(
        '/api/schedule-log',
        { schema: { querystring: scheduleLogQuerySchema, response: { 200: scheduleLogPageSchema } } },
        async (request) => repository.list(request.query),
    );

    // Same lines as the old logs/schedule-changes.jsonl, oldest first.
    app.get('/api/schedule-log.jsonl', async (_request, reply) => {
        const entries = await repository.listAll();
        const body = entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
        return reply
            .header('Content-Type', 'application/x-ndjson; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="schedule-changes.jsonl"')
            .send(body);
    });
};
