#!/usr/bin/env tsx
/**
 * Synchronise the SDK's `.proto` sources from the official Kalvora protos.
 *
 * The official release ships flat files (`txn.proto`, `validator.proto`,
 * `kal_api.proto`) that import each other as `txn.proto`. kalvora-indexer keeps
 * one proto per Go package (`<pkg>/<file>.proto`, imports such as
 * `txn/txn.proto`). Either layout is accepted: each SDK file is looked up at
 * its flat name first and then at its nested indexer path, and nested imports
 * are rewritten to the SDK's flat layout. Nothing else is touched - no newline
 * or line-ending normalisation - so the committed files stay byte-identical to
 * the official release.
 *
 * `guardian.proto` is not part of the official release. It is synced when the
 * source provides it and otherwise left as committed.
 *
 * Usage:
 *   npx tsx scripts/sync-protos.ts            # copy + rewrite
 *   npx tsx scripts/sync-protos.ts --check    # exit 1 if the SDK has drifted
 *   npx tsx scripts/sync-protos.ts --source /path/to/official/protos
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

interface ProtoFile {
  /** File name in the SDK's flat `proto/` directory. */
  readonly target: string;
  /** Candidate paths relative to the source directory, tried in order. */
  readonly sources: readonly string[];
  /** Leave the committed file alone when the source does not provide it. */
  readonly optional?: boolean;
}

const FILES: readonly ProtoFile[] = [
  { target: 'txn.proto', sources: ['txn.proto', 'txn/txn.proto'] },
  { target: 'validator.proto', sources: ['validator.proto', 'validator/validator.proto'] },
  { target: 'kal_api.proto', sources: ['kal_api.proto', 'api/kal_api.proto'] },
  { target: 'guardian.proto', sources: ['guardian.proto', 'guardian/guardian.proto'], optional: true }
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

/** Apply the nested-to-flat import rewrites; every other byte is preserved. */
export function transformProto(content: string): string {
  let result = content;
  for (const [from, to] of IMPORT_REWRITES) {
    result = result.split(from).join(to);
  }
  return result;
}

function main(): void {
  const { check, source } = parseArgs(process.argv.slice(2));
  if (!existsSync(source)) {
    console.error(`Proto source not found: ${source}`);
    console.error('Pass --source <dir> or set KALVORA_PROTO_SOURCE.');
    process.exit(2);
  }

  const drifted: string[] = [];
  for (const file of FILES) {
    const from = file.sources.find(candidate => existsSync(join(source, candidate)));
    if (from === undefined) {
      if (file.optional) {
        console.log(`  skipped     ${file.target}  (not in source; committed file kept)`);
        continue;
      }
      console.error(`Missing source file for ${file.target}; tried: ${file.sources.map(c => join(source, c)).join(', ')}`);
      process.exit(2);
    }
    const expected = transformProto(readFileSync(join(source, from), 'utf8'));
    const targetPath = join(TARGET_DIR, file.target);
    const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '';
    if (current === expected) {
      console.log(`  up to date  ${file.target}`);
      continue;
    }
    drifted.push(file.target);
    if (check) {
      console.log(`  DRIFTED     ${file.target}  (source: ${from})`);
    } else {
      writeFileSync(targetPath, expected);
      console.log(`  updated     ${file.target}  (source: ${from})`);
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
