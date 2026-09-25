/**
 * KalvoraClient + network preset tests.
 *
 * `vitest.setup.ts` globally mocks `@connectrpc/connect`; this file opts out
 * so the real clients run against an in-memory router transport serving both
 * `APIService` (blocks) and `TXNService` (submission).
 */
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, createRouterTransport, type ServiceImpl } from '@connectrpc/connect';
import { describe, expect, it, vi } from 'vitest';

import { APIService, type BlockRequest } from '../../../proto/generated/api_pb.js';
import { TXNService, TXN_STATUS, type MintTXN } from '../../../proto/generated/txn_pb.js';
import { BlockSchema, type Block } from '../../../proto/generated/validator_pb.js';
import { createMintTXN, buildMintTXN, type MintTXNInput } from '../../mint/index.js';
import { GuardianQueryClient } from '../../query/guardian-client.js';
import { KALVORA_NATIVE_TOKEN, KALVORA_PROTONET_NETWORK } from '../../shared/network/constants.js';
import { bytesToHex } from '../../shared/utils/byte-utils.js';
import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { KalvoraClient, createKalvoraClient } from '../kalvora-client.js';
import { KALVORA_NETWORKS, resolveNetwork, type KalvoraNetwork, type KalvoraNetworkName } from '../networks.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const { alice, bob } = ED25519_TEST_KEYS;
const OFFLINE = { nonce: 3, feeAmountParts: '100', timestamp: new Date('2026-07-25T09:22:00.000Z') };
const MINT_INPUT: MintTXNInput = {
  contractId: KALVORA_NATIVE_TOKEN,
  amount: '5',
  recipientAddress: bob.address,
  publicKey: alice.publicKey
};

function requestedHeight(req: BlockRequest): bigint {
  if (req.payload.case !== 'blockHeight') throw new ConnectError('expected height', Code.InvalidArgument);
  return req.payload.value;
}

function emptyBlock(height: bigint): Block {
  return create(BlockSchema, { blockHeader: { blockHeight: height } });
}

function blockWith(height: bigint, txnHash: Uint8Array, status: TXN_STATUS): Block {
  return create(BlockSchema, {
    blockHeader: { blockHeight: height },
    transactions: {
      txnFeesAndStatus: [{ txnHash, status, baseFees: '100', baseContractId: KALVORA_NATIVE_TOKEN }]
    }
  });
}

/**
 * Simulated chain: blocks 0..tip exist. When `mint` is submitted, block
 * tip+1 is produced containing the submitted transaction with `status`.
 */
function simulatedChain(tip: bigint, options: { status?: TXN_STATUS; include?: boolean } = {}) {
  const blockCalls: bigint[] = [];
  const submitted: MintTXN[] = [];
  let currentTip = tip;
  let included: Block | undefined;

  const api: Partial<ServiceImpl<typeof APIService>> = {
    block: req => {
      const height = requestedHeight(req);
      blockCalls.push(height);
      if (height > currentTip) throw new ConnectError('Block not found', Code.NotFound);
      if (included && height === currentTip) return { block: included };
      return { block: emptyBlock(height) };
    }
  };
  const txn: Partial<ServiceImpl<typeof TXNService>> = {
    mint: req => {
      submitted.push(req);
      if (options.include !== false) {
        currentTip += 1n;
        included = blockWith(currentTip, req.base!.hash!, options.status ?? TXN_STATUS.OK);
      }
      return {};
    }
  };
  const transport = createRouterTransport(({ service }) => {
    service(APIService, api);
    service(TXNService, txn);
  });
  return { transport, blockCalls, submitted };
}

// ----------------------------------------------------------------------------
// networks
// ----------------------------------------------------------------------------

