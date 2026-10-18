/** Exercise the emitted public entry with genuinely absent optional packages. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
for (const name of ['KalvoraClient', 'KalvoraRpcError', 'isKalvoraRpcError', 'RpcCode',
  'PROPOSAL_TYPE', 'PROPOSAL_PHASE', 'PRE_GOVERNANCE_OUTCOME', 'ProposalType',
  'buildTextGovernanceProposalTXN', 'sendGovernanceProposalTXN', 'buildVoteTXN',
  'applyProposalStageFee', 'serializeTransaction', 'generateAddressFromPublicKey',
  'isValidContractId', 'isCanonicalContractId', 'UniversalFeeCalculator', 'VERSION']) {
  assert.notEqual(sdk[name], undefined, name + ' is exported');
}
assert.equal(sdk.VERSION, JSON.parse(readFileSync('package.json', 'utf8')).version);
const { createRouterTransport } = await import('@connectrpc/connect');
const { APIService } = await import('./dist/proto/generated/kal_api_pb.js');
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
console.log('Native public package: optional dependencies absent; query/build/fee/encoding checks passed; zero network attempts.');
`;

/** npm ci supplies its cache; this fixture never copies or populates a second cache. */
export function validateNativePackage(projectRoot: string): void {
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
    // Git dependency preparation inherits dev/peer/optional include flags.
    // Exercise that environment in source builds too; the explicit CLI include
    // must override it so the runtime fixture genuinely omits optional packages.
    execFileSync('npm', ['ci', '--include=prod', '--omit=dev', '--omit=optional', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], {
      cwd: fixture, stdio: 'pipe', timeout: 120_000,
      env: { ...process.env, npm_config_include: ['dev', 'peer', 'optional'].join('\n\n') }
    });
    writeFileSync(join(fixture, 'consumer.ts'), `
import { KalvoraClient, UniversalFeeCalculator, VERSION } from 'kalvora.js/native';
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
      '--moduleResolution', 'nodenext', 'consumer.ts'], { cwd: fixture, stdio: 'inherit', timeout: 60_000 });
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', runtimeCheck], {
      cwd: fixture, encoding: 'utf8', timeout: 60_000,
      input: readFileSync(join(projectRoot, 'src/proposal/tests/fixtures/text-proposal-v1.json'), 'utf8')
    });
    console.log(result.trim());
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
