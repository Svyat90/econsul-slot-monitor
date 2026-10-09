import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { DEFAULT_DATABASE_URL } from '../platform/config.ts';
import { TEST_DATABASE_URL } from './db.ts';

// Integration tests never touch the real log: they get their own database, migrated before the run.
export default async function setup() {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
    await admin.connect();
    const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();

    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    await migrate(drizzle(pool), { migrationsFolder: new URL('../db/migrations', import.meta.url).pathname });
    await pool.end();
}
