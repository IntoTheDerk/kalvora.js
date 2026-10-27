import { clone, create, toBinary } from '@bufbuild/protobuf';
import { ed25519 } from '@noble/curves/ed25519.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoinTXNSchema, FeePayerSchema, MintTXNSchema, MultiKeySchema, TRANSACTION_TYPE, ValidatorRegistrationSchema } from '../../../proto/generated/txn_pb.js';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { createTransactionHash, signTransactionData } from '../../shared/crypto/signature-utils.js';
import { buildStandardBaseTXN } from '../../shared/tx/base.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { assertTransactionContext, configureTransactionContext, transactionContextFields } from '../context.js';
import { finalizeTransactionHash, getSponsorSigningBytes, getTransactionSigningBytes, signAndFinalize, signCoinTXNWithKeys, signWithKey } from '../finalize.js';

const pin = new Uint8Array(32).fill(0x42);
const { alice, bob } = ED25519_TEST_KEYS;
afterEach(() => configureTransactionContext({ chainId: pin }));

function mint() {
  return create(MintTXNSchema, {
    base: buildStandardBaseTXN({ publicKeyId: alice.publicKey, nonce: 1n, timestamp: new Date('2026-10-27T00:00:00Z') }, MintTXNSchema.typeName),
    contractId: 'test', amount: '1', recipientAddress: new Uint8Array([1])
  });
}

