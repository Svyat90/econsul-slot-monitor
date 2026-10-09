import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requestLogBatchSchema, requestLogPageSchema, requestLogQuerySchema } from '../../contracts/request-log.ts';
import type { RequestLogRepository } from './repository.ts';

export const requestLogRoutes: FastifyPluginAsyncZod<{ repository: RequestLogRepository }> = async (app, { repository }) => {
    app.post('/api/request-log', { schema: { body: requestLogBatchSchema } }, async (request, reply) => {
        await repository.insertMany(request.body.entries);
        return reply.code(204).send();
    });

    app.get('/api/request-log', {
        schema: { querystring: requestLogQuerySchema, response: { 200: requestLogPageSchema } },
    }, async (request) => repository.list(request.query));
};
