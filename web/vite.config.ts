import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Until stage 8 of the rewrite plan the new app lives under /next/ and slots.html stays on /.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
    base: '/next/',
    // The app version written into every log entry (appVersion)
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
    plugins: [react()],
    resolve: {
        alias: {
            '@/': fileURLToPath(new URL('./src/', import.meta.url)),
            // Canonical API schemas of the server module (plan §3)
            '@contracts/': fileURLToPath(new URL('../server/src/contracts/', import.meta.url)),
        },
    },
    server: {
        host: '127.0.0.1',
        port: 3000,
        strictPort: true,
        proxy: { '/api': 'http://127.0.0.1:3001' },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['src/test/setup.ts'],
        css: false,
    },
});
