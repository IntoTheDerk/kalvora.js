import { resolve } from 'path';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  
  // Resolve configuration
  resolve: {
    conditions: ['import'],
    alias: {
      '@bufbuild/protobuf/codegenv2': resolve(__dirname, './node_modules/@bufbuild/protobuf/dist/esm/codegenv2/index.js'),
      '@': resolve(__dirname, './src'),
      '@types': resolve(__dirname, './src/types'),
      '@wallet': resolve(__dirname, './src/wallet-creation'),
      '@coin-txn': resolve(__dirname, './src/coin-txn'),
      '@grpc': resolve(__dirname, './src/grpc'),
      '@shared': resolve(__dirname, './src/shared'),
      '@api': resolve(__dirname, './src/api'),
      '@test-utils': resolve(__dirname, './src/test-utils')
    }
  },
  
  // ESM configuration
  esbuild: {
    target: 'node18'
  },
  
  // Define external dependencies that should not be bundled
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'test')
  },
  
  // Bundle the noble crypto packages (ESM-only subpath exports) for tests
  ssr: {
    noExternal: ['@noble/hashes', '@noble/curves']
  },
  
  // Test dependency configuration for Node.js modules
  test: {
    // Test file patterns
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'src/**/test-*.{js,ts}',
      'src/**/tests/*.{js,ts}',
      'src/**/test/*.{js,ts}',
      'src/**/tests/**/*.{js,ts}'
    ],
    
    // Exclude patterns
    exclude: [
      'node_modules',
      'dist',
      'proto',
      '**/*.d.ts',
      'src/test-utils/**', // Exclude test utilities directory
      'src/**/examples/**' // Exclude examples directory
    ],
    
    // Environment
    environment: 'node',
    
    // Globals (describe, it, expect available without imports)
    globals: true,
    
    // Setup files
    setupFiles: ['./vitest.setup.ts'],
    
    // TypeScript support
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json'
    },
    
    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'proto/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/test-utils/**'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    
    // Test timeout
    testTimeout: 10000,
    
    reporters: ['default'],
    
    // Watch mode
    watch: false,
    
    // Pool configuration for better Node.js module handling
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    
    // Only show console output from failing tests
    silent: 'passed-only',
    
    // Dependency configuration for Node.js modules
    deps: {
      inline: ['@bufbuild/protobuf', '@connectrpc/connect', '@connectrpc/connect-web']
    },
    
    // Node.js compatibility for gRPC
    environmentOptions: {
      node: {
        experimentalSpecifierResolution: 'node'
      }
    }
  }
});
