import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface Config {
    host: string;
    port: number;
    databaseUrl: string;
    repoRoot: string; // slots.html and web/dist are served from here
    locationsPath: string;
    webDistPath: string; // the only directory @fastify/static may serve
}

export const DEFAULT_DATABASE_URL = 'postgres://econsul:econsul@127.0.0.1:5433/econsul';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    return {
        host: '127.0.0.1',
        port: Number(env.PORT ?? 3000),
        databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
        repoRoot,
        locationsPath: fileURLToPath(new URL('../../data/locations.json', import.meta.url)),
        webDistPath: `${repoRoot}web/dist`,
    };
}
