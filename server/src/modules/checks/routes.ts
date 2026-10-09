import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { checkBatchSchema, checkPageSchema, checkQuerySchema } from '../../contracts/checks.ts';
import type { ChecksRepository } from './repository.ts';

export const checksRoutes: FastifyPluginAsyncZod<{ repository: ChecksRepository }> = async (app, { repository }) => {
    app.post('/api/checks', { schema: { body: checkBatchSchema } }, async (request, reply) => {
        await repository.insertMany(request.body.entries);
        return reply.code(204).send();
    });

    app.get('/api/checks', { schema: { querystring: checkQuerySchema, response: { 200: checkPageSchema } } }, async (request) => {
        return repository.list(request.query);
    });
};
