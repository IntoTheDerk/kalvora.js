/**
 * Kalvora-side bridge fee option handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSmartContractExecuteTXNMock } = vi.hoisted(() => ({
  createSmartContractExecuteTXNMock: vi.fn(async (...args: unknown[]) => ({ args }))
}));

vi.mock('../../../execute/index.js', () => ({
  createSmartContractExecuteTXN: createSmartContractExecuteTXNMock,
  ParamType: {
    STRING: 'string'
  }
}));

import { createBridgeTransaction } from '../kalvora/utils.js';

describe('Kalvora bridge fee options', () => {
  beforeEach(() => {
    createSmartContractExecuteTXNMock.mockClear();
  });

  it('passes gasFeeInUsd without forcing a manual feeAmountParts override', async () => {
    await createBridgeTransaction(
      'burn_sol',
      'solana-SOL000000,1000000,solana-destination',
      'public-key',
      'private-key',
      'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      {
        gasFeeInUsd: 5,
        nonce: 1,
        grpcConfig: { host: 'dev.example.test' }
      }
    );

    const options = createSmartContractExecuteTXNMock.mock.calls[0]?.[6] as {
      feeId?: string;
      feeAmountParts?: string;
      gasFeeInUsd?: number;
    };

    expect(options.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(options.gasFeeInUsd).toBe(5);
    expect(options.feeAmountParts).toBeUndefined();
  });

  it('passes manual feeAmountParts as raw token parts', async () => {
    await createBridgeTransaction(
      'burn_sol',
      'solana-SOL000000,1000000,solana-destination',
      'public-key',
      'private-key',
      'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      {
        feeAmountParts: '500000000',
        nonce: 1
      }
    );

    const options = createSmartContractExecuteTXNMock.mock.calls[0]?.[6] as {
      feeAmountParts?: string;
    };

    expect(options.feeAmountParts).toBe('500000000');
  });

  it('rejects decimal manual fee amounts', async () => {
    await expect(
      createBridgeTransaction(
        'burn_sol',
        'solana-SOL000000,1000000,solana-destination',
        'public-key',
        'private-key',
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        {
          feeAmountParts: '5.00',
          nonce: 1
        }
      )
    ).rejects.toThrow('feeAmountParts must be an integer string in raw token parts');
  });
});
