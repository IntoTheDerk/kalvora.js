import { fromBinary, toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { ExpenseRatioTXNSchema } from '../../../proto/generated/txn_pb.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  buildExpenseRatioTXN,
  createExpenseRatioTXN,
  sendExpenseRatioTXN,
  type ExpenseRatioInput
} from '../index.js';

const { alice, bob, charlie } = ED25519_TEST_KEYS;
const OPTIONS = {
  nonce: 11,
  feeAmountParts: '100',
  timestamp: new Date('2026-07-25T09:22:00.000Z'),
  memo: 'q3 expense ratio'
};

function baseInput(overrides: Partial<ExpenseRatioInput> = {}): ExpenseRatioInput {
  return {
    publicKey: alice.publicKey,
    contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    addresses: [bob.address, charlie.address],
    outputAddress: alice.address,
    ...overrides
  };
}

describe('buildExpenseRatioTXN', () => {
  it('maps contract, holder addresses and output address', async () => {
    const txn = await buildExpenseRatioTXN(baseInput(), OPTIONS);

    expect(txn.$typeName).toBe('zera_txn.ExpenseRatioTXN');
    expect(txn.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.addresses.map(a => bs58.encode(a))).toEqual([bob.address, charlie.address]);
    expect(bs58.encode(txn.outputAddress)).toBe(alice.address);
    expect(txn.base?.nonce).toBe(11n);
    expect(txn.base?.feeAmount).toBe('100');
    expect(txn.base?.memo).toBe('q3 expense ratio');
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it('round-trips through binary encoding', async () => {
    const txn = await buildExpenseRatioTXN(baseInput(), OPTIONS);
    const decoded = fromBinary(ExpenseRatioTXNSchema, toBinary(ExpenseRatioTXNSchema, txn));
    expect(decoded.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(decoded.addresses).toEqual(txn.addresses);
    expect(decoded.outputAddress).toEqual(txn.outputAddress);
    expect(decoded.base?.memo).toBe('q3 expense ratio');
  });

  describe('validation', () => {
    it.each<[string, Partial<ExpenseRatioInput>, RegExp]>([
      ['empty addresses', { addresses: [] }, /addresses must be a non-empty array/],
      ['non-array addresses', { addresses: bob.address as unknown as string[] }, /addresses must be a non-empty array/],
      ['duplicate addresses', { addresses: [bob.address, charlie.address, bob.address] }, /addresses\[2\] duplicates/],
      ['invalid holder address', { addresses: [bob.address, '0OIl'] }, /addresses\[1\] is not a valid base58/],
      ['empty holder address', { addresses: [''] }, /addresses\[0\] must be a non-empty/],
      ['invalid output address', { outputAddress: '0OIl' }, /outputAddress is not a valid base58/],
      ['missing output address', { outputAddress: undefined as unknown as string }, /outputAddress must be a non-empty/],
      ['invalid contract id', { contractId: 'bad id!' }, /contractId must be a Kalvora mint ID/]
    ])('rejects %s', async (_label, overrides, pattern) => {
      await expect(buildExpenseRatioTXN(baseInput(overrides), OPTIONS)).rejects.toThrow(pattern);
    });
  });
});

describe('createExpenseRatioTXN / sendExpenseRatioTXN', () => {
  it('signs and hashes the transaction', async () => {
    const txn = await createExpenseRatioTXN(baseInput(), alice.privateKey, OPTIONS);
    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.signature?.length).toBeGreaterThan(0);
    expect(txn.base?.hash).toBeInstanceOf(Uint8Array);
    expect(txn.base?.hash?.length).toBeGreaterThan(0);

    const decoded = fromBinary(ExpenseRatioTXNSchema, toBinary(ExpenseRatioTXNSchema, txn));
    expect(decoded.base?.signature).toEqual(txn.base?.signature);
    expect(decoded.base?.hash).toEqual(txn.base?.hash);
  });

  it('requires a private key', async () => {
    await expect(createExpenseRatioTXN(baseInput(), '', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('refuses to submit an unsigned transaction', async () => {
    const txn = await buildExpenseRatioTXN(baseInput(), OPTIONS);
    await expect(sendExpenseRatioTXN(txn)).rejects.toThrow(/must be signed/);
  });
});
