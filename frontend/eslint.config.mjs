import tseslint from 'typescript-eslint'

// TypeScript performs type checks; ESLint guards common control-flow mistakes.
// Generated UI primitives are kept under their upstream tooling.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/components/ui/**'] },
  tseslint.configs.base,
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts', 'integration/**/*.ts', '*.config.ts'],
    rules: {
      'constructor-super': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    },
  },
]
