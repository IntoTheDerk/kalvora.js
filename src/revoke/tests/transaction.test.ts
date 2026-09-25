import { fromBinary, toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { RevokeTXNSchema } from '../../../proto/generated/txn_pb.js';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { buildRevokeTXN, createRevokeTXN, sendRevokeTXN, type RevokeTXNInput } from '../index.js';

const { alice, charlie } = ED25519_TEST_KEYS;
const OPTIONS = {
  nonce: 3,
  feeAmountParts: '250',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};
const INPUT: RevokeTXNInput = {
  contractId: 'KALSBT001',
  recipientAddress: charlie.address,
  itemId: '17',
  publicKey: alice.publicKey
};

describe('RevokeTXN', () => {
  it('maps input fields onto an unsigned RevokeTXN', async () => {
    const txn = await buildRevokeTXN(INPUT, { ...OPTIONS, memo: 'licence withdrawn', safeSend: false });

    expect(txn.$typeName).toBe('zera_txn.RevokeTXN');
    expect(txn.contractId).toBe('KALSBT001');
    expect(txn.itemId).toBe('17');
    expect(txn.recipientAddress).toEqual(bs58.decode(charlie.address));
    expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.base?.feeAmount).toBe('250');
    expect(txn.base?.nonce).toBe(3n);
    expect(txn.base?.memo).toBe('licence withdrawn');
    expect(txn.base?.safeSend).toBe(false);
    expect(txn.base?.publicKey?.single).toEqual(new Uint8Array(getPublicKeyBytes(alice.publicKey)));
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it.each([
    [{ contractId: 'not a mint id' }, /contractId must be a Kalvora mint ID/],
    [{ recipientAddress: undefined }, /recipientAddress must be a non-empty base58 address/],
    [{ recipientAddress: 'bad!address' }, /recipientAddress is not a valid base58 address/],
    [{ itemId: '' }, /itemId must be a non-empty string/],
    [{ itemId: 17 }, /itemId must be a non-empty string/],
    [{ itemId: ' 17 ' }, /itemId must not contain leading or trailing whitespace/],
    [{ publicKey: '   ' }, /publicKey identifier is required/]
  ])('rejects invalid input %j', async (override, message) => {
    await expect(
      buildRevokeTXN({ ...INPUT, ...override } as unknown as RevokeTXNInput, OPTIONS)
    ).rejects.toThrow(message);
  });

  it('rejects a missing input object', async () => {
    await expect(buildRevokeTXN(null as unknown as RevokeTXNInput, OPTIONS)).rejects.toThrow(/input object is required/);
  });

  it('signs via createRevokeTXN and round-trips through binary', async () => {
    const txn = await createRevokeTXN(INPUT, alice.privateKey, OPTIONS);

    expect(txn.base?.signature?.length).toBe(64);
    expect(txn.base?.hash?.length).toBe(32);

    const decoded = fromBinary(RevokeTXNSchema, toBinary(RevokeTXNSchema, txn));
    expect(decoded).toEqual(txn);
  });

  it('createRevokeTXN requires a private key', async () => {
    await expect(createRevokeTXN(INPUT, '', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('sendRevokeTXN rejects unsigned transactions', async () => {
    const txn = await buildRevokeTXN(INPUT, OPTIONS);
    await expect(sendRevokeTXN(txn)).rejects.toThrow(/must be signed/);
  });
});
