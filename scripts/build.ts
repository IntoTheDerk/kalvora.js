#!/usr/bin/env node

/**
 * TypeScript Build Script for Kalvora JS SDK
 * 
 * This script handles the complete TypeScript build process including:
 * - Type checking
 * - Compilation to JavaScript
 * - Declaration file generation
 * - Source map generation
 * - ESM module generation
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function exec(command: string, options: any = {}): void {
  try {
    execSync(command, { 
      stdio: 'inherit', 
      cwd: projectRoot,
      ...options 
    });
  } catch (error) {
    log(`❌ Command failed: ${command}`, colors.red);
    throw error;
  }
}

function execSilent(command: string, options: any = {}): string {
  try {
    return execSync(command, { 
      encoding: 'utf8' as const,
      cwd: projectRoot,
      stdio: 'pipe' as const,
      ...options 
    }).trim();
  } catch (error) {
    return '';
  }
}

/**
 * Verify that build prerequisites are installed.
 *
 * The build never installs packages itself (no global installs, no implicit
 * `npm install`); it fails fast with the command to run instead.
 */
function checkAndFixDependencies(): void {
  log('🔍 Checking build dependencies...', colors.cyan);
  const missing: string[] = [];
  for (const pkg of ['typescript', 'eslint', 'esbuild']) {
    if (!existsSync(join(projectRoot, 'node_modules', pkg))) missing.push(`node_modules/${pkg} (run: npm install)`);
  }
  for (const pkg of ['@bufbuild/buf', '@bufbuild/protoc-gen-es']) {
    if (!existsSync(join(projectRoot, 'proto', 'node_modules', pkg))) missing.push(`proto/node_modules/${pkg} (run: npm run proto:install)`);
  }
  if (missing.length > 0) {
    log('❌ Missing build dependencies:', colors.red);
    for (const item of missing) log(`   - ${item}`, colors.yellow);
    throw new Error('Build dependencies are not installed');
  }
  log('✅ All dependencies are properly installed', colors.green);
}

function cleanDist(): void {
  log('🧹 Cleaning dist directory...', colors.yellow);
  const distPath = join(projectRoot, 'dist');
  
  if (existsSync(distPath)) {
    rmSync(distPath, { recursive: true, force: true });
  }
  
  mkdirSync(distPath, { recursive: true });
  log('✅ Dist directory cleaned', colors.green);
}

function lintCode(): void {
  // Check only: a build must never rewrite source files.
  log('🔍 Running ESLint check...', colors.blue);
  try {
    exec('npm run lint:check');
    log('✅ Linting passed', colors.green);
  } catch (error) {
    log('❌ Linting failed! Run `npm run lint:fix` and fix remaining issues.', colors.red);
    throw error;
  }
}

function typeCheck(): void {
  log('🔍 Running TypeScript type checking...', colors.blue);
  try {
    exec('npx tsc --noEmit --skipLibCheck');
    log('✅ Type checking passed', colors.green);
  } catch (error) {
    log('❌ Type checking failed!', colors.red);
    throw error;
  }
}

function compileTypeScript(): void {
  log('🔨 Compiling TypeScript to JavaScript...', colors.blue);
  try {
    exec('npx tsc');
    log('✅ TypeScript compilation completed', colors.green);
  } catch (error) {
    log('❌ TypeScript compilation failed!', colors.red);
    throw error;
  }
}

function generateESM(): void {
  log('📦 Generating ESM modules...', colors.blue);
  
  // Copy the main index.js to index.mjs for ESM
  const indexJsPath = join(projectRoot, 'dist', 'index.js');
  const indexMjsPath = join(projectRoot, 'dist', 'index.mjs');
  
  if (existsSync(indexJsPath)) {
    cpSync(indexJsPath, indexMjsPath);
    log('✅ ESM modules generated', colors.green);
  } else {
    log('⚠️  index.js not found, skipping ESM generation...', colors.yellow);
  }
}

