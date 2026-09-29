/**
 * Signing / finalization tests (`src/sign/finalize.ts`, `src/sign/signer.ts`).
 *
 * All transactions are built offline (explicit nonce + feeAmountParts).
 */
import { clone, create, toBinary } from '@bufbuild/protobuf';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  CoinTXNSchema,
  MintTXNSchema,
  type CoinTXN,
  type MintTXN
} from '../../../proto/generated/txn_pb.js';
import { buildMintTXN, type MintTXNInput } from '../../mint/index.js';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { createTransactionHash, signTransactionData } from '../../shared/crypto/signature-utils.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { buildStandardBaseTXN } from '../../shared/tx/base.js';
import { ED25519_TEST_KEYS, ED448_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  signAndFinalize,
  signCoinTXN,
  signCoinTXNWithKeys,
  signWithKey
} from '../finalize.js';
import { KeyPairSigner, type KalvoraSigner } from '../signer.js';

const { alice, bob } = ED25519_TEST_KEYS;
const OFFLINE = { nonce: 11, feeAmountParts: '250', timestamp: new Date('2026-07-25T09:22:00.000Z') };
const MINT_INPUT: MintTXNInput = {
  contractId: KALVORA_NATIVE_TOKEN,
  amount: '1000',
  recipientAddress: bob.address,
  publicKey: alice.publicKey
};

/**
 * Raw 32-byte Ed25519 key. `getPublicKeyBytes` returns the UTF-8 identifier
 * prefix (e.g. `A_`) followed by the decoded key, so strip the prefix.
 */
function rawEd25519PublicKey(identifier: string): Uint8Array {
  const withPrefix = getPublicKeyBytes(identifier);
  const prefixLength = identifier.lastIndexOf('_') + 1;
  const raw = withPrefix.slice(prefixLength);
  expect(raw).toEqual(bs58.decode(identifier.slice(prefixLength)));
  expect(raw.length).toBe(32);
  return raw;
}

async function unsignedMint(): Promise<MintTXN> {
  return buildMintTXN(MINT_INPUT, OFFLINE);
}

function unsignedMintBytes(txn: MintTXN): Uint8Array {
  const copy = clone(MintTXNSchema, txn);
  delete copy.base!.signature;
  delete copy.base!.hash;
  return toBinary(MintTXNSchema, copy);
}

function unsignedCoin(withAuth = true): CoinTXN {
  const base = buildStandardBaseTXN({
    publicKeyId: alice.publicKey,
    nonce: 1n,
    feeAmountParts: '10',
    timestamp: OFFLINE.timestamp
  });
  return create(CoinTXNSchema, {
    base,
    contractId: KALVORA_NATIVE_TOKEN,
    ...(withAuth
      ? {
        auth: {
          publicKey: [
            { single: getPublicKeyBytes(alice.publicKey) },
            { single: getPublicKeyBytes(bob.publicKey) }
          ],
          nonce: [1n, 4n]
        }
      }
      : {}),
    inputTransfers: [{ index: 0n, amount: '5', feePercent: 100_000_000 }],
    outputTransfers: [{ walletAddress: bs58.decode(bob.address), amount: '5' }]
  });
}

// ----------------------------------------------------------------------------
// KeyPairSigner
// ----------------------------------------------------------------------------

describe('KeyPairSigner', () => {
  it('requires a public and a private key', () => {
    expect(() => new KeyPairSigner('', alice.privateKey)).toThrow('publicKey is required');
    expect(() => new KeyPairSigner(alice.publicKey, '')).toThrow('privateKey is required');
    expect(() => new KeyPairSigner(undefined as unknown as string, alice.privateKey)).toThrow('publicKey is required');
  });

  it('exposes the public key and signs like signTransactionData (Ed25519)', async () => {
    const signer = new KeyPairSigner(alice.publicKey, alice.privateKey);
    expect(signer.publicKey).toBe(alice.publicKey);
    const data = new Uint8Array([1, 2, 3, 4]);
    const signature = await signer.sign(data);
    expect(signature.length).toBe(64);
    expect(signature).toEqual(signTransactionData(data, alice.privateKey, alice.publicKey));
    expect(ed25519.verify(signature, data, rawEd25519PublicKey(alice.publicKey))).toBe(true);
  });

  it('produces 114-byte Ed448 signatures for B_ identifiers', async () => {
    const key = ED448_TEST_KEYS.alice;
    const signature = await new KeyPairSigner(key.publicKey, key.privateKey).sign(new Uint8Array([9]));
    expect(signature.length).toBe(114);
  });
});

// ----------------------------------------------------------------------------
// standard transactions
// ----------------------------------------------------------------------------

