// Flat config (ESLint 9).
//
// Division of labour: Prettier owns whitespace and line breaks; ESLint owns
// rules that change structure or catch real mistakes. The important one here
// is `curly`, which turns
//     if (a) { b(); c(); }
// into a real block that Prettier then expands onto separate lines.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

/** Style rules applied everywhere, whatever the language. */
const style = {
  curly: ['error', 'all'],
  'brace-style': ['error', '1tbs', { allowSingleLine: false }],
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': 'error',
};

module.exports = [
  { ignores: ['out/**', 'node_modules/**', 'media/vendor/**', '*.vsix'] },

  js.configs.recommended,

  // TypeScript rules must be scoped to TypeScript. Spread unscoped they also
  // hit plain .js files, where they flag ordinary CommonJS `require` calls.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['src/**/*.ts'] })),

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json' },
      globals: { ...globals.node },
    },
    rules: {
      ...style,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  {
    // The webview runs in a browser, with globals injected by VS Code and by
    // the vendored libraries.
    files: ['media/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        CodeMirror: 'readonly',
        marked: 'readonly',
        DOMPurify: 'readonly',
        hljs: 'readonly',
        acquireVsCodeApi: 'readonly',
      },
    },
    rules: { ...style, 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },

  {
    files: ['scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { ...style, 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },

  {
    // Tests are Node, but page.evaluate() callbacks are serialised and run in
    // the browser — so both global sets are legitimately in scope here.
    files: ['test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { ...style, 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
];
