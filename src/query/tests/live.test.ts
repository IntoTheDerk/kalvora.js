/**
 * LIVE, read-only query tests against a real Kalvora node.
 *
 * Skipped unless `KALVORA_LIVE_ENDPOINT` is set, e.g.
 *
 *   KALVORA_LIVE_ENDPOINT=https://kal-protonet.visiondynamics.ch npx vitest run src/query/tests/live.test.ts
 *
 * Only read RPCs are used. This file never builds, signs or submits a transaction.
 */
import { describe, expect, it, vi } from 'vitest';

import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { createQueryClient } from '../api-client.js';
import { summarizeBlock } from '../decoders.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const ENDPOINT = process.env.KALVORA_LIVE_ENDPOINT ?? '';

describe.skipIf(!ENDPOINT)(`live query (${ENDPOINT || 'KALVORA_LIVE_ENDPOINT not set'})`, () => {
  const query = createQueryClient({ endpoint: ENDPOINT });
  const LIVE_TIMEOUT = 60_000;

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
    const info = await query.getContract(KALVORA_NATIVE_TOKEN);
    expect(info.contract.symbol).toBe('KALV');
    expect(info.contract.name).toBe('Kalvora');
  }, LIVE_TIMEOUT);

  it('getBlock({ height: 0 }) returns genesis and summarizeBlock decodes it', async () => {
    const block = await query.getBlock({ height: 0 });
    expect(block.blockHeader?.blockHeight ?? 0n).toBe(0n);
    const summary = summarizeBlock(block);
    expect(summary.height).toBe(0n);
    expect(summary.hash).toMatch(/^[0-9a-f]*$/u);
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