function generateCJS(): void {
  log('📦 Generating CJS bundle with esbuild...', colors.blue);

  // Bundle everything inline for maximum compatibility across environments.
  // React Native (Metro/Hermes) has issues with:
  //   - ESM-only subpath exports (@noble/hashes/sha256)
  //   - WHATWG ReadableStream polyfills (@connectrpc/connect)
  //   - process.version access at module load time (readable-stream@2.x)
  // A fully self-contained CJS bundle avoids all of these.
  // NOTE: platform=node leaves Node built-ins (buffer, crypto, etc.) as external.
  // Metro has a dependency indexing bug where require("buffer") from this CJS bundle
  // resolves to crypto-browserify instead of the buffer package. We patch the output
  // post-build to use globalThis.Buffer directly, bypassing Metro's broken resolution.
  try {
    exec(
      'npx esbuild dist/index.js ' +
      '--bundle ' +
      '--format=cjs ' +
      '--platform=node ' +
      '--target=es2020 ' +
      '--alias:bigint-buffer=./node_modules/bigint-buffer/dist/browser.js ' +
      '--outfile=dist/index.cjs ' +
      '--sourcemap ' +
      '--banner:js="\'use strict\';"'
    );

    // Post-build: Patch ALL external Node built-in require() calls.
    //
    // esbuild --platform=node leaves Node built-ins (buffer, crypto, stream, etc.)
    // as external require() calls. Metro has a dependency-map indexing bug where
    // these external requires inside a CJS bundle get assigned incorrect or
    // undefined module IDs, causing runtime crashes like:
    //   - "Requiring unknown module undefined"
    //   - require("buffer") resolving to crypto-browserify
    //
    // Strategy: Replace require("X") with __tryRequire("X", fallback).
    // __tryRequire uses module.require() which is INVISIBLE to Metro's static
    // analysis (Metro only scans bare require() calls). In Node.js, module.require()
    // resolves normally. In React Native, it fails and the inline fallback is used.
    //
    // Buffer is special-cased: it always uses the globalThis.Buffer polyfill
    // because Metro's dep indexing bug specifically affects buffer resolution.
    log('🔧 Patching Node built-in requires in CJS bundle...', colors.blue);
    const cjsPath = join('dist', 'index.cjs');
    let cjsContent = readFileSync(cjsPath, 'utf8');
    let totalPatched = 0;

    // Inject the __tryRequire helper right after 'use strict'; at the top.
    // Uses module.require() which Metro does NOT process in its dep scanner.
    const tryRequireHelper = `
var __tryRequire = function(name, fallback) {
  try { return module.require(name); } catch(e) { return fallback; }
};
`;
    // Insert after the 'use strict'; banner
    cjsContent = cjsContent.replace(
      /^'use strict';/,
      `'use strict';${tryRequireHelper}`
    );

    // Define shims for each Node built-in.
    // Order matters: more specific patterns (node:crypto) before generic (crypto).
    // buffer always uses globalThis.Buffer (never falls through to module.require)
    // because Metro's dep indexing bug specifically corrupts buffer resolution.
    const shimMap: Array<{pattern: RegExp; shim: string; label: string}> = [
      // --- Buffer: ALWAYS use globalThis polyfill (Metro dep index bug) ---
      {
        pattern: /require\("buffer"\)/g,
        shim: '({Buffer: globalThis.Buffer, isUtf8: function(b){ return false; }, SlowBuffer: globalThis.Buffer, INSPECT_MAX_BYTES: 50, kMaxLength: 2147483647})',
        label: 'buffer'
      },
      // --- All other Node built-ins: try native, fallback to stub ---
      {
        pattern: /require\("node:crypto"\)/g,
        shim: '__tryRequire("node:crypto", globalThis.crypto || {})',
        label: 'node:crypto'
      },
      {
        pattern: /require\("crypto"\)/g,
        shim: '__tryRequire("crypto", globalThis.crypto || {})',
        label: 'crypto'
      },
      {
        pattern: /require\("events"\)/g,
        shim: '__tryRequire("events", (function(){function E(){this._e={}}E.prototype.on=function(n,f){(this._e[n]=this._e[n]||[]).push(f);return this};E.prototype.off=function(n,f){var a=this._e[n];if(a)this._e[n]=a.filter(function(x){return x!==f});return this};E.prototype.emit=function(n){var a=this._e[n];if(a)a.slice().forEach(function(f){f.apply(null,[].slice.call(arguments,1))});return this};E.prototype.removeListener=E.prototype.off;E.prototype.addListener=E.prototype.on;E.prototype.removeAllListeners=function(n){if(n)delete this._e[n];else this._e={};return this};E.prototype.setMaxListeners=function(){return this};E.EventEmitter=E;E.defaultMaxListeners=10;return E}()))',
        label: 'events'
      },
      {
        pattern: /require\("stream"\)/g,
        shim: '__tryRequire("stream", {Readable:function(){},Writable:function(){},Transform:function(){},PassThrough:function(){},pipeline:function(){},finished:function(){}})',
        label: 'stream'
      },
      {
        pattern: /require\("http"\)/g,
        shim: '__tryRequire("http", {Agent:function(){},globalAgent:{},request:function(){},get:function(){},METHODS:[],STATUS_CODES:{}})',
        label: 'http'
      },
      {
        pattern: /require\("https"\)/g,
        shim: '__tryRequire("https", {Agent:function(){},globalAgent:{},request:function(){},get:function(){}})',
        label: 'https'
      },
      {
        pattern: /require\("util"\)/g,
        shim: '__tryRequire("util", {inherits:function(c,s){c.super_=s;c.prototype=Object.create(s.prototype,{constructor:{value:c}})},deprecate:function(f){return f},promisify:function(f){return f},debuglog:function(){return function(){}},inspect:function(o){return String(o)},format:function(){return[].slice.call(arguments).join(" ")},TextEncoder:globalThis.TextEncoder,TextDecoder:globalThis.TextDecoder,types:{isUint8Array:function(v){return v instanceof Uint8Array}}})',
        label: 'util'
      },
      {
        pattern: /require\("url"\)/g,
        shim: '__tryRequire("url", {parse:function(u){try{var o=new URL(u);return{protocol:o.protocol,hostname:o.hostname,host:o.host,port:o.port,pathname:o.pathname,search:o.search,hash:o.hash,href:o.href,path:o.pathname+o.search}}catch(e){return{}}},resolve:function(f,t){try{return new URL(t,f).href}catch(e){return t}},URL:globalThis.URL,URLSearchParams:globalThis.URLSearchParams,format:function(o){return o.href||""}})',
        label: 'url'
      },
      {
        pattern: /require\("zlib"\)/g,
        shim: '__tryRequire("zlib", {createGunzip:function(){},createInflate:function(){},createDeflate:function(){}})',
        label: 'zlib'
      },
      {
        pattern: /require\("fs"\)/g,
        shim: '__tryRequire("fs", {readFileSync:function(){},writeFileSync:function(){},existsSync:function(){return false},promises:{readFile:function(){return Promise.reject(new Error("fs not available"))},writeFile:function(){return Promise.reject(new Error("fs not available"))}}})',
        label: 'fs'
      },
      {
        pattern: /require\("fs\/promises"\)/g,
        shim: '__tryRequire("fs/promises", {readFile:function(){return Promise.reject(new Error("fs not available"))},writeFile:function(){return Promise.reject(new Error("fs not available"))}})',
        label: 'fs/promises'
      },
      {
        pattern: /require\("path"\)/g,
        shim: '__tryRequire("path", {join:function(){return[].slice.call(arguments).join("/")},resolve:function(){return[].slice.call(arguments).join("/")},basename:function(p){return p.split("/").pop()},dirname:function(p){var s=p.split("/");s.pop();return s.join("/")},extname:function(p){var m=p.match(/\\.[^.]+$/);return m?m[0]:""},sep:"/",delimiter:":"})',
        label: 'path'
      },
      {
        pattern: /require\("os"\)/g,
        shim: '__tryRequire("os", {platform:function(){return"react-native"},arch:function(){return"arm64"},tmpdir:function(){return"/tmp"},homedir:function(){return"/"},EOL:"\\n",cpus:function(){return[]}})',
        label: 'os'
      },
      {
        pattern: /require\("net"\)/g,
        shim: '__tryRequire("net", {Socket:function(){},createConnection:function(){},connect:function(){},createServer:function(){},isIP:function(){return 0}})',
        label: 'net'
      },
      {
        pattern: /require\("tls"\)/g,
        shim: '__tryRequire("tls", {connect:function(){},createSecureContext:function(){},TLSSocket:function(){}})',
        label: 'tls'
      },
      {
        pattern: /require\("punycode"\)/g,
        shim: '__tryRequire("punycode", {encode:function(s){return s},decode:function(s){return s},toASCII:function(s){return s},toUnicode:function(s){return s}})',
        label: 'punycode'
      },
      {
        pattern: /require\("encoding"\)/g,
        shim: '__tryRequire("encoding", {convert:function(b){return b}})',
        label: 'encoding'
      },
      {
        pattern: /require\("dns"\)/g,
        shim: '__tryRequire("dns", {lookup:function(){},resolve:function(){}})',
        label: 'dns'
      },
      {
        pattern: /require\("dgram"\)/g,
        shim: '__tryRequire("dgram", {createSocket:function(){}})',
        label: 'dgram'
      },
      {
        pattern: /require\("child_process"\)/g,
        shim: '__tryRequire("child_process", {exec:function(){},spawn:function(){},execSync:function(){}})',
        label: 'child_process'
      },
      {
        pattern: /require\("assert"\)/g,
        shim: '__tryRequire("assert", function assert(v,m){if(!v)throw new Error(m||"Assertion failed")})',
        label: 'assert'
      },
      {
        pattern: /require\("string_decoder"\)/g,
        shim: '__tryRequire("string_decoder", {StringDecoder:function(){this.write=function(b){return String(b)};this.end=function(){return ""}}})',
        label: 'string_decoder'
      },
      // node: prefixed variants
      {
        pattern: /require\("node:stream"\)/g,
        shim: '__tryRequire("node:stream", {Readable:function(){},Writable:function(){},Transform:function(){},PassThrough:function(){}})',
        label: 'node:stream'
      },
      {
        pattern: /require\("node:buffer"\)/g,
        shim: '({Buffer: globalThis.Buffer, isUtf8: function(b){ return false; }})',
        label: 'node:buffer'
      },
      {
        pattern: /require\("node:events"\)/g,
        shim: '__tryRequire("node:events", {EventEmitter:function(){this._e={}}})',
        label: 'node:events'
      },
      {
        pattern: /require\("node:util"\)/g,
        shim: '__tryRequire("node:util", {inherits:function(c,s){c.super_=s;c.prototype=Object.create(s.prototype)},deprecate:function(f){return f},types:{isUint8Array:function(v){return v instanceof Uint8Array}}})',
        label: 'node:util'
      },
      {
        pattern: /require\("node:http"\)/g,
        shim: '__tryRequire("node:http", {Agent:function(){},request:function(){},get:function(){}})',
        label: 'node:http'
      },
      {
        pattern: /require\("node:https"\)/g,
        shim: '__tryRequire("node:https", {Agent:function(){},request:function(){},get:function(){}})',
        label: 'node:https'
      },
      {
        pattern: /require\("node:fs"\)/g,
        shim: '__tryRequire("node:fs", {readFileSync:function(){},existsSync:function(){return false}})',
        label: 'node:fs'
      },
      {
        pattern: /require\("node:path"\)/g,
        shim: '__tryRequire("node:path", {join:function(){return[].slice.call(arguments).join("/")},resolve:function(){return[].slice.call(arguments).join("/")}})',
        label: 'node:path'
      },
      {
        pattern: /require\("node:os"\)/g,
        shim: '__tryRequire("node:os", {platform:function(){return"react-native"}})',
        label: 'node:os'
      },
      {
        pattern: /require\("node:net"\)/g,
        shim: '__tryRequire("node:net", {Socket:function(){},connect:function(){}})',
        label: 'node:net'
      },
      {
        pattern: /require\("node:tls"\)/g,
        shim: '__tryRequire("node:tls", {connect:function(){}})',
        label: 'node:tls'
      },
      {
        pattern: /require\("node:dns"\)/g,
        shim: '__tryRequire("node:dns", {lookup:function(){}})',
        label: 'node:dns'
      },
      {
        pattern: /require\("node:dgram"\)/g,
        shim: '__tryRequire("node:dgram", {createSocket:function(){}})',
        label: 'node:dgram'
      },
      {
        pattern: /require\("node:child_process"\)/g,
        shim: '__tryRequire("node:child_process", {exec:function(){},spawn:function(){}})',
        label: 'node:child_process'
      },
      {
        pattern: /require\("node:zlib"\)/g,
        shim: '__tryRequire("node:zlib", {createGunzip:function(){},createInflate:function(){}})',
        label: 'node:zlib'
      },
      {
        pattern: /require\("node:url"\)/g,
        shim: '__tryRequire("node:url", {parse:function(){return{}},URL:globalThis.URL})',
        label: 'node:url'
      },
      {
        pattern: /require\("node:assert"\)/g,
        shim: '__tryRequire("node:assert", function assert(v,m){if(!v)throw new Error(m||"Assertion failed")})',
        label: 'node:assert'
      },
      {
        pattern: /require\("node:string_decoder"\)/g,
        shim: '__tryRequire("node:string_decoder", {StringDecoder:function(){this.write=function(b){return String(b)};this.end=function(){return ""}}})',
        label: 'node:string_decoder'
      }
    ];

    for (const entry of shimMap) {
      const count = (cjsContent.match(entry.pattern) || []).length;
      if (count > 0) {
        cjsContent = cjsContent.replace(entry.pattern, entry.shim);
        totalPatched += count;
        log(`  ✅ Patched ${count} require("${entry.label}") calls`, colors.green);
      }
    }

    writeFileSync(cjsPath, cjsContent);
    log(`  📊 Total: ${totalPatched} Node built-in requires patched`, colors.cyan);

    log('✅ CJS bundle generated', colors.green);
  } catch (error) {
    log('❌ CJS bundle generation failed!', colors.red);
    throw error;
  }
}



