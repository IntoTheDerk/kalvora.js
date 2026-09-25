import { describe, expect, it, vi } from 'vitest';

import {
  createSmartSwap,
  resolveIndexerClient,
  SMART_SWAP_CLIENT_ERROR,
  SMART_SWAP_TRANSACTION_TYPE,
  type SmartSwapDexClient,
  type SmartSwapIndexerRequest,
  type SmartSwapResponse,
  type SmartSwapSerializedTransaction
} from '../index.js';

const transaction = {
  type: SMART_SWAP_TRANSACTION_TYPE,
  data: 'AQID',
  version: 1 as const
};

// Structural dummy matching the canonical Ed25519 identifier shape used by
// the injected client contract. Cryptographic key validation is performed by
// the transaction builders, not this forwarding facade.
const publicKey = `A_${'1'.repeat(32)}`;

function response(overrides: Partial<SmartSwapResponse> = {}): SmartSwapResponse {
  return {
    tokenIn: 'LEET1337',
    tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    amountIn: 10,
    amountOut: 9.8,
    netAmountOut: 9.7,
    startRate: 1,
    avgRate: 0.98,
    endRate: 0.97,
    slippage: 2,
    rateImpact: 3,
    poolFeePercent: 0.75,
    platformFee: 0.1,
    platformFeeBps: 75,
    feeContractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    stages: [{ legs: [{
      token_in: 'LEET1337',
      token_out: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      pool_fee_bps: 75,
      amount_in: '10'
    }] }],
    hopDetails: [],
    ...overrides
  };
}

function mockDex(result: SmartSwapResponse): {
  dex: SmartSwapDexClient;
  swap: ReturnType<typeof vi.fn<(params: SmartSwapIndexerRequest) => Promise<SmartSwapResponse>>>;
} {
  const swap = vi.fn(async (_params: SmartSwapIndexerRequest) => result);
  return { dex: { swap }, swap };
}

describe('Smart Swap injected indexer contract', () => {
  it('accepts the upstream transaction version as number and narrows validated builds to 1', async () => {
    type UpstreamResponse = Omit<SmartSwapResponse, 'transaction'> & {
      transaction?: SmartSwapSerializedTransaction;
    };
    const upstreamDex = {
      swap: async (_params: SmartSwapIndexerRequest): Promise<UpstreamResponse> => response({ transaction })
    };

    const built = await createSmartSwap(upstreamDex).swap({
      tokenIn: 'LEET1337',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10,
      minAmountOut: '9.5'
    }, publicKey);

    const validatedVersion: 1 = built.transaction.version;
    expect(validatedVersion).toBe(1);
  });

  it('accepts a KalvoraClient-shaped object and a direct DEX module', () => {
    const { dex } = mockDex(response());
    expect(resolveIndexerClient({ v1: { dex } })).toBe(dex);
    expect(resolveIndexerClient(dex)).toBe(dex);
  });

  it('rejects invalid injected clients with a stable error', () => {
    expect(() => resolveIndexerClient({} as never)).toThrowError(SMART_SWAP_CLIENT_ERROR);
  });

  it('forwards quote fields without a public key or build flag', async () => {
    const { dex, swap } = mockDex(response());
    const swaps = createSmartSwap({ v1: { dex } });

    await swaps.getQuote({
      tokenIn: 'LEET1337',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10,
      platformFeeBps: 75
    });

    expect(swap).toHaveBeenCalledWith({
      tokenIn: 'LEET1337',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10,
      platformFeeBps: 75
    });
  });

  it('requests and validates a nested direct-build transaction', async () => {
    const { dex, swap } = mockDex(response({ transaction }));
    const swaps = createSmartSwap(dex);

    const built = await swaps.swap({
      tokenIn: 'LEET1337',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10,
      minAmountOut: '9.5',
      feeContractID: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
    }, publicKey);

    expect(built.transaction).toEqual(transaction);
    expect(swap).toHaveBeenCalledWith({
      tokenIn: 'LEET1337',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10,
      minAmountOut: '9.5',
      feeContractID: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      includeTransaction: true,
      publicKey
    });
  });

  it('builds from non-empty stages and keeps the response envelope nested', async () => {
    const quote = response();
    const { dex, swap } = mockDex(response({ transaction }));
    const swaps = createSmartSwap(dex);

    await swaps.swapFromStages({
      stages: quote.stages,
      minAmountOut: '9.5'
    }, publicKey);

    expect(swap).toHaveBeenCalledWith({
      stages: quote.stages,
      minAmountOut: '9.5',
      includeTransaction: true,
      publicKey
    });
  });

  it.each([
    undefined,
    { ...transaction, type: 'zera_txn.CoinTXN' },
    { ...transaction, data: null },
    { ...transaction, data: 'not base64!' },
    { ...transaction, version: 2 },
    { ...transaction, data: `${'A'.repeat(1_398_103)}=` }
  ])('rejects an unsafe build envelope: %o', async (unsafeTransaction) => {
    const { dex } = mockDex(response({
      ...(unsafeTransaction === undefined ? {} : {
        transaction: unsafeTransaction as typeof transaction
      })
    }));

    await expect(createSmartSwap(dex).swap({
      tokenIn: 'LEET1337',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10,
      minAmountOut: '9.5'
    }, publicKey)).rejects.toThrowError(
      'Kalvora indexer swap response is missing a valid version 1 serialized transaction'
    );
  });

  it('accepts a serialized transaction exactly at the 1 MiB decoded limit', async () => {
    const boundaryTransaction = {
      ...transaction,
      data: `${'A'.repeat(1_398_102)}==`
    };
    const { dex } = mockDex(response({ transaction: boundaryTransaction }));

    const built = await createSmartSwap(dex).swap({
      tokenIn: 'LEET1337',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10,
      minAmountOut: '9.5'
    }, publicKey);

    expect(built.transaction.data).toHaveLength(1_398_104);
  });

  it('validates request fields before calling the indexer', async () => {
    const { dex, swap } = mockDex(response());
    const swaps = createSmartSwap(dex);

    await expect(swaps.getQuote({
      tokenIn: '',
      tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      amountIn: 10
    })).rejects.toThrowError('smartSwap.getQuote: tokenIn must be a non-empty string');

    await expect(swaps.swapFromStages({
      stages: [],
      minAmountOut: '0'
    }, publicKey)).rejects.toThrowError(
      'smartSwap.swapFromStages: stages must be a non-empty array'
    );
    expect(swap).not.toHaveBeenCalled();
  });
});