describe('resolveNetwork', () => {
  it('resolves the protonet preset by name', () => {
    const network = resolveNetwork('protonet');
    expect(network).toEqual(KALVORA_NETWORKS.protonet);
    expect(network.id).toBe(KALVORA_PROTONET_NETWORK);
    expect(network.nativeToken).toBe(KALVORA_NATIVE_TOKEN);
    expect(network.grpc).toEqual(PROTONET_GRPC_CONFIG);
  });

  it('returns a copy: mutating the result does not affect KALVORA_NETWORKS', () => {
    const network = resolveNetwork('protonet');
    expect(network).not.toBe(KALVORA_NETWORKS.protonet);
    expect(network.grpc).not.toBe(KALVORA_NETWORKS.protonet.grpc);
    network.name = 'mutated';
    network.grpc.host = 'evil.example.com';
    network.grpc.port = 1;
    expect(KALVORA_NETWORKS.protonet.name).toBe('Kalvora Protonet');
    expect(KALVORA_NETWORKS.protonet.grpc.host).toBe(PROTONET_GRPC_CONFIG.host);
    expect(resolveNetwork('protonet').grpc.host).toBe(PROTONET_GRPC_CONFIG.host);
    expect(resolveNetwork('protonet').grpc.port).toBe(443);
  });

  it('passes a custom network object through unchanged', () => {
    const custom: KalvoraNetwork = {
      id: 'kalvora:local',
      name: 'Local',
      grpc: { host: 'localhost', port: 50053, protocol: 'http' },
      nativeToken: 'LOCAL0001',
      nativeDecimals: 6,
      nativeSymbol: 'LOC'
    };
    expect(resolveNetwork(custom)).toBe(custom);
  });

  it('throws for an unknown name and lists the known presets', () => {
    expect(() => resolveNetwork('mainnet' as KalvoraNetworkName))
      .toThrow('Unknown Kalvora network "mainnet". Known: protonet');
  });
});

// ----------------------------------------------------------------------------
// constructor & accessors
// ----------------------------------------------------------------------------

describe('KalvoraClient construction', () => {
  it('defaults to protonet', () => {
    const client = new KalvoraClient();
    expect(client.network.id).toBe(KALVORA_PROTONET_NETWORK);
    expect(client.grpcConfig).toEqual(PROTONET_GRPC_CONFIG);
    expect(client.nativeToken).toBe(KALVORA_NATIVE_TOKEN);
  });

  it('merges grpc overrides over the preset without mutating it', () => {
    const client = new KalvoraClient({ network: 'protonet', grpc: { host: 'node.example.com', port: 8443 } });
    expect(client.grpcConfig).toEqual({ ...PROTONET_GRPC_CONFIG, host: 'node.example.com', port: 8443 });
    expect(client.grpcConfig.protocol).toBe('https');
    expect(KALVORA_NETWORKS.protonet.grpc.host).toBe(PROTONET_GRPC_CONFIG.host);
    expect(client.network.grpc.host).toBe(PROTONET_GRPC_CONFIG.host);
  });

  it('uses a custom network definition and its native token', () => {
    const custom: KalvoraNetwork = {
      id: 'kalvora:dev',
      name: 'Dev',
      grpc: { host: 'localhost', port: 1234, protocol: 'http' },
      nativeToken: 'DEV0001',
      nativeDecimals: 9,
      nativeSymbol: 'DEV'
    };
    const client = createKalvoraClient({ network: custom, grpc: { port: 5678 } });
    expect(client).toBeInstanceOf(KalvoraClient);
    expect(client.network).toBe(custom);
    expect(client.nativeToken).toBe('DEV0001');
    expect(client.grpcConfig).toEqual({ host: 'localhost', port: 5678, protocol: 'http' });
  });

  it('throws on an unknown network name', () => {
    expect(() => new KalvoraClient({ network: 'nope' as KalvoraNetworkName })).toThrow(/Unknown Kalvora network "nope"/);
  });

  it('guardian getter throws without a guardian endpoint', () => {
    const client = new KalvoraClient();
    expect(() => client.guardian).toThrow('No guardian endpoint configured');
  });

  it('guardian getter returns a stable GuardianQueryClient when configured', () => {
    const client = new KalvoraClient({ guardian: { host: 'guardian.example.com', port: 443 } });
    expect(client.guardian).toBeInstanceOf(GuardianQueryClient);
    expect(client.guardian).toBe(client.guardian);
  });
});

// ----------------------------------------------------------------------------
// block height hint
// ----------------------------------------------------------------------------

describe('KalvoraClient.getLatestBlockHeight', () => {
  it('caches the height as a hint so the second call costs few requests', async () => {
    const { transport, blockCalls } = simulatedChain(100n);
    const client = new KalvoraClient({ grpc: { transport } });

    expect(await client.getLatestBlockHeight()).toBe(100n);
    const firstCallCount = blockCalls.length;
    expect(firstCallCount).toBeGreaterThan(5);

    blockCalls.length = 0;
    expect(await client.getLatestBlockHeight()).toBe(100n);
    expect(blockCalls).toEqual([100n, 101n]);
  });
});

