/**
 * `scripts/sync-protos.ts` tests.
 *
 * The script runs `main()` at import time (reading argv and possibly calling
 * `process.exit`), so it is exercised as a subprocess. Only `--check` mode is
 * used: the non-check mode writes into the repository's real `proto/` dir.
 *
 * Two source layouts are covered: the official flat release (`txn.proto`,
 * `validator.proto`, `kal_api.proto`, copied verbatim) and the kalvora-indexer
 * layout (`<pkg>/<file>.proto` with nested imports such as
 * `import "txn/txn.proto";`). Fixtures are derived from the SDK's own protos,
 * so `--check` reports "up to date" iff the script reproduces the committed
 * files byte-for-byte.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'sync-protos.ts');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const PROTO_DIR = join(ROOT, 'proto');

/** Indexer path → SDK file name (mirrors the script's FILES table). */
const FILES: ReadonlyArray<readonly [string, string]> = [
  ['txn/txn.proto', 'txn.proto'],
  ['validator/validator.proto', 'validator.proto'],
  ['guardian/guardian.proto', 'guardian.proto'],
  ['api/kal_api.proto', 'kal_api.proto']
];

/** Files of the official flat release (guardian.proto is not part of it). */
const OFFICIAL_FILES = ['txn.proto', 'validator.proto', 'kal_api.proto'] as const;

const TIMEOUT = 60_000;

let workDir: string;

function toNested(flat: string): string {
  return flat
    .split('import "txn.proto";').join('import "txn/txn.proto";')
    .split('import "validator.proto";').join('import "validator/validator.proto";')
    .split('import "guardian.proto";').join('import "guardian/guardian.proto";');
}

/** Create an indexer-style source tree; `mutate` can alter per-file content. */
function makeSource(name: string, mutate: (sdkName: string, content: string) => string | null = (_n, c) => c): string {
  const dir = join(workDir, name);
  for (const [from, to] of FILES) {
    const content = mutate(to, toNested(readFileSync(join(PROTO_DIR, to), 'utf8')));
    if (content === null) continue;
    const target = join(dir, from);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

/** Create an official-release-style flat source tree (verbatim copies). */
function makeFlatSource(name: string, files: readonly string[] = OFFICIAL_FILES): string {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    writeFileSync(join(dir, file), readFileSync(join(PROTO_DIR, file)));
  }
  return dir;
}

function runCheck(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const baseEnv = { ...process.env };
  delete baseEnv.KALVORA_PROTO_SOURCE;
  const result = spawnSync(TSX, [SCRIPT, '--check', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
    timeout: TIMEOUT
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function protoDigest(): string {
  const hash = createHash('sha256');
  for (const [, to] of FILES) hash.update(readFileSync(join(PROTO_DIR, to)));
  return hash.digest('hex');
}

let digestBefore: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'kalvora-sync-protos-'));
  digestBefore = protoDigest();
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('sync-protos --check', () => {
  it('fixtures really use the nested import layout', () => {
    const api = toNested(readFileSync(join(PROTO_DIR, 'kal_api.proto'), 'utf8'));
    expect(api).toContain('import "txn/txn.proto";');
    expect(api).toContain('import "validator/validator.proto";');
    expect(api).not.toContain('import "txn.proto";');
  });

  it('exits 0 when the rewritten indexer protos match the SDK protos', () => {
    const source = makeSource('up-to-date');
    const { status, stdout, stderr } = runCheck(['--source', source]);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    for (const [, to] of FILES) {
      expect(stdout).toContain(`up to date  ${to}`);
    }
    expect(stdout).not.toContain('DRIFTED');
  }, TIMEOUT);

  it('accepts the official flat release and skips the absent guardian.proto', () => {
    const source = makeFlatSource('official-flat');
    const { status, stdout, stderr } = runCheck(['--source', source]);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    for (const file of OFFICIAL_FILES) {
      expect(stdout).toContain(`up to date  ${file}`);
    }
    expect(stdout).toContain('skipped     guardian.proto');
  }, TIMEOUT);

  it('preserves bytes exactly: line endings and trailing newlines are not normalised', () => {
    const source = makeSource('byte-exact', (_name, content) =>
      content.endsWith('\n') ? content.slice(0, -1) : `${content}\n`);
    const { status, stdout } = runCheck(['--source', source]);
    expect(status).toBe(1);
    for (const [, to] of FILES) {
      expect(stdout).toContain(`DRIFTED     ${to}`);
    }
  }, TIMEOUT);

  it('reads the source from KALVORA_PROTO_SOURCE when --source is absent', () => {
    const source = makeSource('env-source');
    const { status, stdout } = runCheck([], { KALVORA_PROTO_SOURCE: source });
    expect(status).toBe(0);
    expect(stdout).toContain('up to date  kal_api.proto');
  }, TIMEOUT);

  it('exits 1 and lists the drifted file', () => {
    const source = makeSource('drifted', (name, content) =>
      name === 'guardian.proto' ? `${content}// upstream change\n` : content);
    const { status, stdout, stderr } = runCheck(['--source', source]);
    expect(status).toBe(1);
    expect(stdout).toContain('DRIFTED     guardian.proto  (source: guardian/guardian.proto)');
    expect(stdout).toContain('up to date  txn.proto');
    expect(stdout).toContain('up to date  kal_api.proto');
    expect(stderr).toContain(`1 proto file(s) differ from ${source}`);
    expect(stderr).toContain('npm run proto:sync');
  }, TIMEOUT);

  it('detects an import that the rewrite does not map (e.g. a wrong nested path)', () => {
    const source = makeSource('bad-import', (name, content) =>
      name === 'kal_api.proto' ? content.replace('import "txn/txn.proto";', 'import "api/txn.proto";') : content);
    const { status, stdout } = runCheck(['--source', source]);
    expect(status).toBe(1);
    expect(stdout).toContain('DRIFTED     kal_api.proto  (source: api/kal_api.proto)');
  }, TIMEOUT);

  it('exits 2 when the source directory does not exist', () => {
    const missing = join(workDir, 'does-not-exist');
    const { status, stderr } = runCheck(['--source', missing]);
    expect(status).toBe(2);
    expect(stderr).toContain(`Proto source not found: ${missing}`);
    expect(stderr).toContain('KALVORA_PROTO_SOURCE');
  }, TIMEOUT);

  it('exits 2 when a source file is missing', () => {
    const source = makeSource('missing-file', (name, content) => (name === 'validator.proto' ? null : content));
    const { status, stderr } = runCheck(['--source', source]);
    expect(status).toBe(2);
    expect(stderr).toContain('Missing source file for validator.proto');
    expect(stderr).toContain(join(source, 'validator/validator.proto'));
  }, TIMEOUT);

  it('exits 2 when the source still has only a pre-rename api proto', () => {
    const source = makeSource('pre-rename', (name, content) => (name === 'kal_api.proto' ? null : content));
    mkdirSync(join(source, 'api'), { recursive: true });
    writeFileSync(join(source, 'api', 'legacy_api.proto'), 'syntax = "proto3";\n');
    const { status, stderr } = runCheck(['--source', source]);
    expect(status).toBe(2);
    expect(stderr).toContain('Missing source file for kal_api.proto');
  }, TIMEOUT);

  it('never modifies the repository proto/ files in --check mode', () => {
    expect(protoDigest()).toBe(digestBefore);
  });
});
