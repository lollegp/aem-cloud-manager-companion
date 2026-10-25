import js from '@eslint/js';

const readonly = names => Object.fromEntries(names.map(name => [name, 'readonly']));
const webGlobals = readonly([
    'AbortController', 'AbortSignal', 'Blob', 'DOMException', 'Event', 'Headers',
    'Map', 'Promise', 'Set', 'TextDecoder', 'TextEncoder', 'URL', 'URLSearchParams',
    'atob', 'btoa', 'chrome', 'clearTimeout', 'confirm', 'console', 'crypto', 'document',
    'getComputedStyle', 'innerWidth', 'queueMicrotask',
    'fetch', 'localStorage', 'location', 'navigator', 'performance',
    'sessionStorage', 'setTimeout', 'structuredClone', 'window'
]);

export default [
    {ignores: ['node_modules/**', 'dist/**', '.playwright-mcp/**', '.serena/**']},
    js.configs.recommended,
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {ecmaVersion: 2024, sourceType: 'module', globals: webGlobals},
        linterOptions: {reportUnusedDisableDirectives: 'error'},
        rules: {
            'eqeqeq': ['error', 'always', {null: 'ignore'}],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}]
        }
    },
    {
        files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
        languageOptions: {globals: readonly(['Buffer', 'process', 'setImmediate'])}
    },
    {
        files: ['tests/*browser*.mjs'],
        languageOptions: {globals: readonly(['fixtureLocal', 'fixtureSession', 'fixtureAccess', 'fixtureStorageWrites', 'sendFrom', 'settingsOpened'])}
    }
];
