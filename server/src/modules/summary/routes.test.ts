import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { Summary, SummaryQuery } from '../../contracts/summary.ts';
import { summaryRoutes } from './routes.ts';

const summary: Summary = {
    checks: { total: 5, fast: 2, failed: 1 },
    newFree: { total: 7, lastAt: '2026-10-09T10:00:00.000Z' },
    reservations: { reserved: 2, released: 1 },
};
const range = 'from=2026-10-09T00:00:00.000Z&to=2026-10-10T00:00:00.000Z';

async function build() {
    const summaryFn = vi.fn(async (_query: SummaryQuery) => summary);
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(summaryRoutes, { repository: { summary: summaryFn } });
    return { app, summaryFn };
}

describe('GET /summary', () => {
    it('passes the query to the repository and returns the summary', async () => {
        const { app, summaryFn } = await build();
        const res = await app.inject({ method: 'GET', url: `/summary?${range}&institutionCode=NYC` });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(summary);
        expect(summaryFn).toHaveBeenCalledWith({
            from: '2026-10-09T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z', institutionCode: 'NYC',
        });
    });

    it('rejects a missing bound and an unknown key', async () => {
        const { app, summaryFn } = await build();
        const noTo = await app.inject({ method: 'GET', url: '/summary?from=2026-10-09T00:00:00.000Z' });
        const extra = await app.inject({ method: 'GET', url: `/summary?${range}&token=x` });
        expect(noTo.statusCode).toBe(400);
        expect(extra.statusCode).toBe(400);
        expect(summaryFn).not.toHaveBeenCalled();
    });
});