function buildProtobuf(): void {
  log('📋 Building protobuf files with TypeScript...', colors.blue);
  
  try {
    // Build protobuf files using the TypeScript build script
    exec('cd proto && npm run build');
    log('✅ Protobuf files built with TypeScript support', colors.green);
  } catch (error) {
    // If generated files exist, we can proceed with a warning
    const generatedPath = join(projectRoot, 'proto', 'generated');
    if (existsSync(generatedPath) && existsSync(join(generatedPath, 'api_pb.js'))) {
      log('⚠️  Protobuf build failed, but generated files exist. Skipping...', colors.yellow);
      return;
    }

    log('⚠️  Protobuf build failed, trying fallback...', colors.yellow);
    try {
      // Fallback to regular build
      exec('cd proto && npm run build');
      log('✅ Protobuf files built with fallback method', colors.green);
    } catch (fallbackError) {
      if (existsSync(generatedPath) && existsSync(join(generatedPath, 'api_pb.js'))) {
        log('⚠️  Fallback failed, but generated files exist. Skipping...', colors.yellow);
        return;
      }
      log('❌ Protobuf build failed completely', colors.red);
      throw fallbackError;
    }
  }
}

function copyProtoFiles(): void {
  log('📋 Copying protobuf files...', colors.blue);
  const protoSource = join(projectRoot, 'proto', 'generated');
  const protoDest = join(projectRoot, 'dist', 'proto', 'generated');
  
  if (existsSync(protoSource)) {
    cpSync(protoSource, protoDest, { recursive: true });
    log('✅ Protobuf generated files copied', colors.green);
  } else {
    log('⚠️  Protobuf generated files not found, skipping...', colors.yellow);
  }
  
  // Also copy source .proto files
  const protoSourceDir = join(projectRoot, 'proto');
  const protoDestDir = join(projectRoot, 'dist', 'proto');
  
  if (existsSync(protoSourceDir)) {
    // Copy all .proto files
    const protoFiles = ['api.proto', 'txn.proto', 'validator.proto'];
    for (const file of protoFiles) {
      const sourceFile = join(protoSourceDir, file);
      const destFile = join(protoDestDir, file);
      if (existsSync(sourceFile)) {
        // Ensure destination directory exists
        mkdirSync(protoDestDir, { recursive: true });
        cpSync(sourceFile, destFile);
      }
    }
    log('✅ Protobuf source files copied', colors.green);
  }
}

