import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(databaseUrl: string) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const db = drizzle(pool, { schema });
    return { db, close: () => pool.end() };
}
