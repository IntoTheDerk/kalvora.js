/**
 * Smart contract instantiate transaction builder tests.
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
import { ParamType } from '../../shared/parameters.js';
import {
  buildSmartContractInstantiateTXN,
  createSmartContractInstantiateTXN
} from '../transaction.js';

const decoder = new TextDecoder();
const { publicKey, privateKey } = ED25519_TEST_KEYS.alice;

describe('buildSmartContractInstantiateTXN', () => {
  it('builds an unsigned smart contract instantiate transaction', async () => {
    const txn = await buildSmartContractInstantiateTXN({
      smartContractName: 'hello_contract',
      instance: 2,
      parameters: [
        { type: ParamType.STRING, value: 'owner' },
        { type: ParamType.UINT64, value: 42 }
      ],
      publicKeyBase58Identifier: publicKey,
      nonce: '9',
      feeAmountParts: '999',
      memo: 'instantiate hello'
    });

    expect(txn.$typeName).toBe('zera_txn.SmartContractInstantiateTXN');
    expect(txn.smartContractName).toBe('hello_contract');
    expect(txn.instance).toBe(2);
    expect(txn.parameters).toHaveLength(2);
    expect(txn.parameters[0]?.type).toBe(ParamType.STRING);
    expect(decoder.decode(txn.parameters[0]?.value)).toBe('owner');
    expect(txn.parameters[1]?.type).toBe(ParamType.UINT64);
    expect(decoder.decode(txn.parameters[1]?.value)).toBe('42');
    expect(String(txn.base?.nonce)).toBe('9');
    expect(txn.base?.feeAmount).toBe('999');
    expect(txn.base?.signature).toBeUndefined();
  });

  it('throws when smartContractName is missing', async () => {
    await expect(
      buildSmartContractInstantiateTXN({
        smartContractName: '',
        instance: 0,
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('smartContractName is required');
  });

  it('throws when instance is invalid', async () => {
    await expect(
      buildSmartContractInstantiateTXN({
        smartContractName: 'hello_contract',
        instance: -1,
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('instance must be an unsigned 32-bit integer');
  });

  it('throws when publicKeyBase58Identifier is missing', async () => {
    await expect(
      buildSmartContractInstantiateTXN({
        smartContractName: 'hello_contract',
        instance: 0,
        publicKeyBase58Identifier: '',
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('publicKeyBase58Identifier is required');
  });
});

describe('createSmartContractInstantiateTXN', () => {
  it('signs and hashes a smart contract instantiate transaction', async () => {
    const txn = await createSmartContractInstantiateTXN({
      smartContractName: 'hello_contract',
      instance: 1,
      parameters: [],
      publicKeyBase58Identifier: publicKey,
      privateKeyBase58: privateKey,
      nonce: 10,
      feeAmountParts: '1000'
    });

    expect(txn.base?.signature?.length).toBeGreaterThan(0);
    expect(txn.base?.hash?.length).toBeGreaterThan(0);
  });

  it('throws when privateKeyBase58 is missing', async () => {
    await expect(
      createSmartContractInstantiateTXN({
        smartContractName: 'hello_contract',
        instance: 1,
        publicKeyBase58Identifier: publicKey,
        privateKeyBase58: '',
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('privateKeyBase58 is required');
  });
});
