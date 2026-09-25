import { fromBinary, toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { MintTXNSchema } from '../../../proto/generated/txn_pb.js';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { buildMintTXN, createMintTXN, sendMintTXN, type MintTXNInput } from '../index.js';

const { alice, bob } = ED25519_TEST_KEYS;
const OPTIONS = {
  nonce: 7,
  feeAmountParts: '100',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};
const INPUT: MintTXNInput = {
  contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  amount: '2500000000',
  recipientAddress: bob.address,
  publicKey: alice.publicKey
};

describe('MintTXN', () => {
  it('maps input fields onto an unsigned MintTXN', async () => {
    const txn = await buildMintTXN(INPUT, { ...OPTIONS, memo: 'mint #1', safeSend: true });

    expect(txn.$typeName).toBe('zera_txn.MintTXN');
    expect(txn.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.amount).toBe('2500000000');
    expect(txn.recipientAddress).toEqual(bs58.decode(bob.address));
    expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.base?.feeAmount).toBe('100');
    expect(txn.base?.nonce).toBe(7n);
    expect(txn.base?.memo).toBe('mint #1');
    expect(txn.base?.safeSend).toBe(true);
    expect(txn.base?.publicKey?.single).toEqual(new Uint8Array(getPublicKeyBytes(alice.publicKey)));
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it('canonicalises bigint / number amounts and honours feeId', async () => {
    const big = await buildMintTXN({ ...INPUT, amount: 1_000_000n }, { ...OPTIONS, feeId: 'USDX0001' });
    expect(big.amount).toBe('1000000');
    expect(big.base?.feeId).toBe('USDX0001');
    const num = await buildMintTXN({ ...INPUT, amount: 42 }, OPTIONS);
    expect(num.amount).toBe('42');
    expect(num.base?.memo).toBeUndefined();
    expect(num.base?.safeSend).toBeUndefined();
  });

  it.each([
    [{ contractId: '' }, /contractId must be a Kalvora mint ID/],
    [{ contractId: ' KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' }, /contractId must be a Kalvora mint ID/],
    [{ amount: '0' }, /amount must be greater than zero/],
    [{ amount: '-5' }, /amount must be a non-negative integer/],
    [{ amount: '1.5' }, /amount must be a non-negative integer/],
    [{ amount: 1.5 }, /amount must be a non-negative integer/],
    [{ recipientAddress: '' }, /recipientAddress must be a non-empty base58 address/],
    [{ recipientAddress: '0OIl' }, /recipientAddress is not a valid base58 address/],
    [{ publicKey: '' }, /publicKey identifier is required/]
  ])('rejects invalid input %j', async (override, message) => {
    await expect(buildMintTXN({ ...INPUT, ...override } as MintTXNInput, OPTIONS)).rejects.toThrow(message);
  });

  it('rejects a missing input object and invalid shared options', async () => {
    await expect(buildMintTXN(undefined as unknown as MintTXNInput, OPTIONS)).rejects.toThrow(/input object is required/);
    await expect(buildMintTXN(INPUT, { ...OPTIONS, feeId: 'bad id' })).rejects.toThrow(/feeId/);
    await expect(buildMintTXN(INPUT, { ...OPTIONS, interfaceFee: '1' })).rejects.toThrow(/provided together/);
  });

  it('signs via createMintTXN and round-trips through binary', async () => {
    const txn = await createMintTXN(INPUT, alice.privateKey, OPTIONS);

    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.signature?.length).toBe(64);
    expect(txn.base?.hash?.length).toBe(32);

    const decoded = fromBinary(MintTXNSchema, toBinary(MintTXNSchema, txn));
    expect(decoded).toEqual(txn);
  });

  it('is deterministic for identical offline inputs', async () => {
    const a = await createMintTXN(INPUT, alice.privateKey, OPTIONS);
    const b = await createMintTXN(INPUT, alice.privateKey, OPTIONS);
    expect(toBinary(MintTXNSchema, a)).toEqual(toBinary(MintTXNSchema, b));
  });

  it('createMintTXN requires a private key', async () => {
    await expect(createMintTXN(INPUT, '', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('sendMintTXN rejects unsigned transactions', async () => {
    const txn = await buildMintTXN(INPUT, OPTIONS);
    await expect(sendMintTXN(txn)).rejects.toThrow(/must be signed/);
  });
});
