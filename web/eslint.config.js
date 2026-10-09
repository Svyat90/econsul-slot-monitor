import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// The clock, randomness, timers and browser I/O stay behind ports (onion-architecture §9).
const impureGlobals = ['fetch', 'localStorage', 'sessionStorage', 'window', 'document', 'chrome',
    'Notification', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'navigator', 'location']
    .map((name) => ({ name, message: 'Keep browser I/O and timers behind a port (onion-architecture §9).' }));

export default tseslint.config(
    { ignores: ['dist'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        rules: { ...reactHooks.configs.recommended.rules },
    },
    {
        files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
        ignores: ['**/*.test.ts'],
        rules: {
            'no-restricted-globals': ['error', ...impureGlobals],
            'no-restricted-syntax': ['error',
                { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Use the Clock port.' },
                { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Use the Clock port.' },
                { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Use the Random port.' },
            ],
        },
    },
);
