import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ScheduleLogRepository } from './modules/schedule-log/repository.ts';
import { scheduleLogLegacyRoutes } from './modules/schedule-log/routes.ts';
import type { Config } from './platform/config.ts';

export interface AppDeps {
    config: Config;
    scheduleLog: ScheduleLogRepository;
    pingDb: () => Promise<void>;
    logger?: boolean;
}

const BODY_LIMIT = 1024 * 1024; // same 1 MB as main.go

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
    const { config, scheduleLog, pingDb } = deps;
    const app = Fastify({
        bodyLimit: BODY_LIMIT,
        logger: deps.logger
            ? { redact: ['req.headers.token', 'req.headers.authorization'] }
            : false,
    });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
        if (hasZodFastifySchemaValidationErrors(error)) {
            const issues = error.validation.map((v) => ({ path: v.instancePath, message: v.message }));
            return reply.code(422).send({ error: 'Validation failed', issues });
        }
        const status = error.statusCode;
        if (status !== undefined && status >= 400 && status < 500) {
            return reply.code(status).send({ error: error.message });
        }
        request.log.error({ err: error }, 'request failed');
        return reply.code(500).send({ error: 'Internal Server Error' });
    });

    // Read per request, like main.go, so edits to slots.html show up on reload.
    const slotsHtml = () => readFile(`${config.repoRoot}slots.html`);
    app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(await slotsHtml()));
    app.get('/locations.json', async (_request, reply) =>
        reply.type('application/json; charset=utf-8').send(await readFile(config.locationsPath)),
    );

    app.get('/api/health', async (_request, reply) => {
        try {
            await pingDb();
            return { status: 'ok', db: 'ok' };
        } catch {
            return reply.code(503).send({ status: 'degraded', db: 'down' });
        }
    });

    await app.register(scheduleLogLegacyRoutes, { repository: scheduleLog });

    app.setNotFoundHandler(async (request, reply) => {
        if (request.url === '/api' || request.url.startsWith('/api/')) {
            return reply.code(404).send({ error: 'Not Found' });
        }
        return reply.type('text/html; charset=utf-8').send(await slotsHtml());
    });

    return app;
}