function copyReadme(): void {
  log('📄 Copying README...', colors.blue);
  const readmeSource = join(projectRoot, 'README.md');
  const readmeDest = join(projectRoot, 'dist', 'README.md');
  
  if (existsSync(readmeSource)) {
    cpSync(readmeSource, readmeDest);
    log('✅ README copied', colors.green);
  }
}

function copyLicense(): void {
  log('📄 Copying LICENSE...', colors.blue);
  const licenseSource = join(projectRoot, 'LICENSE');
  const licenseDest = join(projectRoot, 'dist', 'LICENSE');
  
  if (existsSync(licenseSource)) {
    cpSync(licenseSource, licenseDest);
    log('✅ LICENSE copied', colors.green);
  }
}

function validateBuild(): void {
  log('🔍 Validating build output...', colors.blue);
  
  const distPath = join(projectRoot, 'dist');
  const requiredFiles = [
    'index.js',
    'index.d.ts',
    'index.mjs',
    'index.cjs'
  ];
  
  for (const file of requiredFiles) {
    const filePath = join(distPath, file);
    if (!existsSync(filePath)) {
      throw new Error(`Required file missing: ${file}`);
    }
  }
  
  log('✅ Build validation passed', colors.green);
}

function validateBundles(): void {
  log('🔍 Validating CJS/ESM bundles...', colors.blue);
  try {
    exec('npx tsx scripts/validate-bundles.ts');
    log('✅ Bundle validation passed', colors.green);
  } catch (error) {
    log('❌ Bundle validation failed!', colors.red);
    throw error;
  }
}