describe('signWithKey / signAndFinalize', () => {
  it('throw on a transaction without base', async () => {
    const noBase = create(MintTXNSchema, { contractId: KALVORA_NATIVE_TOKEN, amount: '1' });
    expect(() => signWithKey(noBase, alice.privateKey, alice.publicKey))
      .toThrow('Cannot sign transaction: it has no base (BaseTXN) envelope');
    await expect(signAndFinalize(noBase, new KeyPairSigner(alice.publicKey, alice.privateKey)))
      .rejects.toThrow('Cannot sign transaction: it has no base (BaseTXN) envelope');
  });

  it('signWithKey: signature verifies over the unsigned bytes and hash = SHA3(signed bytes)', async () => {
    const txn = await unsignedMint();
    const expectedUnsigned = toBinary(MintTXNSchema, txn);

    const returned = signWithKey(txn, alice.privateKey, alice.publicKey);
    expect(returned).toBe(txn);
    const signature = txn.base!.signature!;
    const hash = txn.base!.hash!;
    expect(signature.length).toBe(64);
    expect(hash.length).toBe(32);

    expect(unsignedMintBytes(txn)).toEqual(expectedUnsigned);
    expect(ed25519.verify(signature, expectedUnsigned, rawEd25519PublicKey(alice.publicKey))).toBe(true);
    expect(ed25519.verify(signature, expectedUnsigned, rawEd25519PublicKey(bob.publicKey))).toBe(false);

    const copy = clone(MintTXNSchema, txn);
    delete copy.base!.hash;
    expect(hash).toEqual(createTransactionHash(toBinary(MintTXNSchema, copy)));
  });

  it('signAndFinalize matches signWithKey for the same key (deterministic Ed25519)', async () => {
    const a = await unsignedMint();
    const b = clone(MintTXNSchema, a);
    signWithKey(a, alice.privateKey, alice.publicKey);
    const returned = await signAndFinalize(b, new KeyPairSigner(alice.publicKey, alice.privateKey));
    expect(returned).toBe(b);
    expect(b.base!.signature).toEqual(a.base!.signature);
    expect(b.base!.hash).toEqual(a.base!.hash);
  });

  it('re-signing clears stale signature/hash (signWithKey)', async () => {
    const fresh = await unsignedMint();
    signWithKey(fresh, alice.privateKey, alice.publicKey);

    const stale = await unsignedMint();
    stale.base!.signature = new Uint8Array(64).fill(0xaa);
    stale.base!.hash = new Uint8Array(32).fill(0xbb);
    signWithKey(stale, alice.privateKey, alice.publicKey);
    expect(stale.base!.signature).toEqual(fresh.base!.signature);
    expect(stale.base!.hash).toEqual(fresh.base!.hash);

    // signing an already-signed txn again is idempotent
    const again = clone(MintTXNSchema, fresh);
    signWithKey(again, alice.privateKey, alice.publicKey);
    expect(again.base!.signature).toEqual(fresh.base!.signature);
    expect(again.base!.hash).toEqual(fresh.base!.hash);
  });

  it('re-signing clears stale signature/hash (signAndFinalize) and signs only unsigned bytes', async () => {
    const fresh = await unsignedMint();
    signWithKey(fresh, alice.privateKey, alice.publicKey);

    const stale = await unsignedMint();
    stale.base!.signature = new Uint8Array([1, 2, 3]);
    stale.base!.hash = new Uint8Array([4, 5, 6]);
    const seen: Uint8Array[] = [];
    const inner = new KeyPairSigner(alice.publicKey, alice.privateKey);
    const spy: KalvoraSigner = {
      publicKey: alice.publicKey,
      sign: data => {
        seen.push(data);
        return inner.sign(data);
      }
    };
    await signAndFinalize(stale, spy);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(unsignedMintBytes(fresh));
    expect(stale.base!.signature).toEqual(fresh.base!.signature);
    expect(stale.base!.hash).toEqual(fresh.base!.hash);
  });

  it('signAndFinalize propagates signer failures', async () => {
    const txn = await unsignedMint();
    const failing: KalvoraSigner = { publicKey: alice.publicKey, sign: () => Promise.reject(new Error('user rejected')) };
    await expect(signAndFinalize(txn, failing)).rejects.toThrow('user rejected');
  });

  it('a different key yields a different signature and hash', async () => {
    const a = await unsignedMint();
    const b = clone(MintTXNSchema, a);
    signWithKey(a, alice.privateKey, alice.publicKey);
    signWithKey(b, bob.privateKey, bob.publicKey);
    expect(b.base!.signature).not.toEqual(a.base!.signature);
    expect(b.base!.hash).not.toEqual(a.base!.hash);
  });
});

// ----------------------------------------------------------------------------
// CoinTXN
// ----------------------------------------------------------------------------