// ----------------------------------------------------------------------------
// submission
// ----------------------------------------------------------------------------

describe('KalvoraClient.submit', () => {
  it('routes a signed MintTXN to TXNService.Mint and returns the hex hash', async () => {
    const { transport, submitted, blockCalls } = simulatedChain(5n, { include: false });
    const client = new KalvoraClient({ grpc: { transport } });
    const txn = await createMintTXN(MINT_INPUT, alice.privateKey, OFFLINE);

    const hash = await client.submit(txn);
    expect(hash).toBe(bytesToHex(txn.base!.hash!));
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.base!.hash).toEqual(txn.base!.hash);
    expect(blockCalls).toHaveLength(0);
  });

  it('rejects an unsigned transaction without any network call', async () => {
    const { transport, submitted, blockCalls } = simulatedChain(5n);
    const client = new KalvoraClient({ grpc: { transport } });
    const unsigned = await buildMintTXN(MINT_INPUT, OFFLINE);

    await expect(client.submit(unsigned)).rejects.toThrow(/Cannot submit unsigned zera_txn\.MintTXN/);
    expect(submitted).toHaveLength(0);
    expect(blockCalls).toHaveLength(0);
  });
});

describe('KalvoraClient.submitAndWait', () => {
  it('returns the confirmation from the block produced after submission (OK)', async () => {
    const { transport, submitted } = simulatedChain(40n, { status: TXN_STATUS.OK });
    const client = new KalvoraClient({ grpc: { transport } });
    const txn = await createMintTXN(MINT_INPUT, alice.privateKey, OFFLINE);

    const result = await client.submitAndWait(txn, { pollIntervalMs: 1, timeoutMs: 2000 });
    expect(submitted).toHaveLength(1);
    expect(result.blockHeight).toBe(41n);
    expect(result.hash).toBe(bytesToHex(txn.base!.hash!));
    expect(result.success).toBe(true);
    expect(result.statusName).toBe('OK');

    // the hint advanced to the confirmation height
    expect(await client.getLatestBlockHeight()).toBe(41n);
  });

  it('reports a failed (but included) transaction', async () => {
    const { transport } = simulatedChain(7n, { status: TXN_STATUS.INSUFFICIENT_AMOUNT });
    const client = new KalvoraClient({ grpc: { transport } });
    const txn = await createMintTXN(MINT_INPUT, alice.privateKey, OFFLINE);

    const result = await client.submitAndWait(txn, { pollIntervalMs: 1, timeoutMs: 2000 });
    expect(result.blockHeight).toBe(8n);
    expect(result.success).toBe(false);
    expect(result.status).toBe(TXN_STATUS.INSUFFICIENT_AMOUNT);
    expect(result.statusName).toBe('INSUFFICIENT_AMOUNT');
  });

  it('times out when the transaction is never included', async () => {
    const { transport, submitted } = simulatedChain(3n, { include: false });
    const client = new KalvoraClient({ grpc: { transport } });
    const txn = await createMintTXN(MINT_INPUT, alice.privateKey, OFFLINE);
    const hash = bytesToHex(txn.base!.hash!);

    const started = Date.now();
    await expect(client.submitAndWait(txn, { pollIntervalMs: 5, timeoutMs: 40 }))
      .rejects.toThrow(`Timed out after 40 ms waiting for transaction ${hash}`);
    expect(submitted).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('honours an already-aborted signal after submitting', async () => {
    const { transport, submitted } = simulatedChain(3n);
    const client = new KalvoraClient({ grpc: { transport } });
    const txn = await createMintTXN(MINT_INPUT, alice.privateKey, OFFLINE);
    const controller = new AbortController();
    controller.abort();

    await expect(client.submitAndWait(txn, { signal: controller.signal })).rejects.toThrow('Aborted');
    expect(submitted).toHaveLength(1);
  });

  it('does not submit an unsigned transaction', async () => {
    const { transport, submitted } = simulatedChain(3n);
    const client = new KalvoraClient({ grpc: { transport } });
    const unsigned = await buildMintTXN(MINT_INPUT, OFFLINE);

    await expect(client.submitAndWait(unsigned, { pollIntervalMs: 1, timeoutMs: 100 })).rejects.toThrow(/unsigned/);
    expect(submitted).toHaveLength(0);
  });
});
