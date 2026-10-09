import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type AppDeps, buildApp } from './app.ts';
import { loadConfig } from './platform/config.ts';

const config = loadConfig();

const emptyPage = { entries: [], nextCursor: null };
const emptySummary = {
    checks: { total: 0, fast: 0, failed: 0 },
    newFree: { total: 0, lastAt: null },
    reservations: { reserved: 0, released: 0 },
};

function fakeDeps(patch: Partial<AppDeps> = {}): AppDeps {
    return {
        config,
        scheduleLog: { insertMany: async (entries) => entries.length, list: async () => emptyPage, listAll: async () => [] },
        requestLog: { insertMany: async (entries) => entries.length, list: async () => emptyPage },
        checks: { insertMany: async (entries) => entries.length, list: async () => emptyPage },
        reservationLog: { insertMany: async (entries) => entries.length, list: async () => emptyPage },
        summary: { summary: async () => emptySummary },
        pingDb: async () => {},
        ...patch,
    };
}

async function build(pingDb: () => Promise<void> = async () => {}) {
    const insertMany = vi.fn(async (entries: unknown[]) => entries.length);
    const app = await buildApp(fakeDeps({ pingDb, scheduleLog: { ...fakeDeps().scheduleLog, insertMany } }));
    return { app, insertMany };
}

describe('static files', () => {
    const slotsHtml = readFileSync(`${config.repoRoot}slots.html`, 'utf8');

    it('serves slots.html at /', async () => {
        const { app } = await build();
        const res = await app.inject({ url: '/' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.body).toBe(slotsHtml);
    });

    it('serves the locations reference as JSON', async () => {
        const { app } = await build();
        const res = await app.inject({ url: '/locations.json' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/json');
        expect(res.body).toBe(readFileSync(config.locationsPath, 'utf8'));
    });

    it('falls back to slots.html for any other non-api path', async () => {
        const { app } = await build();
        const res = await app.inject({ url: '/whatever/else' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(slotsHtml);
    });
});

describe('/next (web/dist)', () => {
    const dist = mkdtempSync(join(tmpdir(), 'dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>new</title>');
    writeFileSync(join(dist, 'assets', 'a.js'), 'console.log(1)');
    const buildWith = (webDistPath: string) =>
        buildApp(fakeDeps({ config: { ...config, webDistPath } }));

    it('serves index.html for /next/ and SPA routes', async () => {
        const app = await buildWith(dist);
        for (const url of ['/next/', '/next/slots']) {
            const res = await app.inject({ url });
            expect(res.statusCode).toBe(200);
            expect(res.body).toContain('<title>new</title>');
        }
    });

    it('serves real files and 404s a missing one with an extension', async () => {
        const app = await buildWith(dist);
        expect((await app.inject({ url: '/next/assets/a.js' })).body).toBe('console.log(1)');
        expect((await app.inject({ url: '/next/missing.js' })).statusCode).toBe(404);
    });

    it('answers 404 with a hint without dist, and / still serves slots.html', async () => {
        const app = await buildWith(join(dist, 'nope'));
        const res = await app.inject({ url: '/next/' });
        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('pnpm --dir web build');
        const root = await app.inject({ url: '/' });
        expect(root.body).toBe(readFileSync(`${config.repoRoot}slots.html`, 'utf8'));
    });
});

describe('/api', () => {
    it('reports health with the database up', async () => {
        const { app } = await build();
        const res = await app.inject({ url: '/api/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
    });

    it('answers 503 degraded when the database ping fails', async () => {
        const { app } = await build(async () => {
            throw new Error('connection refused');
        });
        const res = await app.inject({ url: '/api/health' });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
    });

    it('answers 404 JSON for an unknown api path', async () => {
        const { app } = await build();
        const res = await app.inject({ url: '/api/nope' });
        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']).toContain('application/json');
    });
});

describe('POST /schedule-log', () => {
    const entry = {
        time: '2026-10-09T10:00:00.000Z',
        institutionCode: 'NYC',
        institution: 'New York',
        type: 'baseline',
        changes: [],
    };

    it('stores a valid entry and answers 204', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/schedule-log', payload: entry });
        expect(res.statusCode).toBe(204);
        expect(insertMany).toHaveBeenCalledTimes(1);
    });

    it('answers 422 with issues for an unknown key and stores nothing', async () => {
        const { app, insertMany } = await build();
        const res = await app.inject({ method: 'POST', url: '/schedule-log', payload: { ...entry, token: 'x' } });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toMatchObject({ error: expect.any(String), issues: expect.any(Array) });
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('answers 500 without details when the repository throws', async () => {
        const app = await buildApp(fakeDeps({
            scheduleLog: {
                ...fakeDeps().scheduleLog,
                insertMany: async () => {
                    throw new Error('secret db detail');
                },
            },
        }));
        const res = await app.inject({ method: 'POST', url: '/schedule-log', payload: entry });
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toContain('secret db detail');
    });
});

describe('module routes', () => {
    it('serves the locations file at /api/locations', async () => {
        const { app } = await build();
        const res = await app.inject({ url: '/api/locations' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/json');
        expect(res.body).toBe(readFileSync(config.locationsPath, 'utf8'));
    });

    it('answers the GET routes of every module under /api', async () => {
        const { app } = await build();
        const from = '2026-10-09T00:00:00.000Z';
        const to = '2026-10-10T00:00:00.000Z';
        for (const url of ['/api/request-log', '/api/checks', '/api/reservation-log', '/api/schedule-log']) {
            const res = await app.inject({ url });
            expect(res.statusCode, url).toBe(200);
            expect(res.json()).toEqual(emptyPage);
        }
        const summary = await app.inject({ url: `/api/summary?from=${from}&to=${to}` });
        expect(summary.statusCode).toBe(200);
        expect((await app.inject({ url: '/api/schedule-log.jsonl' })).statusCode).toBe(200);
    });

    it('accepts POSTs of every module', async () => {
        const { app } = await build();
        for (const url of ['/api/request-log', '/api/checks', '/api/reservation-log', '/api/schedule-log']) {
            // an empty batch is invalid (422), which proves the route is registered and validated
            const res = await app.inject({ method: 'POST', url, payload: { entries: [] } });
            expect(res.statusCode, url).toBe(422);
        }
    });
});

describe('database down', () => {
    const down = (code: string, wrapped = false) => {
        const driver = Object.assign(new Error('down'), { code });
        return wrapped ? Object.assign(new Error('Failed query'), { cause: driver }) : driver;
    };

    it.each([['ECONNREFUSED'], ['57P01'], ['08006']])('answers 503 for /api when the repository fails with %s', async (code) => {
        const app = await buildApp(fakeDeps({
            checks: { ...fakeDeps().checks, list: async () => { throw down(code, true); } },
        }));
        const res = await app.inject({ url: '/api/checks' });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'Database unavailable' });
    });

    it('keeps 500 for other database errors', async () => {
        const app = await buildApp(fakeDeps({
            checks: { ...fakeDeps().checks, list: async () => { throw down('23505'); } },
        }));
        expect((await app.inject({ url: '/api/checks' })).statusCode).toBe(500);
    });
});
