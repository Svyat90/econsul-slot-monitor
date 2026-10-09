import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
    reservationBatchSchema,
    reservationPageSchema,
    reservationQuerySchema,
} from '../../contracts/reservation-log.ts';
import type { ReservationLogRepository } from './repository.ts';

export const reservationLogRoutes: FastifyPluginAsyncZod<{ repository: ReservationLogRepository }> = async (app, { repository }) => {
    app.post('/reservation-log', { schema: { body: reservationBatchSchema } }, async (request, reply) => {
        await repository.insertMany(request.body.entries);
        return reply.code(204).send();
    });

    app.get(
        '/reservation-log',
        { schema: { querystring: reservationQuerySchema, response: { 200: reservationPageSchema } } },
        async (request) => repository.list(request.query),
    );
};
