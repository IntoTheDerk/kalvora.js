import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { QuashTXNSchema } from '../../../proto/generated/txn_pb.js';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { buildQuashTXN, createQuashTXN, sendQuashTXN, type QuashTXNInput } from '../index.js';

const { alice } = ED25519_TEST_KEYS;
const TXN_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OPTIONS = {
  nonce: 8,
  feeAmountParts: '1000',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};
const INPUT: QuashTXNInput = {
  contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  txnHash: TXN_HASH,
  publicKey: alice.publicKey
};

describe('QuashTXN', () => {
  it('maps input fields onto an unsigned QuashTXN', async () => {
    const txn = await buildQuashTXN(INPUT, { ...OPTIONS, memo: 'stop pending mint' });

    expect(txn.$typeName).toBe('zera_txn.QuashTXN');
    expect(txn.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.txnHash).toEqual(Uint8Array.from(Buffer.from(TXN_HASH, 'hex')));
    expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.base?.feeAmount).toBe('1000');
    expect(txn.base?.nonce).toBe(8n);
    expect(txn.base?.memo).toBe('stop pending mint');
    expect(txn.base?.safeSend).toBeUndefined();
    expect(txn.base?.publicKey?.single).toEqual(new Uint8Array(getPublicKeyBytes(alice.publicKey)));
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it('accepts 0x-prefixed and upper-case hashes', async () => {
    const txn = await buildQuashTXN({ ...INPUT, txnHash: `0x${TXN_HASH.toUpperCase()}` }, OPTIONS);
    expect(txn.txnHash).toEqual(Uint8Array.from(Buffer.from(TXN_HASH, 'hex')));
  });

  it.each([
    [{ contractId: '' }, /contractId must be a Kalvora mint ID/],
    [{ txnHash: '' }, /txnHash must be a 32-byte hex string/],
    [{ txnHash: TXN_HASH.slice(2) }, /txnHash must be a 32-byte hex string/],
    [{ txnHash: `${TXN_HASH}00` }, /txnHash must be a 32-byte hex string/],
    [{ txnHash: `zz${TXN_HASH.slice(2)}` }, /txnHash must be a 32-byte hex string/],
    [{ publicKey: undefined }, /publicKey identifier is required/]
  ])('rejects invalid input %j', async (override, message) => {
    await expect(
      buildQuashTXN({ ...INPUT, ...override } as unknown as QuashTXNInput, OPTIONS)
    ).rejects.toThrow(message);
  });

  it('rejects a missing input object', async () => {
    await expect(buildQuashTXN(undefined as unknown as QuashTXNInput, OPTIONS)).rejects.toThrow(/input object is required/);
  });

  it('signs via createQuashTXN and round-trips through binary', async () => {
    const txn = await createQuashTXN(INPUT, alice.privateKey, OPTIONS);

    expect(txn.base?.signature?.length).toBe(64);
    expect(txn.base?.hash?.length).toBe(32);

    const decoded = fromBinary(QuashTXNSchema, toBinary(QuashTXNSchema, txn));
    expect(decoded).toEqual(txn);
  });

  it('createQuashTXN requires a private key', async () => {
    await expect(createQuashTXN(INPUT, '  ', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('sendQuashTXN rejects unsigned transactions', async () => {
    const txn = await buildQuashTXN(INPUT, OPTIONS);
    await expect(sendQuashTXN(txn)).rejects.toThrow(/must be signed/);
  });
});
