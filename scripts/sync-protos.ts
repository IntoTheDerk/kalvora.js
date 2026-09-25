#!/usr/bin/env tsx
/**
 * Synchronise the SDK's `.proto` sources from kalvora-indexer.
 *
 * kalvora-indexer is the source of truth for the Kalvora wire protocol. It
 * keeps one proto per Go package (`proto/<pkg>/<file>.proto`) and imports
 * siblings as `txn/txn.proto`; the SDK keeps a flat `proto/` directory. This
 * script copies the four service protos and rewrites their import paths.
 *
 * Usage:
 *   npx tsx scripts/sync-protos.ts            # copy + rewrite
 *   npx tsx scripts/sync-protos.ts --check    # exit 1 if the SDK has drifted
 *   npx tsx scripts/sync-protos.ts --source /path/to/kalvora-indexer/proto
 *
 * The source defaults to `$KALVORA_PROTO_SOURCE`, then to the sibling checkout
 * `../kalvora-indexer/proto`. After syncing, run `npm run build:proto` to
 * regenerate the TypeScript bindings.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = join(ROOT, 'proto');

/** Indexer path (relative to its proto dir) → SDK file name. */
const FILES: ReadonlyArray<readonly [string, string]> = [
  ['txn/txn.proto', 'txn.proto'],
  ['validator/validator.proto', 'validator.proto'],
  ['guardian/guardian.proto', 'guardian.proto'],
  ['api/zera_api.proto', 'api.proto']
];

/** Import rewrites from the indexer's nested layout to the SDK's flat layout. */
const IMPORT_REWRITES: ReadonlyArray<readonly [string, string]> = [
  ['import "txn/txn.proto";', 'import "txn.proto";'],
  ['import "validator/validator.proto";', 'import "validator.proto";'],
  ['import "guardian/guardian.proto";', 'import "guardian.proto";']
];

function parseArgs(argv: string[]): { check: boolean; source: string } {
  const check = argv.includes('--check');
  const sourceIndex = argv.indexOf('--source');
  const source = sourceIndex >= 0 && argv[sourceIndex + 1]
    ? resolve(argv[sourceIndex + 1] as string)
    : resolve(process.env.KALVORA_PROTO_SOURCE ?? join(ROOT, '..', 'kalvora-indexer', 'proto'));
  return { check, source };
}

/** Apply import rewrites and normalise the trailing newline. */
export function transformProto(content: string): string {
  let result = content;
  for (const [from, to] of IMPORT_REWRITES) {
    result = result.split(from).join(to);
  }
  return result.endsWith('\n') ? result : `${result}\n`;
}

function main(): void {
  const { check, source } = parseArgs(process.argv.slice(2));
  if (!existsSync(source)) {
    console.error(`Proto source not found: ${source}`);
    console.error('Pass --source <dir> or set KALVORA_PROTO_SOURCE.');
    process.exit(2);
  }

  const drifted: string[] = [];
  for (const [from, to] of FILES) {
    const sourcePath = join(source, from);
    if (!existsSync(sourcePath)) {
      console.error(`Missing source file: ${sourcePath}`);
      process.exit(2);
    }
    const expected = transformProto(readFileSync(sourcePath, 'utf8'));
    const targetPath = join(TARGET_DIR, to);
    const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '';
    if (current === expected) {
      console.log(`  up to date  ${to}`);
      continue;
    }
    drifted.push(to);
    if (check) {
      console.log(`  DRIFTED     ${to}  (source: ${from})`);
    } else {
      writeFileSync(targetPath, expected);
      console.log(`  updated     ${to}  (source: ${from})`);
    }
  }

  if (check && drifted.length > 0) {
    console.error(`\n${drifted.length} proto file(s) differ from ${source}. Run \`npm run proto:sync\`.`);
    process.exit(1);
  }
  if (!check && drifted.length > 0) {
    console.log('\nProtos updated. Regenerate bindings with `npm run build:proto`.');
  }
}

// Run only when executed as a CLI, so helpers stay importable in tests.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
