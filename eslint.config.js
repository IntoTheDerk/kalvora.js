import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import nPlugin from 'eslint-plugin-n';
import promisePlugin from 'eslint-plugin-promise';

export default [
  // Base JavaScript configuration
  js.configs.recommended,
  
  // TypeScript files configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        // Don't require project for all files to avoid parsing errors
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'import': importPlugin,
      'n': nPlugin,
      'promise': promisePlugin,
    },
    rules: {
      // TypeScript's compiler already reports undefined identifiers (and knows
      // DOM/Node lib types such as AbortSignal); `no-undef` only adds false
      // positives on TS files, per typescript-eslint guidance.
      'no-undef': 'off',
      // TypeScript specific rules
      ...typescript.configs.recommended.rules,
      
      // Import rules
      'import/order': ['error', {
        'groups': [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index'
        ],
        'newlines-between': 'always',
        'alphabetize': {
          'order': 'asc',
          'caseInsensitive': true
        }
      }],
      'import/no-unresolved': 'off', // TypeScript handles this
      'import/no-extraneous-dependencies': ['error', {
        'devDependencies': [
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/test/**/*',
          '**/tests/**/*',
          '**/examples/**/*',
          '**/scripts/**/*',
          'proto/build.ts',
          'publishing/**/*',
          '**/vitest.config.ts',
          '**/vitest.setup.ts'
        ]
      }],
      
      // Node.js rules
      'n/no-missing-import': 'off', // TypeScript handles this
      'n/no-unsupported-features/es-syntax': 'off', // TypeScript handles this
      
      // Promise rules
      'promise/always-return': 'error',
      'promise/catch-or-return': 'error',
      'promise/no-nesting': 'warn',
      
      // General code quality rules
      'no-console': 'off', // Allow console in development and test files
      'no-debugger': 'error',
      'no-unused-vars': 'off', // Use TypeScript version
      '@typescript-eslint/no-unused-vars': ['error', {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_'
      }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-var-requires': 'error',
      
      // Code style rules
      'indent': ['error', 2],
      'quotes': ['error', 'single', { 'avoidEscape': true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': ['error', {
        'anonymous': 'always',
        'named': 'never',
        'asyncArrow': 'always'
      }],
      
      // Best practices
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-await': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'template-curly-spacing': ['error', 'never'],
      
      // Async/await rules
      'require-await': 'off', // Use TypeScript version
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off'
    },
  },
  
  // Adapter files — browser environment (window, sessionStorage, etc.)
  {
    files: ['src/adapter/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        sessionStorage: 'readonly',
        localStorage: 'readonly',
        URL: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        location: 'readonly',
      },
    },
  },
  
  // JavaScript files configuration
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
      },
    },
    plugins: {
      'import': importPlugin,
      'n': nPlugin,
      'promise': promisePlugin,
    },
    rules: {
      'import/order': ['error', {
        'groups': [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index'
        ],
        'newlines-between': 'always',
        'alphabetize': {
          'order': 'asc',
          'caseInsensitive': true
        }
      }],
      'no-console': 'off', // Allow console in development and test files
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  
  // Test files configuration
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*', '**/tests/**/*'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        // Don't require project for test files to avoid parsing errors
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'import': importPlugin,
      'n': nPlugin,
      'promise': promisePlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      'import/no-extraneous-dependencies': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      'no-useless-catch': 'off',
      'no-return-await': 'off',
      'eqeqeq': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      'no-case-declarations': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  
  // Configuration files
  {
    files: ['**/*.config.js', '**/*.config.ts', '**/scripts/**/*', '**/examples/**/*', '**/proto/**/*'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        // Don't require project for config files to avoid parsing errors
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      'import/no-extraneous-dependencies': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      'no-useless-catch': 'off',
      'no-return-await': 'off',
      'eqeqeq': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      'no-case-declarations': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'proto/generated/**',
      'coverage/**',
      'docs/api/**',
      '*.min.js',
      '*.bundle.js'
    ],
  },
];
