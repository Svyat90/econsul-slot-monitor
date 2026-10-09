// Rings of the server (onion-architecture §11, references/enforcement.md). `pnpm arch:check`.
// The web app's own rules live in web/.dependency-cruiser.cjs.
module.exports = {
    forbidden: [
        {
            name: 'contracts-are-the-core',
            comment: 'Innermost ring; web and the extension use it too.',
            severity: 'error',
            from: { path: '^src/contracts/' },
            to: { pathNot: ['^src/contracts/', 'node_modules/zod/'] },
        },
        {
            name: 'server-routes-do-not-touch-the-db',
            comment: 'Routes call the service; only repositories talk to Drizzle.',
            severity: 'error',
            from: { path: '^src/modules/[^/]+/routes\\.ts$' },
            to: { path: ['^src/db/', 'node_modules/drizzle-orm/'] },
        },
        {
            name: 'server-services-do-not-know-the-orm',
            comment: 'Services depend on repository ports, not on Drizzle.',
            severity: 'error',
            from: { path: '^src/modules/[^/]+/service\\.ts$' },
            to: { path: ['^src/db/', 'node_modules/drizzle-orm/'] },
        },
        {
            name: 'server-never-calls-econsul',
            comment: 'e-Consul is called from the browser only. No HTTP clients on the server.',
            severity: 'error',
            from: { path: '^src/' },
            to: { path: ['node_modules/undici/', 'node_modules/node-fetch/', 'node_modules/axios/'] },
        },
        { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
        exclude: { path: ['\\.test\\.ts$', '^src/test/'] },
    },
};
