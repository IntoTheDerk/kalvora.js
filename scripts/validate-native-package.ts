/** Exercise the emitted public entry with genuinely absent optional packages. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const runtimeCheck = `
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

let networkAttempts = 0;
function blocked() { networkAttempts++; throw new Error('Native package check forbids network access'); }
globalThis.fetch = blocked;
http.get = http.request = https.get = https.request = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = blocked;
dns.lookup = dns.resolve = dns.resolve4 = dns.resolve6 = blocked;
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6']) dns.promises[method] = blocked;
syncBuiltinESMExports();
for (const name of ['@solana/web3.js', '@solana/spl-token', 'bigint-buffer', 'stream-json', 'uuid']) {
  assert.equal(existsSync('node_modules/' + name), false, name + ' is not installed');
  assert.throws(() => import.meta.resolve(name), { code: 'ERR_MODULE_NOT_FOUND' });
}

let input = ''; for await (const chunk of process.stdin) input += chunk;
const vector = JSON.parse(input);
Date.now = () => Date.parse('2026-07-25T09:22:00.000Z');
const sdk = await import('kalvora.js/native');
const wallet = await import('kalvora.js/wallet');
assert.equal(wallet.generateAddressFromPublicKey(vector.publicKey), vector.constructionContext.walletAddress);
const pair = await wallet.createWallet({ keyType: wallet.KEY_TYPE.ED25519, mnemonic: 'abandon '.repeat(11) + 'about' });
assert.equal(wallet.generateAddressFromPublicKey(pair.publicKey), pair.address);
for (const name of ['KalvoraClient', 'KalvoraRpcError', 'isKalvoraRpcError', 'RpcCode',
  'PROPOSAL_TYPE', 'PROPOSAL_PHASE', 'PRE_GOVERNANCE_OUTCOME', 'ProposalType',
  'buildTextGovernanceProposalTXN', 'sendGovernanceProposalTXN', 'buildVoteTXN',
  'applyProposalStageFee', 'serializeTransaction', 'generateAddressFromPublicKey',
  'isValidContractId', 'isCanonicalContractId', 'UniversalFeeCalculator', 'VERSION']) {
  assert.notEqual(sdk[name], undefined, name + ' is exported');
}
assert.equal(sdk.VERSION, JSON.parse(readFileSync('node_modules/kalvora.js/package.json', 'utf8')).version);
const { createRouterTransport } = await import('@connectrpc/connect');
const { APIService } = await import('./node_modules/kalvora.js/dist/proto/generated/kal_api_pb.js');
let nonceReads = 0;
const transport = createRouterTransport(router => router.service(APIService, {
  nonce: () => { nonceReads++; return { nonce: 9007199254740992n }; }
}));
const client = new sdk.KalvoraClient({ grpc: { endpoint: 'http://fixture.invalid', transport } });
assert.equal(await client.query.getNextNonce(vector.constructionContext.walletAddress), 9007199254740993n);
assert.equal(nonceReads, 1);
assert.equal(sdk.generateAddressFromPublicKey(vector.publicKey), vector.constructionContext.walletAddress);
assert.equal(sdk.isValidContractId(vector.input.contractId), true);
assert.equal(sdk.isCanonicalContractId(vector.input.contractId), true);
assert.equal(sdk.isValidContractId('KALV'), false);
const options = {
  constructionContext: vector.constructionContext, nonce: vector.base.nonce,
  timestamp: new Date(vector.base.timestamp), feeId: vector.base.feeId,
  feeAmountParts: vector.base.feeAmountParts
};
const proposal = await sdk.buildTextGovernanceProposalTXN(vector.input, vector.publicKey, options);
assert.equal(Buffer.from(sdk.serializeTransaction(proposal).data, 'base64').toString('hex'), vector.expectedProtobufHex);
const body = String.fromCharCode(10, 9) + 'const café = "公共";  ' + String.fromCharCode(10, 10);
const authored = await sdk.buildTextGovernanceProposalTXN({ ...vector.input, body }, vector.publicKey, options);
assert.equal(sdk.deserializeTransaction(sdk.serializeTransaction(authored)).body, body);
assert.equal(sdk.applyProposalStageFee('101', 3, true), '127');
for (const support of [true, false]) {
  const vote = await sdk.buildVoteTXN(vector.input.contractId, 'ab'.repeat(32), vector.publicKey, {
    support, nonce: '9007199254740993', feeAmountParts: '101', timestamp: options.timestamp
  });
  await sdk.UniversalFeeCalculator.calculateFee({
    protoObject: vote, baseFeeId: sdk.KALVORA_NATIVE_TOKEN, baseFeeParts: '101',
    tokenInfoMap: new Map([[sdk.KALVORA_NATIVE_TOKEN, {
      contractId: sdk.KALVORA_NATIVE_TOKEN, rate: '1000000000000000000',
      authorized: true, denomination: '1000000000', allowedFees: '0', usedFees: '0'
    }]])
  });
  const decoded = sdk.deserializeTransaction(sdk.serializeTransaction(vote));
  assert.equal(decoded.base.nonce, 9007199254740993n);
  assert.equal(decoded.base.feeAmount, '101');
  assert.equal(decoded.support, support);
  assert.equal(decoded.base.signature, undefined);
  assert.equal(decoded.base.hash, undefined);
}
await assert.rejects(import('kalvora.js'), error =>
  error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('@solana/'));
assert.equal(networkAttempts, 0);
console.log('Native public package: ordinary consumer install, optional peers absent; query/build/fee/encoding checks passed; zero network attempts.');
`;

/** npm ci supplies its cache; this fixture never copies or populates a second cache. */
export async function validateNativePackage(projectRoot: string): Promise<void> {
  const fixture = mkdtempSync(join(tmpdir(), 'kalvora-native-package-'));
  try {
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    // Probe the emitted package in isolation: npm 10 can re-enter prepare when
    // packing the source root from inside its own prepare/build lifecycle.
    // Keep exports/files/dependencies intact; remove lifecycle scripts only here.
    delete manifest.scripts;
    writeFileSync(join(fixture, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const file of [...manifest.files, 'package-lock.json']) {
      cpSync(join(projectRoot, file), join(fixture, file), { recursive: true });
    }
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: fixture, encoding: 'utf8', timeout: 60_000
    }));
    const publishedFiles = new Set(packed[0].files.map((file: { path: string }) => file.path));
    for (const file of ['dist/native.js', 'dist/native.d.ts']) assert.ok(publishedFiles.has(file), `${file} is published`);
    const archive = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json'], {
      cwd: fixture, encoding: 'utf8', timeout: 60_000
    }))[0].filename;
    const consumer = join(fixture, 'consumer');
    mkdirSync(consumer);
    const consumerManifest = {
      name: 'native-consumer', private: true, type: 'module',
      dependencies: { 'kalvora.js': `file:../${archive}` }
    };
    writeFileSync(join(consumer, 'package.json'), JSON.stringify(consumerManifest));
    // Reuse the repository's resolved production versions/cache so clean CI
    // does not need cached registry packuments or another dependency resolution.
    const sourceLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
    const packages = Object.fromEntries(Object.entries(sourceLock.packages)
      .filter(([path, value]) => path && !(value as { dev?: boolean }).dev));
    writeFileSync(join(consumer, 'package-lock.json'), JSON.stringify({
      name: consumerManifest.name, lockfileVersion: 3, requires: true,
      packages: {
        '': consumerManifest, ...packages,
        'node_modules/kalvora.js': {
          version: manifest.version, resolved: `file:../${archive}`,
          dependencies: manifest.dependencies, peerDependencies: manifest.peerDependencies,
          peerDependenciesMeta: manifest.peerDependenciesMeta
        }
      }
    }));
    // An ordinary install must leave optional peers absent, including when this
    // validator runs inside Git prepare with inherited include flags. No blanket
    // omit=optional: native build tools may need their own optional binaries.
    execFileSync('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], {
      cwd: consumer, stdio: 'pipe', timeout: 120_000,
      env: { ...process.env, npm_config_include: ['dev', 'peer', 'optional'].join('\n\n') }
    });
    writeFileSync(join(consumer, 'consumer.ts'), `
import { KalvoraClient, UniversalFeeCalculator, VERSION } from 'kalvora.js/native';
import { createWallet, KEY_TYPE, generateAddressFromPublicKey } from 'kalvora.js/wallet';
import type { Wallet } from 'kalvora.js/wallet';
const wallet: Promise<Wallet> = createWallet({ keyType: KEY_TYPE.ED25519, mnemonic: 'abandon '.repeat(11) + 'about' });
void wallet; void generateAddressFromPublicKey;
import type { GRPCConfig, KalvoraClientOptions, KalvoraNetwork, TokenFeeInfo, ProposalConstructionContext,
  SerializedTransaction, GovernanceProposal, GovernanceVote, InstrumentContract,
  BuildTextGovernanceProposalTXNOptions, ProposalGovernanceType, TextGovernanceProposalInput,
  BuildVoteTXNOptions, FeeConfigHelper } from 'kalvora.js/native';
const config: GRPCConfig = { endpoint: 'http://fixture.invalid' };
new KalvoraClient({ grpc: config });
void UniversalFeeCalculator.calculateFee;
const version: string = VERSION;
void version;
export type Consumer = [KalvoraClientOptions, KalvoraNetwork, TokenFeeInfo, ProposalConstructionContext,
  SerializedTransaction, GovernanceProposal, GovernanceVote, InstrumentContract,
  BuildTextGovernanceProposalTXNOptions, ProposalGovernanceType, TextGovernanceProposalInput,
  BuildVoteTXNOptions, FeeConfigHelper];
`);
    execFileSync(process.execPath, [join(projectRoot, 'node_modules/typescript/bin/tsc'),
      '--noEmit', '--strict', '--target', 'es2020', '--module', 'nodenext',
      '--moduleResolution', 'nodenext', 'consumer.ts'], { cwd: consumer, stdio: 'inherit', timeout: 60_000 });
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', runtimeCheck], {
      cwd: consumer, encoding: 'utf8', timeout: 60_000,
      input: readFileSync(join(projectRoot, 'src/proposal/tests/fixtures/text-proposal-v1.json'), 'utf8')
    });
    console.log(result.trim());

    // Resolver-only peers: these local packages contain metadata, not Solana
    // implementations. Real peer runtime/type compatibility is a separate check.
    const peers: Record<string, { version: string; resolved: string }[]> = {};
    for (const [name, versions] of [
      ['@solana/web3.js', ['1.98.4', '1.95.8']],
      ['@solana/spl-token', ['0.4.14', '0.4.13']]
    ] as const) {
      peers[name] = versions.map(version => {
        const directory = `peer-${name.split('/')[1]}-${version}`;
        const path = join(fixture, directory);
        mkdirSync(path);
        writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version }));
        const filename = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json'], {
          cwd: path, encoding: 'utf8', timeout: 15_000
        }))[0].filename;
        return { version, resolved: `file:../${directory}/${filename}` };
      });
    }
    // npm may request a replacement peer's packument before reporting a
    // conflict. Warm only synthetic metadata via the public CLI and loopback;
    // otherwise a clean cache can report ENOTCACHED instead of ERESOLVE.
    const registry = createServer((request, response) => {
      const name = decodeURIComponent((request.url ?? '').slice(1));
      const entries = peers[name];
      const latest = entries?.[0];
      if (!entries || !latest) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ name, 'dist-tags': { latest: latest.version },
        versions: Object.fromEntries(entries.map(peer => [peer.version, {
          name, version: peer.version, dist: { tarball: peer.resolved }
        }])) }));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        registry.once('error', reject);
        registry.listen(0, '127.0.0.1', resolve);
      });
      const address = registry.address();
      assert.ok(address && typeof address !== 'string');
      const resolverEnv = { ...process.env, npm_config_registry: `http://127.0.0.1:${address.port}`,
        npm_config_include: ['dev', 'peer', 'optional'].join('\n\n'),
        npm_config_legacy_peer_deps: 'false', npm_config_force: 'false', npm_config_strict_peer_deps: 'false' };
      for (const name of Object.keys(peers)) {
        await execFileAsync('npm', ['view', name, '--json', '--offline=false'], { env: resolverEnv, cwd: fixture, timeout: 15_000 });
      }
      for (const [label, web3, token, compatible] of [
        ['compatible', 0, 0, true], ['incompatible-web3', 1, 0, false], ['incompatible-token', 0, 1, false]
      ] as const) {
        const path = join(fixture, label);
        mkdirSync(path);
        const web3Peer = peers['@solana/web3.js']?.[web3];
        const tokenPeer = peers['@solana/spl-token']?.[token];
        assert.ok(web3Peer && tokenPeer);
        const selected = { '@solana/web3.js': web3Peer, '@solana/spl-token': tokenPeer };
        const peerManifest = { ...consumerManifest, name: label, dependencies: {
          ...consumerManifest.dependencies, ...Object.fromEntries(Object.entries(selected).map(([name, peer]) => [name, peer.version]))
        } };
        writeFileSync(join(path, 'package.json'), JSON.stringify(peerManifest));
        const consumerLock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
        writeFileSync(join(path, 'package-lock.json'), JSON.stringify({ ...consumerLock, name: label,
          packages: { ...consumerLock.packages, '': peerManifest,
            ...Object.fromEntries(Object.entries(selected).map(([name, peer]) => [
              `node_modules/${name}`, { version: peer.version, resolved: peer.resolved }
            ])) }
        }));
        const install = execFileAsync('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--json'], {
          cwd: path, env: resolverEnv, timeout: 30_000
        });
        if (compatible) {
          await install;
          for (const [name, peer] of Object.entries(selected)) {
            assert.equal(JSON.parse(readFileSync(join(path, 'node_modules', name, 'package.json'), 'utf8')).version, peer.version);
          }
        }
        else await assert.rejects(install, error => error instanceof Error && 'stdout' in error
          && JSON.parse(String(error.stdout)).error?.code === 'ERESOLVE', label);
      }
      console.log('Optional peer coexistence: compatible install passed; incompatible web3/token pins each returned ERESOLVE (synthetic peers; no bridge API checks).');
    } finally {
      registry.closeAllConnections();
      await new Promise<void>(resolve => registry.close(() => resolve()));
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
