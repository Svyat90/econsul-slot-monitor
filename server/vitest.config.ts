import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        // Integration tests share one Postgres database: run files one by one.
        fileParallelism: false,
        globalSetup: ['src/test/global-setup.ts'],
    },
});