describe('signCoinTXN / signCoinTXNWithKeys', () => {
  const aliceSigner = new KeyPairSigner(alice.publicKey, alice.privateKey);
  const bobSigner = new KeyPairSigner(bob.publicKey, bob.privateKey);

  it('require at least one signer / key pair', async () => {
    await expect(signCoinTXN(unsignedCoin(), [])).rejects.toThrow('At least one signer is required');
    expect(() => signCoinTXNWithKeys(unsignedCoin(), [])).toThrow('At least one key pair is required');
  });

  it('throw on a CoinTXN without base', async () => {
    const coin = unsignedCoin();
    delete (coin as { base?: unknown }).base;
    await expect(signCoinTXN(coin, [aliceSigner])).rejects.toThrow('Cannot sign CoinTXN: it has no base (BaseTXN) envelope');
    expect(() => signCoinTXNWithKeys(coin, [{ publicKey: alice.publicKey, privateKey: alice.privateKey }]))
      .toThrow('Cannot sign CoinTXN: it has no base (BaseTXN) envelope');
  });

  it('signCoinTXNWithKeys validates each key pair', () => {
    expect(() => signCoinTXNWithKeys(unsignedCoin(), [{ publicKey: alice.publicKey, privateKey: '' }]))
      .toThrow('Key pair at index 0 is missing privateKey or publicKey');
    expect(() => signCoinTXNWithKeys(unsignedCoin(), [
      { publicKey: alice.publicKey, privateKey: alice.privateKey },
      undefined as unknown as { publicKey: string; privateKey: string }
    ])).toThrow('Key pair at index 1 is undefined');
    expect(() => signCoinTXNWithKeys(unsignedCoin(), [{ publicKey: 'not-a-key', privateKey: alice.privateKey }]))
      .toThrow(/Failed to sign with key 0/);
  });

  it('signCoinTXN wraps signer failures with the signer index', async () => {
    const failing: KalvoraSigner = { publicKey: bob.publicKey, sign: () => Promise.reject(new Error('nope')) };
    await expect(signCoinTXN(unsignedCoin(), [aliceSigner, failing])).rejects.toThrow('Failed to sign with signer 1: nope');
  });

  it('every input signature verifies over the unsigned bytes; hash = SHA3(signed bytes)', () => {
    const coin = unsignedCoin();
    const unsignedBytes = toBinary(CoinTXNSchema, coin);
    signCoinTXNWithKeys(coin, [
      { publicKey: alice.publicKey, privateKey: alice.privateKey },
      { publicKey: bob.publicKey, privateKey: bob.privateKey }
    ]);
    const [sigA, sigB] = coin.auth!.signature;
    expect(coin.auth!.signature).toHaveLength(2);
    expect(ed25519.verify(sigA!, unsignedBytes, rawEd25519PublicKey(alice.publicKey))).toBe(true);
    expect(ed25519.verify(sigB!, unsignedBytes, rawEd25519PublicKey(bob.publicKey))).toBe(true);

    const copy = clone(CoinTXNSchema, coin);
    delete copy.base!.hash;
    expect(coin.base!.hash).toEqual(createTransactionHash(toBinary(CoinTXNSchema, copy)));
  });

  it('signCoinTXN and signCoinTXNWithKeys agree', async () => {
    const a = unsignedCoin();
    const b = clone(CoinTXNSchema, a);
    signCoinTXNWithKeys(a, [
      { publicKey: alice.publicKey, privateKey: alice.privateKey },
      { publicKey: bob.publicKey, privateKey: bob.privateKey }
    ]);
    const returned = await signCoinTXN(b, [aliceSigner, bobSigner]);
    expect(returned).toBe(b);
    expect(b.auth!.signature).toEqual(a.auth!.signature);
    expect(b.base!.hash).toEqual(a.base!.hash);
  });

  it('clear a stale base.hash before signing', async () => {
    const fresh = unsignedCoin();
    signCoinTXNWithKeys(fresh, [{ publicKey: alice.publicKey, privateKey: alice.privateKey }]);

    const staleKeys = unsignedCoin();
    staleKeys.base!.hash = new Uint8Array(32).fill(0xcc);
    signCoinTXNWithKeys(staleKeys, [{ publicKey: alice.publicKey, privateKey: alice.privateKey }]);
    expect(staleKeys.auth!.signature).toEqual(fresh.auth!.signature);
    expect(staleKeys.base!.hash).toEqual(fresh.base!.hash);

    const staleSigner = unsignedCoin();
    staleSigner.base!.hash = new Uint8Array(32).fill(0xdd);
    const seen: Uint8Array[] = [];
    await signCoinTXN(staleSigner, [{
      publicKey: alice.publicKey,
      sign: data => {
        seen.push(data);
        return aliceSigner.sign(data);
      }
    }]);
    expect(seen[0]).toEqual(toBinary(CoinTXNSchema, unsignedCoin()));
    expect(staleSigner.auth!.signature).toEqual(fresh.auth!.signature);
    expect(staleSigner.base!.hash).toEqual(fresh.base!.hash);
  });

  // Regression: previously fixed bug (see CHANGELOG 1.0.0).
  it('attaches signatures when the CoinTXN has no auth yet (signCoinTXNWithKeys)', () => {
    const coin = unsignedCoin(false);
    signCoinTXNWithKeys(coin, [{ publicKey: alice.publicKey, privateKey: alice.privateKey }]);
    expect(coin.auth?.signature).toHaveLength(1);
  });

  it('attaches signatures when the CoinTXN has no auth yet (signCoinTXN)', async () => {
    const coin = unsignedCoin(false);
    await signCoinTXN(coin, [aliceSigner]);
    expect(coin.auth?.signature).toHaveLength(1);
  });
});