function showBuildInfo(): void {
  log('\n📊 Build Information:', colors.cyan);
  log(`  • Output directory: ${join(projectRoot, 'dist')}`, colors.reset);
  log('  • Main entry (CJS): dist/index.cjs', colors.reset);
  log('  • ESM entry: dist/index.mjs', colors.reset);
  log('  • ESM (tsc): dist/index.js', colors.reset);
  log('  • Type definitions: dist/index.d.ts', colors.reset);
  log('  • Source maps: Generated', colors.reset);
  log('  • Declaration maps: Generated', colors.reset);
}

async function build(skipDependencyCheck: boolean = false): Promise<void> {
  const startTime = Date.now();
  
  log('🚀 Starting Kalvora JS SDK TypeScript build...', colors.bright);
  log('', colors.reset);
  
  try {
    // Check and fix dependencies first (unless skipped)
    if (!skipDependencyCheck) {
      checkAndFixDependencies();
      log('', colors.reset);
    }
    
    cleanDist();
    buildProtobuf();
    lintCode();
    typeCheck();
    compileTypeScript();
    copyProtoFiles();
    generateESM();
    generateCJS();
    copyReadme();
    copyLicense();
    validateBuild();
    validateBundles();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    log('', colors.reset);
    log('🎉 Build completed successfully!', colors.green);
    log(`⏱️  Build time: ${duration}s`, colors.cyan);
    
    showBuildInfo();
    
  } catch (error) {
    log('', colors.reset);
    log('❌ Build failed!', colors.red);
    log(`Error: ${(error as Error).message}`, colors.red);
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Filter out options from commands
const commands = args.filter(arg => !arg.startsWith('--'));
const options = args.filter(arg => arg.startsWith('--'));
const actualCommand = commands[0];

switch (actualCommand) {
case 'clean':
  cleanDist();
  break;
case 'lint':
  lintCode();
  break;
case 'type-check':
  typeCheck();
  break;
case 'compile':
  compileTypeScript();
  break;
case 'esm':
  generateESM();
  break;
case 'validate':
  validateBuild();
  break;
case 'help':
case '--help':
case '-h':
  log('Kalvora JS SDK TypeScript Build Script', colors.bright);
  log('', colors.reset);
  log('Usage: npm run build [command] [options]', colors.reset);
  log('', colors.reset);
  log('Commands:', colors.reset);
  log('  (no command)  - Full build process with dependency check', colors.reset);
  log('  clean         - Clean dist directory', colors.reset);
  log('  type-check    - Run TypeScript type checking only', colors.reset);
  log('  compile       - Compile TypeScript to JavaScript only', colors.reset);
  log('  esm           - Generate ESM modules only', colors.reset);
  log('  validate      - Validate build output only', colors.reset);
  log('  help          - Show this help message', colors.reset);
  log('', colors.reset);
  log('Options:', colors.reset);
  log('  --skip-deps   - Skip dependency check and auto-fix (faster)', colors.reset);
  log('  --fast        - Alias for --skip-deps', colors.reset);
  break;
default:
  if (actualCommand) {
    log(`Unknown command: ${actualCommand}`, colors.red);
    log('Run "npm run build help" for available commands', colors.yellow);
    process.exit(1);
  } else {
    // Check for skip dependency check flag
    const skipDependencyCheck = options.includes('--skip-deps') || options.includes('--fast');
    await build(skipDependencyCheck);
  }
  break;
}
