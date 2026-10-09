import { defineConfig } from 'drizzle-kit';
import { DEFAULT_DATABASE_URL } from './src/platform/config.ts';

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/db/schema/index.ts',
    out: './src/db/migrations',
    dbCredentials: { url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL },
    strict: true,
});
