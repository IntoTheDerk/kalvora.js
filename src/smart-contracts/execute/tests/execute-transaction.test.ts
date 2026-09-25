/**
 * Smart contract execute transaction builder tests.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/fee-calculators/universal-fee-calculator.js', () => ({
  UniversalFeeCalculator: {
    calculateFee: vi.fn(async (options: {
      protoObject: { base?: { feeAmount?: string; feeId?: string } };
      baseFeeId: string;
      baseFeeParts?: string;
    }) => {
      if (options.protoObject.base) {
        options.protoObject.base.feeId = options.baseFeeId;
        options.protoObject.base.feeAmount = options.baseFeeParts ?? '123';
      }
      return options.protoObject;
    })
  }
}));

import { ED25519_TEST_KEYS } from '../../../test-utils/keys.test.js';
import {
  buildSmartContractExecuteTXN,
  createSmartContractExecuteTXN,
  ParamType
} from '../transaction.js';

const decoder = new TextDecoder();
const { publicKey, privateKey } = ED25519_TEST_KEYS.alice;

describe('buildSmartContractExecuteTXN', () => {
  it('builds an unsigned smart contract execute transaction', async () => {
    const txn = await buildSmartContractExecuteTXN(
      'hello_contract',
      3,
      'execute',
      [
        { type: ParamType.STRING, value: 'owner' },
        { type: ParamType.UINT64, value: 42 }
      ],
      publicKey,
      {
        nonce: '11',
        feeAmountParts: '1111',
        memo: 'execute hello'
      }
    );

    expect(txn.$typeName).toBe('zera_txn.SmartContractExecuteTXN');
    expect(txn.smartContractName).toBe('hello_contract');
    expect(txn.instance).toBe(3);
    expect(txn.function).toBe('execute');
    expect(txn.parameters).toHaveLength(2);
    expect(txn.parameters[0]?.type).toBe(ParamType.STRING);
    expect(decoder.decode(txn.parameters[0]?.value)).toBe('owner');
    expect(txn.parameters[1]?.type).toBe(ParamType.UINT64);
    expect(decoder.decode(txn.parameters[1]?.value)).toBe('42');
    expect(String(txn.base?.nonce)).toBe('11');
    expect(txn.base?.feeAmount).toBe('1111');
    expect(txn.base?.signature).toBeUndefined();
  });

  it('throws when smartContractName is missing', async () => {
    await expect(
      buildSmartContractExecuteTXN('', 0, 'execute', [], publicKey, {
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('smartContractName is required');
  });

  it('throws when functionName is missing', async () => {
    await expect(
      buildSmartContractExecuteTXN('hello_contract', 0, '', [], publicKey, {
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('functionName is required');
  });

  it('throws when instance is invalid', async () => {
    await expect(
      buildSmartContractExecuteTXN('hello_contract', -1, 'execute', [], publicKey, {
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('instance must be an unsigned 32-bit integer');
  });

  it('throws when parameters are not an array', async () => {
    await expect(
      buildSmartContractExecuteTXN(
        'hello_contract',
        0,
        'execute',
        undefined as unknown as never[],
        publicKey,
        {
          nonce: 1,
          feeAmountParts: '1'
        }
      )
    ).rejects.toThrow('parameters must be an array');
  });
});

describe('createSmartContractExecuteTXN', () => {
  it('signs and hashes a smart contract execute transaction', async () => {
    const txn = await createSmartContractExecuteTXN(
      'hello_contract',
      1,
      'execute',
      [],
      publicKey,
      privateKey,
      {
        nonce: 12,
        feeAmountParts: '1212'
      }
    );

    expect(txn.base?.signature?.length).toBeGreaterThan(0);
    expect(txn.base?.hash?.length).toBeGreaterThan(0);
  });

  it('throws when privateKeyBase58 is missing', async () => {
    await expect(
      createSmartContractExecuteTXN(
        'hello_contract',
        1,
        'execute',
        [],
        publicKey,
        '',
        {
          nonce: 1,
          feeAmountParts: '1'
        }
      )
    ).rejects.toThrow('privateKeyBase58 is required');
  });
});
