import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { summaryQuerySchema, summarySchema } from '../../contracts/summary.ts';
import type { SummaryRepository } from './repository.ts';

export const summaryRoutes: FastifyPluginAsyncZod<{ repository: SummaryRepository }> = async (app, { repository }) => {
    app.get('/summary', {
        schema: { querystring: summaryQuerySchema, response: { 200: summarySchema } },
    }, async (request) => repository.summary(request.query));
};
