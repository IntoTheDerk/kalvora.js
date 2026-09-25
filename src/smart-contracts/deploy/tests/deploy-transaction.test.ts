/**
 * Smart contract deploy transaction builder tests.
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

import { LANGUAGE } from '../../../../proto/generated/txn_pb.js';
import { ED25519_TEST_KEYS } from '../../../test-utils/keys.test.js';
import {
  buildSmartContractTXN,
  createSmartContractTXN
} from '../transaction.js';

const decoder = new TextDecoder();
const { publicKey, privateKey } = ED25519_TEST_KEYS.alice;

describe('buildSmartContractTXN', () => {
  it('builds an unsigned smart contract deployment transaction', async () => {
    const txn = await buildSmartContractTXN({
      smartContractName: 'hello_contract_rust',
      binaryCode: new Uint8Array([0, 97, 115, 109]),
      sourceCode: 'ipfs://bafybeihash/hello_contract.rs',
      language: LANGUAGE.COMPILED,
      functions: ['init', 'execute'],
      publicKeyBase58Identifier: publicKey,
      nonce: '7',
      feeAmountParts: '777',
      memo: 'deploy hello'
    });

    expect(txn.$typeName).toBe('zera_txn.SmartContractTXN');
    expect(txn.smartContractName).toBe('hello_contract_rust');
    expect(txn.language).toBe(LANGUAGE.COMPILED);
    expect(txn.functions).toEqual(['init', 'execute']);
    expect(decoder.decode(txn.sourceCode)).toBe('ipfs://bafybeihash/hello_contract.rs');
    expect(Array.from(txn.binaryCode)).toEqual([0, 97, 115, 109]);
    expect(String(txn.base?.nonce)).toBe('7');
    expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.base?.feeAmount).toBe('777');
    expect(txn.base?.signature).toBeUndefined();
  });

  it('supports deploy-oriented alias naming', () => {
    expect(buildSmartContractTXN).toBe(buildSmartContractTXN);
  });

  it('throws when smartContractName is missing', async () => {
    await expect(
      buildSmartContractTXN({
        smartContractName: '',
        sourceCode: 'code',
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('smartContractName is required');
  });

  it('throws when no code is provided', async () => {
    await expect(
      buildSmartContractTXN({
        smartContractName: 'hello_contract',
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('binaryCode or sourceCode is required');
  });

  it('allows sourceCode to be omitted when binaryCode is provided', async () => {
    const txn = await buildSmartContractTXN({
      smartContractName: 'hello_contract',
      binaryCode: new Uint8Array([1, 2, 3]),
      language: LANGUAGE.COMPILED,
      publicKeyBase58Identifier: publicKey,
      nonce: 1,
      feeAmountParts: '1'
    });

    expect(txn.sourceCode).toHaveLength(0);
    expect(Array.from(txn.binaryCode)).toEqual([1, 2, 3]);
  });

  it('throws when compiled binaryCode is missing', async () => {
    await expect(
      buildSmartContractTXN({
        smartContractName: 'hello_contract',
        sourceCode: 'ipfs://bafybeihash/hello_contract.rs',
        language: LANGUAGE.COMPILED,
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('binaryCode is required for compiled smart contracts');
  });

  it('throws when binaryCode is empty', async () => {
    await expect(
      buildSmartContractTXN({
        smartContractName: 'hello_contract',
        binaryCode: new Uint8Array(),
        language: LANGUAGE.COMPILED,
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('binaryCode cannot be empty');
  });

  it('allows source-only deployments for source-language contracts', async () => {
    const txn = await buildSmartContractTXN({
      smartContractName: 'hello_contract_python',
      sourceCode: 'def execute(): return True',
      language: LANGUAGE.PYTHON,
      publicKeyBase58Identifier: publicKey,
      nonce: 1,
      feeAmountParts: '1'
    });

    expect(txn.binaryCode).toHaveLength(0);
    expect(decoder.decode(txn.sourceCode)).toBe('def execute(): return True');
    expect(txn.language).toBe(LANGUAGE.PYTHON);
  });

  it('throws when sourceCode is empty', async () => {
    await expect(
      buildSmartContractTXN({
        smartContractName: 'hello_contract_python',
        sourceCode: '   ',
        language: LANGUAGE.PYTHON,
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('sourceCode cannot be empty');
  });

  it('throws when functions contain an empty name', async () => {
    await expect(
      buildSmartContractTXN({
        smartContractName: 'hello_contract',
        binaryCode: new Uint8Array([1, 2, 3]),
        functions: ['init', ''],
        publicKeyBase58Identifier: publicKey,
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('functions cannot contain empty names');
  });
});

describe('createSmartContractTXN', () => {
  it('signs and hashes a smart contract deployment transaction', async () => {
    const txn = await createSmartContractTXN({
      smartContractName: 'hello_contract',
      binaryCode: new Uint8Array([1, 2, 3]),
      language: LANGUAGE.COMPILED,
      functions: ['init'],
      publicKeyBase58Identifier: publicKey,
      privateKeyBase58: privateKey,
      nonce: 8,
      feeAmountParts: '888'
    });

    expect(txn.base?.signature?.length).toBeGreaterThan(0);
    expect(txn.base?.hash?.length).toBeGreaterThan(0);
    expect(Array.from(txn.binaryCode)).toEqual([1, 2, 3]);
  });

  it('throws when privateKeyBase58 is missing', async () => {
    await expect(
      createSmartContractTXN({
        smartContractName: 'hello_contract',
        sourceCode: 'code',
        publicKeyBase58Identifier: publicKey,
        privateKeyBase58: '',
        nonce: 1,
        feeAmountParts: '1'
      })
    ).rejects.toThrow('privateKeyBase58 is required');
  });
});
