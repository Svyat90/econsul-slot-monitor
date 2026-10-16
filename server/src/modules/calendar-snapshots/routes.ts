import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
    calendarLatestQuerySchema,
    calendarLatestSchema,
    calendarSnapshotBatchSchema,
    calendarSnapshotPageSchema,
    calendarSnapshotQuerySchema,
} from '../../contracts/calendar-snapshots.ts';
import type { CalendarSnapshotRepository } from './repository.ts';

export const calendarSnapshotRoutes: FastifyPluginAsyncZod<{ repository: CalendarSnapshotRepository }> = async (app, { repository }) => {
    app.post('/api/calendar-snapshots', { schema: { body: calendarSnapshotBatchSchema } }, async (request, reply) => {
        await repository.insertMany(request.body.entries);
        return reply.code(204).send();
    });

    // Registered before the list so `latest` is never read as an id
    app.get(
        '/api/calendar-snapshots/latest',
        { schema: { querystring: calendarLatestQuerySchema, response: { 200: calendarLatestSchema } } },
        async (request) => repository.latest(request.query),
    );

    app.get(
        '/api/calendar-snapshots',
        { schema: { querystring: calendarSnapshotQuerySchema, response: { 200: calendarSnapshotPageSchema } } },
        async (request) => repository.list(request.query),
    );
};