describe('trusted V1 transaction context', () => {
  it('requires an independent trusted pin, even when an incoming transaction supplies a chain', () => {
    const txn = mint();
    configureTransactionContext(undefined);
    expect(() => signWithKey(txn, alice.privateKey, alice.publicKey)).toThrow('Trusted chainId is required');
    expect(() => transactionContextFields('MintTXN')).toThrow('Trusted chainId is required');
    expect(() => assertTransactionContext(txn, { chainId: pin })).not.toThrow();
  });

  it('decodes hex to raw bytes and defensively copies the pin', () => {
    configureTransactionContext({ chainId: `0x${'42'.repeat(32)}` });
    expect(mint().base?.chainId).toEqual(pin);
    const mutablePin = new Uint8Array(pin);
    configureTransactionContext({ chainId: mutablePin });
    mutablePin.fill(0);
    const first = mint();
    first.base!.chainId.fill(0);
    expect(mint().base?.chainId).toEqual(pin);
  });

  it.each(['', 'kalvora:protonet', 'aa'.repeat(31), 'gg'.repeat(32), new Uint8Array(33)])('rejects an invalid chain identity %s', chainId => {
    expect(() => configureTransactionContext({ chainId })).toThrow('chainId must be exactly 32');
  });

  it.each([
    ['chainId', new Uint8Array(32).fill(3), /trusted target chain/],
    ['chainId', new Uint8Array(0), /trusted target chain/],
    ['signatureDomain', new TextEncoder().encode('KAL_PROPOSAL_RESULT_V1'), /signatureDomain/],
    ['signatureDomain', new Uint8Array(0), /signatureDomain/],
    ['intendedType', TRANSACTION_TYPE.COIN_TYPE, /intendedType/],
    ['intendedType', TRANSACTION_TYPE.UKNOWN_TYPE, /intendedType/]
  ] as const)('refuses %s mismatches before invoking an external signer', async (field, value, error) => {
    const txn = mint();
    Object.assign(txn.base!, { [field]: value });
    const sign = vi.fn(async () => new Uint8Array(64));
    await expect(signAndFinalize(txn, { publicKey: alice.publicKey, sign })).rejects.toThrow(error);
    expect(sign).not.toHaveBeenCalled();
    expect(() => signWithKey(txn, alice.privateKey, alice.publicKey)).toThrow(error);
  });

  it('binds each concrete message to its intent and the proposal result to its own domain', () => {
    expect(transactionContextFields('CoinTXN').intendedType).toBe(TRANSACTION_TYPE.COIN_TYPE);
    expect(transactionContextFields('GovernanceVote').intendedType).toBe(TRANSACTION_TYPE.VOTE_TYPE);
    expect(transactionContextFields('ValidatorRegistration').intendedType).toBe(TRANSACTION_TYPE.VALIDATOR_REGISTRATION_TYPE);
    expect(transactionContextFields('ValidatorHeartbeat').intendedType).toBe(TRANSACTION_TYPE.VALIDATOR_HEARTBEAT_TYPE);
    const proposal = transactionContextFields('ProposalResult');
    expect(proposal.intendedType).toBe(TRANSACTION_TYPE.PROPOSAL_RESULT_TYPE);
    expect(new TextDecoder().decode(proposal.signatureDomain)).toBe('KAL_PROPOSAL_RESULT_V1');
    expect(() => transactionContextFields('QuashTXN')).toThrow('Unsupported signed transaction type');
    expect(() => transactionContextFields('RequiredVersion')).toThrow('Unsupported signed transaction type');
  });

  it('clears stale sponsor authorization before user signing', () => {
    const clean = mint();
    const stale = clone(MintTXNSchema, clean);
    stale.base!.feePayer = create(FeePayerSchema, { nonce: 9n, signature: new Uint8Array([3]) });
    signWithKey(clean, alice.privateKey, alice.publicKey);
    signWithKey(stale, alice.privateKey, alice.publicKey);
    expect(stale.base?.feePayer).toBeUndefined();
    expect(stale.base?.signature).toEqual(clean.base?.signature);
    expect(stale.base?.hash).toEqual(clean.base?.hash);
  });

  it('Coin re-signing is idempotent and excludes stale outer and inner signatures', () => {
    const txn = create(CoinTXNSchema, {
      base: { ...mint().base!, ...transactionContextFields('CoinTXN') },
      auth: { publicKey: [{ single: getPublicKeyBytes(alice.publicKey) }, { single: getPublicKeyBytes(bob.publicKey) }], nonce: [1n, 2n] }
    });
    const keys = [alice, bob].map(key => ({ publicKey: key.publicKey, privateKey: key.privateKey }));
    const bytes = getTransactionSigningBytes(txn);
    signCoinTXNWithKeys(txn, keys);
    const signatures = txn.auth!.signature.map(sig => new Uint8Array(sig));
    const hash = new Uint8Array(txn.base!.hash!);
    signCoinTXNWithKeys(txn, keys);
    expect(txn.auth!.signature).toEqual(signatures);
    expect(txn.base!.hash).toEqual(hash);
    expect(getTransactionSigningBytes(txn)).toEqual(bytes);
    expect(ed25519.verify(signatures[0]!, bytes, getPublicKeyBytes(alice.publicKey).slice(2))).toBe(true);
  });

  it('supports one canonical payload for base and Coin multisig without mutating collected signatures', () => {
    const txn = mint();
    txn.base!.publicKey!.multi = create(MultiKeySchema, { publicKeys: [getPublicKeyBytes(alice.publicKey)], signatures: [new Uint8Array([7])] });
    const bytes = getTransactionSigningBytes(txn);
    expect(txn.base!.publicKey!.multi!.signatures[0]).toEqual(new Uint8Array([7]));
    const clear = clone(MintTXNSchema, txn);
    clear.base!.publicKey!.multi!.signatures = [];
    expect(bytes).toEqual(toBinary(MintTXNSchema, clear));
    finalizeTransactionHash(txn);
    const hashCopy = clone(MintTXNSchema, txn);
    delete hashCopy.base!.hash;
    expect(txn.base!.hash).toEqual(createTransactionHash(toBinary(MintTXNSchema, hashCopy)));
    const coin = create(CoinTXNSchema, { base: { ...mint().base!, ...transactionContextFields('CoinTXN') }, auth: { publicKey: [txn.base!.publicKey!], nonce: [1n], signature: [new Uint8Array([8])] } });
    const coinCopy = clone(CoinTXNSchema, coin);
    coinCopy.auth!.signature = [];
    coinCopy.auth!.publicKey[0]!.multi!.signatures = [];
    expect(getTransactionSigningBytes(coin)).toEqual(toBinary(CoinTXNSchema, coinCopy));
  });

  it('registration owner signing clears the previous operational co-signature', () => {
    const txn = create(ValidatorRegistrationSchema, { base: { ...mint().base!, ...transactionContextFields('ValidatorRegistration') }, generatedSignature: new Uint8Array(64).fill(7) });
    const expected = clone(ValidatorRegistrationSchema, txn);
    expected.generatedSignature = new Uint8Array(0);
    const bytes = toBinary(ValidatorRegistrationSchema, expected);
    signWithKey(txn, alice.privateKey, alice.publicKey);
    expect(txn.generatedSignature).toHaveLength(0);
    expect(ed25519.verify(txn.base!.signature!, bytes, getPublicKeyBytes(alice.publicKey).slice(2))).toBe(true);
    txn.generatedSignature = new Uint8Array(64).fill(9);
    const hash = new Uint8Array(txn.base!.hash!);
    finalizeTransactionHash(txn);
    expect(txn.base!.hash).toEqual(hash);
  });

  it('sponsor bytes retain sender approval and sponsor identity/nonce, then hash both signatures', () => {
    const txn = mint();
    signWithKey(txn, alice.privateKey, alice.publicKey);
    const userSignature = new Uint8Array(txn.base!.signature!);
    txn.base!.feePayer = create(FeePayerSchema, { publicKey: { single: getPublicKeyBytes(bob.publicKey) }, nonce: 8n, signature: new Uint8Array([9]) });
    const bytes = getSponsorSigningBytes(txn);
    const expected = clone(MintTXNSchema, txn);
    delete expected.base!.hash;
    expected.base!.feePayer!.signature = new Uint8Array(0);
    expect(bytes).toEqual(toBinary(MintTXNSchema, expected));
    expect(txn.base!.feePayer!.signature).toEqual(new Uint8Array([9]));
    txn.base!.feePayer!.signature = signTransactionData(bytes, bob.privateKey, bob.publicKey);
    finalizeTransactionHash(txn);
    expect(txn.base!.signature).toEqual(userSignature);
    const signed = clone(MintTXNSchema, txn);
    delete signed.base!.hash;
    expect(txn.base!.hash).toEqual(createTransactionHash(toBinary(MintTXNSchema, signed)));
    txn.base!.chainId = new Uint8Array(32).fill(7);
    expect(() => getSponsorSigningBytes(txn)).toThrow('trusted target chain');
  });

  it('routes Coin signing exclusively through its authorization slots', async () => {
    const coin = create(CoinTXNSchema, { base: { ...mint().base!, ...transactionContextFields('CoinTXN') } });
    expect(() => signWithKey(coin, alice.privateKey, alice.publicKey)).toThrow('Use signCoinTXNWithKeys');
    await expect(signAndFinalize(coin, { publicKey: alice.publicKey, sign: async () => new Uint8Array(64) })).rejects.toThrow('Use signCoinTXN');
    expect(() => getSponsorSigningBytes(coin)).toThrow('cannot use base.feePayer');
  });
});
