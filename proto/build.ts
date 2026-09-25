#!/usr/bin/env tsx
/**
 * Generate TypeScript protobuf bindings for the Kalvora protocol.
 *
 * Runs `buf generate` (see `buf.gen.yaml`) which invokes `protoc-gen-es` v2 to
 * emit `generated/*_pb.js` + `.d.ts` for every `.proto` in this directory,
 * including the Google well-known types. Output is git-ignored; run this after
 * installing dependencies or after `npm run proto:sync`.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const PROTO_DIR = fileURLToPath(new URL('.', import.meta.url));
const GENERATED_DIR = join(PROTO_DIR, 'generated');
const EXPECTED_OUTPUTS = ['txn_pb.js', 'api_pb.js', 'validator_pb.js', 'guardian_pb.js'];

rmSync(GENERATED_DIR, { recursive: true, force: true });
mkdirSync(GENERATED_DIR, { recursive: true });

console.log('Generating Kalvora protobuf bindings (buf generate)…');
execSync('npx buf generate', { stdio: 'inherit', cwd: PROTO_DIR });

const missing = EXPECTED_OUTPUTS.filter(file => !existsSync(join(GENERATED_DIR, file)));
if (missing.length > 0) {
  console.error(`Generation incomplete; missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Generated ${EXPECTED_OUTPUTS.length} protocol modules in ${GENERATED_DIR}`);
