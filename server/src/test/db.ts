import { sql } from 'drizzle-orm';
import { createDb } from '../db/client.ts';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
    ?? 'postgres://econsul:econsul@127.0.0.1:5433/econsul_test';

// For *.it.test.ts: a connection to the test database and a way to empty the tables a test uses.
export function createTestDb() {
    const { db, close } = createDb(TEST_DATABASE_URL);
    return {
        db,
        close,
        truncate: (...tables: string[]) =>
            db.execute(sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`)),
    };
}
