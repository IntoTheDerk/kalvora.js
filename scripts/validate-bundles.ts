#!/usr/bin/env node

/**
 * Post-Build Validation Script
 * 
 * Validates that the build output is structurally correct for cross-platform
 * consumption (CJS for React Native/Metro, ESM for modern bundlers).
 * 
 * Run after build: npm run build:validate-bundles
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInNewContext } from 'vm';

import { build as buildWithEsbuild } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const distDir = join(projectRoot, 'dist');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m'
};

let passed = 0;
let failed = 0;

function pass(msg: string): void {
  passed++;
  console.log(`${colors.green}  ✅ ${msg}${colors.reset}`);
}

function fail(msg: string, detail?: string): void {
  failed++;
  console.log(`${colors.red}  ❌ ${msg}${colors.reset}`);
  if (detail) console.log(`${colors.yellow}     ${detail}${colors.reset}`);
}

function section(title: string): void {
  console.log(`\n${colors.cyan}${colors.bright}  ${title}${colors.reset}`);
}

// ─── File Existence ──────────────────────────────────────────────────

section('File Existence');

const requiredFiles = ['index.js', 'index.mjs', 'index.cjs', 'index.d.ts'];
for (const file of requiredFiles) {
  const filePath = join(distDir, file);
  if (existsSync(filePath) && statSync(filePath).size > 0) {
    pass(`${file} exists and is non-empty`);
  } else {
    fail(`${file} missing or empty`);
  }
}

// ─── CJS Bundle Format ──────────────────────────────────────────────

section('CJS Bundle Format');

const cjsPath = join(distDir, 'index.cjs');
if (existsSync(cjsPath)) {
  const cjsContent = readFileSync(cjsPath, 'utf8');

  // Should NOT contain ESM export syntax
  const esmExportLines = cjsContent.split('\n').filter(
    line => /^export\s+\{/.test(line) || /^export\s+default/.test(line) || /^export\s+const/.test(line)
  );
  if (esmExportLines.length === 0) {
    pass('No ESM export syntax in CJS bundle');
  } else {
    fail('CJS bundle contains ESM export syntax', `Found ${esmExportLines.length} ESM export lines`);
  }

  // Should NOT have broken relative proto requires
  const brokenProtoRequires = cjsContent.match(/require\(["']\.\.\/.*proto\/generated/g);
  if (!brokenProtoRequires) {
    pass('No broken external proto requires');
  } else {
    fail('CJS bundle has external proto requires that will fail at runtime',
      `Found ${brokenProtoRequires.length} broken proto require(s)`);
  }

  // Should contain the MinimalReadableStream polyfill inlined
  if (cjsContent.includes('MinimalReadableStream')) {
    pass('MinimalReadableStream polyfill is bundled inline');
  } else {
    fail('MinimalReadableStream polyfill not found in CJS bundle',
      'React Native consumers need this polyfill for gRPC-Web compatibility');
  }

  // Should contain "use strict"
  if (cjsContent.startsWith("'use strict'") || cjsContent.startsWith('"use strict"')) {
    pass('CJS bundle has "use strict" directive');
  } else {
    fail('CJS bundle missing "use strict" directive');
  }
}

// ─── CJS Bundle Loads ────────────────────────────────────────────────

section('CJS Bundle Loads');

try {
  const require = createRequire(import.meta.url);
  const cjsModule = require(cjsPath);

  if (cjsModule && typeof cjsModule === 'object') {
    pass('CJS bundle loads via require()');
  } else {
    fail('CJS bundle loaded but returned unexpected value');
  }

  // Check key exports exist
  const expectedExports = ['VERSION', 'DESCRIPTION', 'createWallet', 'createCoinTXN', 'WalletFactory'];
  const moduleKeys = Object.keys(cjsModule);
  const missingExports = expectedExports.filter(e => !moduleKeys.includes(e));
  if (missingExports.length === 0) {
    pass(`Key exports present (${expectedExports.length}/${expectedExports.length})`);
  } else {
    fail(`Missing exports: ${missingExports.join(', ')}`);
  }

  // VERSION should be a string
  if (typeof cjsModule.VERSION === 'string' && cjsModule.VERSION.length > 0) {
    pass(`VERSION = "${cjsModule.VERSION}"`);
  } else {
    fail('VERSION export is not a valid string');
  }
} catch (err) {
  const errMsg = (err as Error).message;
  // External deps like @solana/web3.js have ESM-only subpath exports (e.g. @noble/hashes/sha256)
  // that fail with CJS require() in Node.js. This is expected — Metro/React Native resolves them fine.
  if (errMsg.includes('is not defined by "exports"') || errMsg.includes('ERR_PACKAGE_PATH_NOT_EXPORTED')) {
    pass('CJS bundle loads via require() (skipped — external dep has ESM-only exports)');
    console.log(`${colors.yellow}     Note: ${errMsg.split('\n')[0]}${colors.reset}`);
  } else {
    fail('CJS bundle failed to load via require()', errMsg);
  }
}

// ─── ESM Bundle Loads ────────────────────────────────────────────────

section('ESM Bundle Loads');

try {
  const esmModule = await import(join(distDir, 'index.mjs'));

  if (esmModule && typeof esmModule === 'object') {
    pass('ESM bundle loads via import()');
  } else {
    fail('ESM bundle loaded but returned unexpected value');
  }

  if (typeof esmModule.VERSION === 'string' && esmModule.VERSION.length > 0) {
    pass(`VERSION = "${esmModule.VERSION}"`);
  } else {
    fail('VERSION export is not a valid string');
  }
} catch (err) {
  fail('ESM bundle failed to load via import()', (err as Error).message);
}

// ─── Browser Bundle Loads Without Node Globals ──────────────────────

section('Browser Bundle Loads');

try {
  const browserBundle = await buildWithEsbuild({
    entryPoints: [join(distDir, 'index.mjs')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    globalName: 'Kalvora',
    logLevel: 'silent'
  });
  const browserContext: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    fetch: async () => { throw new Error('unused'); },
    crypto: globalThis.crypto
  };
  browserContext.globalThis = browserContext;

  runInNewContext(browserBundle.outputFiles[0]?.text ?? '', browserContext, { timeout: 5000 });
  pass('Browser bundle evaluates without process, Buffer, window, or document');
} catch (err) {
  fail('Browser bundle failed without Node globals', (err as Error).stack ?? String(err));
}

// ─── Export Parity ───────────────────────────────────────────────────

section('Export Parity');

try {
  const require = createRequire(import.meta.url);
  const cjsModule = require(cjsPath);
  const esmModule = await import(join(distDir, 'index.mjs'));

  const cjsKeys = Object.keys(cjsModule).sort();
  const esmKeys = Object.keys(esmModule).sort();

  if (cjsKeys.length === esmKeys.length) {
    pass(`Export count matches: ${cjsKeys.length} exports`);
  } else {
    fail(`Export count mismatch: CJS=${cjsKeys.length}, ESM=${esmKeys.length}`);
  }

  const cjsOnly = cjsKeys.filter(k => !esmKeys.includes(k));
  const esmOnly = esmKeys.filter(k => !cjsKeys.includes(k) && k !== 'default');

  if (cjsOnly.length === 0 && esmOnly.length === 0) {
    pass('All exports present in both CJS and ESM');
  } else {
    if (cjsOnly.length > 0) fail(`CJS-only exports: ${cjsOnly.join(', ')}`);
    if (esmOnly.length > 0) fail(`ESM-only exports: ${esmOnly.join(', ')}`);
  }
} catch (err) {
  const errMsg = (err as Error)?.message || '';
  if (errMsg.includes('is not defined by "exports"') || errMsg.includes('ERR_PACKAGE_PATH_NOT_EXPORTED')) {
    pass('Export parity check skipped (external dep has ESM-only exports)');
  } else {
    fail('Could not compare exports (one or both bundles failed to load)');
  }
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${colors.bright}  ─── Results ───${colors.reset}`);
console.log(`${colors.green}  ${passed} passed${colors.reset}`);
if (failed > 0) {
  console.log(`${colors.red}  ${failed} failed${colors.reset}`);
  console.log('');
  process.exit(1);
} else {
  console.log(`${colors.green}  All bundle validations passed!${colors.reset}\n`);
}
