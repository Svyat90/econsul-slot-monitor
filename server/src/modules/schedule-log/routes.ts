import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { scheduleLogEntrySchema } from '../../contracts/schedule-log.ts';
import type { ScheduleLogRepository } from './repository.ts';

// Legacy route of main.go that slots.html still calls: one entry per request.
export const scheduleLogLegacyRoutes: FastifyPluginAsyncZod<{ repository: ScheduleLogRepository }> = async (app, { repository }) => {
    app.post('/schedule-log', { schema: { body: scheduleLogEntrySchema } }, async (request, reply) => {
        await repository.insertMany([request.body]);
        return reply.code(204).send();
    });
};
