/**
 * Read-only smoke tests. Set KALVORA_LIVE_ENDPOINT to a finalized API gateway.
 * To verify a deployment, also supply its independently trusted
 * KALVORA_LIVE_NETWORK_NAME, KALVORA_LIVE_GENESIS_HASH and KALVORA_LIVE_OPERATOR_ADDRESS.
 * KALVORA_LIVE_VALIDATOR_VERSION optionally checks the reported block header version (200032 for v35).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { decodeWalletAddress } from '../../shared/crypto/falcon-address.js';
import { deriveChainId } from '../../shared/network/chain-id.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { bytesToHex } from '../../shared/utils/byte-utils.js';
import { createQueryClient } from '../api-client.js';
import { summarizeBlock } from '../decoders.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const ENDPOINT = process.env.KALVORA_LIVE_ENDPOINT ?? '';

const NETWORK = process.env.KALVORA_LIVE_NETWORK_NAME ?? '';
const GENESIS = process.env.KALVORA_LIVE_GENESIS_HASH ?? '';
const OPERATOR = process.env.KALVORA_LIVE_OPERATOR_ADDRESS ?? '';
const EXPECTED_VERSION = process.env.KALVORA_LIVE_VALIDATOR_VERSION;
const PINNED = Boolean(NETWORK || GENESIS || OPERATOR);

describe.skipIf(!ENDPOINT)('live read-only query', () => {
  const LIVE_TIMEOUT = 60_000;
  let query: ReturnType<typeof createQueryClient>;

  beforeAll(async () => {
    if (!PINNED) {
      query = createQueryClient({ endpoint: ENDPOINT });
      return;
    }
    if ((NETWORK !== 'kal_proto' && NETWORK !== 'kal_main') || !/^[0-9a-f]{64}$/iu.test(GENESIS) || !OPERATOR) {
      throw new Error('Pinned reads require the network name, final genesis hash, and registered operator address');
    }
    expect(new URL(ENDPOINT).protocol).toBe('https:');
    decodeWalletAddress(OPERATOR);
    query = createQueryClient({
      endpoint: ENDPOINT, trustedOperatorAddress: OPERATOR,
      transactionContext: { chainId: deriveChainId(NETWORK, GENESIS) }
    });
    const header = (await query.getBlock({ height: 0 })).blockHeader;
    expect(header?.blockHeight).toBe(0n);
    expect(header?.hash && bytesToHex(header.hash)).toBe(GENESIS.toLowerCase());
  }, LIVE_TIMEOUT);

  it('getAuthorizedFeeTokens includes the native token', async () => {
    const tokens = await query.getAuthorizedFeeTokens();
    expect(tokens.length).toBeGreaterThan(0);
    const native = tokens.find(t => t.contractId === KALVORA_NATIVE_TOKEN);
    expect(native).toBeDefined();
    expect(typeof native?.usedFees).toBe('bigint');
  }, LIVE_TIMEOUT);

  it('getDenomination(KALVORA_NATIVE_TOKEN) is 1e9', async () => {
    expect(await query.getDenomination(KALVORA_NATIVE_TOKEN)).toBe(1_000_000_000n);
  }, LIVE_TIMEOUT);

  it('getContract(KALVORA_NATIVE_TOKEN) returns the KALV definition', async () => {
    const operator = PINNED ? await query.resolveOperator(OPERATOR) : undefined;
    const info = await query.getContract(KALVORA_NATIVE_TOKEN, operator);
    expect(info.operatorVerified).toBe(PINNED);
    expect(info.contract.symbol).toBe('KALV');
    expect(info.contract.name).toBe('Kalvora');
  }, LIVE_TIMEOUT);

  it('getBlock({ height: 0 }) returns genesis and summarizeBlock decodes it', async () => {
    const block = await query.getBlock({ height: 0 });
    expect(block.blockHeader?.blockHeight).toBe(0n);
    if (EXPECTED_VERSION !== undefined) expect(block.blockHeader?.version).toBe(BigInt(EXPECTED_VERSION));
    const summary = summarizeBlock(block);
    expect(summary.height).toBe(0n);
    expect(summary.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(summary.transactionCount).toBeGreaterThanOrEqual(0);
    expect(summary.results.length).toBeGreaterThanOrEqual(0);
  }, LIVE_TIMEOUT);

  it('getLatestBlockHeight finds the tip and summarizeBlock decodes it', async () => {
    const tip = await query.getLatestBlockHeight();
    expect(tip).toBeGreaterThan(0n);
    expect(await query.hasBlock(tip)).toBe(true);

    // A hint at (or just below) the tip must agree (the chain may advance meanwhile).
    const again = await query.getLatestBlockHeight(tip);
    expect(again).toBeGreaterThanOrEqual(tip);

    const block = await query.getBlock({ height: tip });
    const summary = summarizeBlock(block);
    expect(summary.height).toBe(tip);
    expect(summary.previousHash).toMatch(/^[0-9a-f]{64}$/u);
    if (summary.timestamp) {
      expect(summary.timestamp.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    }
    const counted = Object.values(summary.transactionsByType).reduce((a, b) => a + b, 0);
    expect(counted).toBe(summary.transactionCount);
  }, LIVE_TIMEOUT * 2);
});
