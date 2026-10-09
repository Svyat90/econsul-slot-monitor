// Rings of the web app (onion-architecture §2–3, references/enforcement.md). `pnpm arch:check`.
// The server's own rules live in server/.dependency-cruiser.cjs.
module.exports = {
    forbidden: [
        {
            name: 'contracts-are-the-core',
            comment: 'Innermost ring; the extension uses it too.',
            severity: 'error',
            from: { path: '^src/domain/contracts/' },
            to: { pathNot: ['^src/domain/contracts/', 'node_modules/zod/', '^\\.\\./server/src/contracts/'] },
        },
        {
            name: 'domain-is-pure',
            severity: 'error',
            from: { path: '^src/domain/' },
            to: { path: ['node_modules/react/', 'node_modules/react-dom/', '^src/(application|adapters|app|features)/', '^\\.\\./server/(?!src/contracts/)'] },
        },
        {
            name: 'application-is-framework-free',
            severity: 'error',
            from: { path: '^src/application/' },
            to: { path: ['node_modules/react/', 'node_modules/react-dom/', '^src/(adapters|app|features)/', '^\\.\\./server/'] },
        },
        {
            name: 'ui-does-not-touch-adapters',
            comment: 'Only the composition root (src/app/providers.tsx) picks implementations.',
            severity: 'error',
            from: { path: '^src/(features|app)/', pathNot: '^src/app/providers\\.tsx$' },
            to: { path: '^src/adapters/' },
        },
        {
            name: 'web-does-not-import-server',
            comment: 'Over HTTP only. Exception: the canonical API schemas, aliased as @contracts (plan §3).',
            severity: 'error',
            from: { path: '^src/' },
            to: { path: '^\\.\\./server/', pathNot: '^\\.\\./server/src/contracts/' },
        },
        {
            name: 'adapters-are-leaves',
            severity: 'error',
            from: { path: '^src/adapters/([^/]+)/' },
            to: { path: ['^src/adapters/', '^src/(application/(?!ports\\.ts$)|features|app)/'], pathNot: ['^src/adapters/$1/', '^src/adapters/_shared/'] },
        },
        {
            name: 'no-cross-feature-imports',
            severity: 'error',
            from: { path: '^src/features/([^/]+)/' },
            to: { path: '^src/features/', pathNot: '^src/features/$1/' },
        },
        {
            name: 'extension-uses-contracts-only',
            severity: 'error',
            from: { path: '^\\.\\./extension/' },
            to: { path: '^src/', pathNot: '^src/domain/contracts/' },
        },
        { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
        exclude: { path: ['\\.test\\.tsx?$', '^src/test/'] },
    },
};
