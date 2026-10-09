import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { extensionEventBatchSchema, extensionEventPageSchema, extensionEventQuerySchema } from '../../contracts/extension-events.ts';
import type { ExtensionEventsRepository } from './repository.ts';

export const extensionEventsRoutes: FastifyPluginAsyncZod<{ repository: ExtensionEventsRepository }> = async (app, { repository }) => {
    app.post('/api/extension-events', { schema: { body: extensionEventBatchSchema } }, async (request, reply) => {
        await repository.insertMany(request.body.entries);
        return reply.code(204).send();
    });

    app.get('/api/extension-events', { schema: { querystring: extensionEventQuerySchema, response: { 200: extensionEventPageSchema } } }, async (request) => {
        return repository.list(request.query);
    });
};
