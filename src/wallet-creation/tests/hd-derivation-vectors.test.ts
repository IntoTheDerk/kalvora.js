import bs58 from 'bs58';
import { describe, it, expect } from 'vitest';

import { KEY_TYPE } from '../constants.js';
import { SLIP0010HDWallet, deriveHDPrivateKey } from '../crypto-core.js';
import { generateSeed } from '../hd-utils.js';
import { createWallet, deriveMultipleWallets } from '../wallet-factory.js';

/**
 * Pinned HD derivation vectors.
 *
 * Every value here defines which address a mnemonic restores to. If one of
 * these fails, the change being tested moves real users' funds to addresses
 * they cannot see — fix the change, do not update the vector.
 */

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const ABANDON_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('Ed25519: SLIP-0010', () => {
  // SLIP-0010 "Test vector 1 for ed25519", verbatim from
  // https://github.com/satoshilabs/slips/blob/master/slip-0010.md
  const seed = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
  const vector1: ReadonlyArray<[path: string, privateKey: string, publicKey: string]> = [
    [
      "m/0'",
      '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
      '8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c'
    ],
    [
      "m/0'/1'",
      'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2',
      '1932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187'
    ],
    [
      "m/0'/1'/2'",
      '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9',
      'ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1'
    ],
    [
      "m/0'/1'/2'/2'",
      '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662',
      '8abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c'
    ],
    [
      "m/0'/1'/2'/2'/1000000000'",
      '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
      '3c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a'
    ]
  ];

  it.each(vector1)('matches the SLIP-0010 test vector at %s', (path, privateKey, publicKey) => {
    const node = new SLIP0010HDWallet(seed, path, KEY_TYPE.ED25519);
    expect(hex(node.privateKey)).toBe(privateKey);
    expect(hex(node.publicKey)).toBe(publicKey);
  });

  it('rejects non-hardened segments, which SLIP-0010 does not define for Ed25519', () => {
    expect(() => new SLIP0010HDWallet(seed, "m/44'/5258'/0'/0/0", KEY_TYPE.ED25519)).toThrow(
      /hardened derivation only/
    );
  });

  it('derives the Kalvora coin type 5258 addresses for the BIP-39 test mnemonic', async () => {
    const expected = [
      ["m/44'/5258'/0'/0'/0'", '35q7SEc9HVV7Gd9oVKCnZjPMxpLrH9DftTcBUyHahTZP'],
      ["m/44'/5258'/1'/0'/0'", '7WtND9GaeT2ZVhRzKnf98fx7Yn4cpT4FyTYJpq8tYFHj'],
      ["m/44'/5258'/2'/0'/0'", 'CWtEMYzMt9hvd1B7wrsTpagHEupFKPsENTjSQNWvQhTR']
    ];

    const single = await createWallet({ keyType: KEY_TYPE.ED25519, mnemonic: ABANDON_MNEMONIC });
    expect([single.derivationPath, single.address]).toEqual(expected[0]);

    // deriveMultipleWallets caches the m/44'/5258' node and derives the rest
    // from it, a separate code path that must agree with the direct one.
    const many = await deriveMultipleWallets({
      keyType: KEY_TYPE.ED25519,
      mnemonic: ABANDON_MNEMONIC,
      count: 3
    });
    expect(many.map((wallet) => [wallet.derivationPath, wallet.address])).toEqual(expected);

    const direct = new SLIP0010HDWallet(
      generateSeed(ABANDON_MNEMONIC),
      "m/44'/5258'/0'/0'/0'",
      KEY_TYPE.ED25519
    );
    expect(bs58.encode(direct.publicKey)).toBe(expected[0]![1]);
  });
});

describe("Ed448: Kalvora's scheme (no standard exists)", () => {
  // Recorded from kalvora.js before Ed25519 moved to SLIP-0010. Ed448 was
  // deliberately left unchanged, and these vectors hold it there.
  const expected = [
    [
      "m/44'/5258'/0'/0'/0'",
      'UAAGQbF9y5ZgooMBPXDzjz3YWcP4S2G4sW4Xirbv73g7E8SSngGANK36tNngSdAZvY6C26BnLwgKyq'
    ],
    [
      "m/44'/5258'/1'/0'/0'",
      'Re9noD1ifu6CEc9bkMtmgGRPpC6GizMapEJL5yofExiYz15HSS5iasZYgY9EAq9TZMK8pZNvW5CH7D'
    ],
    [
      "m/44'/5258'/2'/0'/0'",
      'LiwTYNNsXjDXF7Bfu59J3VP9xtD6ydod1W4X3SeKhz2D7v8EULmzAYammv3ow8vNtCEQcg76ZRKxn3'
    ]
  ];

  it('derives the same Ed448 addresses as before', async () => {
    const single = await createWallet({ keyType: KEY_TYPE.ED448, mnemonic: ABANDON_MNEMONIC });
    expect([single.derivationPath, single.address]).toEqual(expected[0]);

    const many = await deriveMultipleWallets({
      keyType: KEY_TYPE.ED448,
      mnemonic: ABANDON_MNEMONIC,
      count: 3
    });
    expect(many.map((wallet) => [wallet.derivationPath, wallet.address])).toEqual(expected);
  });

  it('still accepts non-hardened segments, as it always has', () => {
    const seed = generateSeed(ABANDON_MNEMONIC);
    expect(() => new SLIP0010HDWallet(seed, "m/44'/5258'/0'/0/0", KEY_TYPE.ED448)).not.toThrow();
  });
});

describe('deriveHDPrivateKey', () => {
  const seed = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));

  it('returns the SLIP-0010 Ed25519 key without touching the seed', () => {
    const before = Uint8Array.from(seed);
    const key = deriveHDPrivateKey(seed, "m/0'/1'/2'/2'/1000000000'");
    expect(hex(key)).toBe('8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793');
    expect(seed).toEqual(before);
  });

  it('defaults to Ed25519 at the first Kalvora path', () => {
    const mnemonicSeed = generateSeed(ABANDON_MNEMONIC);
    const node = new SLIP0010HDWallet(mnemonicSeed, "m/44'/5258'/0'/0'/0'", KEY_TYPE.ED25519);
    expect(deriveHDPrivateKey(mnemonicSeed)).toEqual(node.privateKey);
  });

  it('follows the Ed448 scheme when asked for Ed448', () => {
    const mnemonicSeed = generateSeed(ABANDON_MNEMONIC);
    const path = "m/44'/5258'/0'/0'/0'";
    const node = new SLIP0010HDWallet(mnemonicSeed, path, KEY_TYPE.ED448);
    expect(deriveHDPrivateKey(mnemonicSeed, path, KEY_TYPE.ED448)).toEqual(node.privateKey);
  });

  it('rejects non-hardened Ed25519 segments', () => {
    expect(() => deriveHDPrivateKey(seed, "m/44'/5258'/0'/0/0")).toThrow(/hardened derivation only/);
  });
});
