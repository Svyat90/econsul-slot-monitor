import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import fastifyStatic from '@fastify/static';
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

    // New app: only the build folder is served, never the repository root.
    const webBuilt = existsSync(config.webDistPath);
    if (webBuilt) {
        await app.register(fastifyStatic, { root: config.webDistPath, prefix: '/next/' });
    }

    app.setNotFoundHandler(async (request, reply) => {
        const path = request.url.split('?')[0] ?? '/';
        if (path === '/api' || path.startsWith('/api/')) {
            return reply.code(404).send({ error: 'Not Found' });
        }
        if (path === '/next' || path.startsWith('/next/')) {
            if (!webBuilt) {
                return reply.code(404).send({ error: 'web/dist not found: run `pnpm --dir web build` and restart the server' });
            }
            // SPA route (no file extension) -> index.html; a missing file stays 404.
            if (extname(path) === '' && request.method === 'GET') {
                return reply.type('text/html; charset=utf-8').send(await readFile(`${config.webDistPath}/index.html`));
            }
            return reply.code(404).send({ error: 'Not Found' });
        }
        return reply.type('text/html; charset=utf-8').send(await slotsHtml());
    });

    return app;
}
